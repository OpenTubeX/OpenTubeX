import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 }), width)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeCloseTo(width * 100 / uiScale, 0)
}

async function switchShape(label) {
  return label.locator('.switch-label-text').evaluate(element => {
    const shape = pseudo => {
      const style = getComputedStyle(element, pseudo)
      return {
        radius: style.borderRadius,
        width: style.width,
        height: style.height,
        left: style.left
      }
    }
    return { track: shape('::before'), thumb: shape('::after') }
  })
}

async function setRoundness(page, value) {
  await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), value)
  await expect(page.locator('body')).toHaveCSS('--ui-roundness', String(value / 100))
}

for (const uiScale of [100, 95]) {
  test.describe(`switch roundness at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          currentLocale: 'en-US',
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue'
        }
      }
    })

    test('keeps the default switch shape below 100% roundness', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const section = await goToSettingsSection(page, 'general')
      const toggle = section.locator('.switch-ctn[data-setting-key="checkForUpdates"]')
      const input = toggle.getByRole('checkbox')
      const label = toggle.locator('.switch-label')

      for (const width of [1600, 480]) {
        await resize(app, page, width, uiScale)
        for (const checked of [false, true]) {
          if (await input.isChecked() !== checked) await label.click()
          await expect(input).toBeChecked({ checked })
          await setRoundness(page, 100)
          const defaultShape = await switchShape(label)
          for (const roundness of [0, 25, 50, 99, 100]) {
            await setRoundness(page, roundness)
            expect(await switchShape(label), `${width}px, checked=${checked}, roundness=${roundness}%`).toEqual(defaultShape)
          }
          for (const roundness of [150, 200]) {
            await setRoundness(page, roundness)
            const shape = await switchShape(label)
            expect(Number.parseFloat(shape.track.radius)).toBeCloseTo(Number.parseFloat(defaultShape.track.radius) * roundness / 100)
            expect(shape.thumb).toEqual(defaultShape.thumb)
          }
        }
      }

      await resize(app, page, 1600, uiScale)
      await setRoundness(page, 0)
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        const grid = section.locator('.switchFlowGrid')
        await grid.scrollIntoViewIfNeeded()
        const screenshot = testInfo.outputPath(`switch-roundness-0-${colorScheme}.png`)
        await grid.screenshot({ path: screenshot })
        await testInfo.attach(`switches at 0% roundness (${colorScheme})`, { path: screenshot, contentType: 'image/png' })
      }
    })
  })
}
