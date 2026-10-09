import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { PALETTE_BASE_THEMES } from '../../../src/constants.js'

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 }), width)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeCloseTo(width * 100 / uiScale, 0)
}

async function switchShape(label) {
  return label.locator('.switch-label-text').evaluate(element => {
    const shape = pseudo => {
      const style = pseudo ? getComputedStyle(element, pseudo) : getComputedStyle(element.querySelector('.switch-thumb'))
      return {
        radius: style.borderRadius,
        width: style.width,
        height: style.height,
        left: style.left
      }
    }
    return { track: shape('::before'), thumb: shape() }
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

    test('off and on switch thumbs keep the same size across themes', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const section = await goToSettingsSection(page, 'theme')
      const toggle = section.getByRole('checkbox', { name: /Match top bar with main color/i })
      const label = toggle.locator('..').locator('.switch-label')

      for (const width of [1600, 480]) {
        await resize(app, page, width, uiScale)
        for (const theme of ['oneDark', ...PALETTE_BASE_THEMES.filter(theme => theme !== 'oneDark'), 'catppuccinMacchiato', 'dark', 'light']) {
          await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), theme)
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          for (const checked of [false, true]) {
            if (await toggle.isChecked() !== checked) await label.click()
            await expect(toggle).toBeChecked({ checked })
            await page.mouse.move(0, 0)
            const shape = await switchShape(label)
            expect(Number.parseFloat(shape.thumb.width), `${theme}, ${width}px, checked=${checked}`).toBeCloseTo(18, 1)
            expect(Number.parseFloat(shape.thumb.height), `${theme}, ${width}px, checked=${checked}`).toBeCloseTo(18, 1)
          }
          if (theme === 'oneDark' && width === 1600 && uiScale === 100) {
            const screenshot = testInfo.outputPath('one-dark-switches.png')
            await label.locator('..').locator('..').screenshot({ path: screenshot })
            await testInfo.attach('One Dark switch thumbs', { path: screenshot, contentType: 'image/png' })
          }
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
          await expect(toggle.locator('.switch-thumb')).toHaveAttribute('aria-hidden', 'true')
          await expect(toggle.locator('.switch-thumb .ft-icon')).toHaveAttribute('data-icon', checked ? 'check' : 'minus')
          await expect(toggle.locator('.switch-thumb svg')).toBeVisible()
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
      for (const pack of ['material', 'remix']) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
        for (const colorScheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
          const grid = section.locator('.switchFlowGrid')
          await grid.scrollIntoViewIfNeeded()
          const screenshot = testInfo.outputPath(`switch-roundness-0-${pack}-${colorScheme}.png`)
          await grid.screenshot({ path: screenshot })
          await testInfo.attach(`switches at 0% roundness (${colorScheme})`, { path: screenshot, contentType: 'image/png' })
        }
      }
    })
  })
}
