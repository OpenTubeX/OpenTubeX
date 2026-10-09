import { readFile } from 'node:fs/promises'

import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'

async function labelGeometry(select) {
  return select.evaluate(button => {
    const control = button.getBoundingClientRect()
    const label = button.closest('.select').querySelector('.select-label').getBoundingClientRect()
    return { x: label.x - control.x, y: label.y - control.y, width: label.width, height: label.height }
  })
}

async function expectStableLabel(select) {
  await select.scrollIntoViewIfNeeded()
  await select.evaluate(button => button.blur())
  const initial = await labelGeometry(select)
  const expectUnchanged = async () => {
    const current = await labelGeometry(select)
    for (const key of Object.keys(initial)) {
      expect.soft(Math.abs(current[key] - initial[key]), `label ${key}`).toBeLessThan(0.1)
    }
  }

  await select.focus()
  await expect(select).toBeFocused()
  await expectUnchanged()
  await select.press('Space')
  await expect(select).toHaveAttribute('aria-expanded', 'true')
  await expectUnchanged()
  await select.page().keyboard.press('Escape')
  await expect(select).toHaveAttribute('aria-expanded', 'false')
  await expectUnchanged()
  await select.evaluate(button => button.blur())
  await expectUnchanged()
  await select.click()
  await expect(select).toHaveAttribute('aria-expanded', 'true')
  await expectUnchanged()
  await select.page().keyboard.press('Escape')
  await expect(select).toHaveAttribute('aria-expanded', 'false')
  await expectUnchanged()
}

for (const [locale, label] of [
  ['en-US', 'Save Watched Progress'],
  ['de-DE', 'Videofortschritt merken'],
]) {
  test.describe(`watched progress label in ${locale}`, () => {
    test.use({ seed: { settings: { currentLocale: locale, baseTheme: 'dark' } } })

    test('widens the watched progress select without clipping its label', async ({ app, page }, testInfo) => {
      const privacy = await goToSettingsSection(page, 'privacy')
      const select = privacy.getByRole('combobox', { name: label })
      for (const uiScale of [100, 95]) {
        await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), uiScale)
        for (const width of [1600, 375]) {
          await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
            BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
          }, { width, uiScale })
          await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
          await select.scrollIntoViewIfNeeded()
          await expect.poll(() => select.evaluate(button => {
            const root = button.closest('.select')
            const caption = root.querySelector('.select-placeholder')
            return caption.scrollWidth - caption.clientWidth
          })).toBeLessThanOrEqual(1)
          const bounds = await select.evaluate(button => {
            const root = button.closest('.select').getBoundingClientRect()
            return { left: root.left, right: root.right, viewport: innerWidth }
          })
          expect(bounds.left).toBeGreaterThanOrEqual(0)
          expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
          await expectStableLabel(select)
          if (locale === 'en-US' && uiScale === 100 && width === 1600) {
            await page.screenshot({ path: testInfo.outputPath('watched-progress-label.png') })
          }
        }
      }
    })
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`select labels at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

    test('keeps comments labels stationary on focus and opening', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await expect(page.locator('.comment').first()).toBeVisible()
      const select = page.locator('.commentHeader').getByRole('combobox', { name: 'Sort By' })
      for (const direction of ['ltr', 'rtl']) {
        await select.evaluate((button, direction) => { button.closest('.select').dir = direction }, direction)
        await expectStableLabel(select)
      }
    })

    test('keeps content-sized settings labels stationary at desktop and phone widths', async ({ app, page }) => {
      const general = await goToSettingsSection(page, 'general')
      const select = general.getByRole('combobox', { name: 'Default Landing Page', includeHidden: true })
      for (const width of [1600, 480]) {
        await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
          BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
        }, { width, uiScale })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        for (const direction of ['ltr', 'rtl']) {
          await select.evaluate((button, direction) => { button.closest('.select').dir = direction }, direction)
          await expectStableLabel(select)
        }
      }
    })

    for (const forcedColors of ['none', 'active']) {
      test(`keeps keyboard focus visible in ${forcedColors === 'active' ? 'forced colors' : 'matching accent colors'}`, async ({ app, page }, testInfo) => {
        await page.emulateMedia({ forcedColors })
        const general = await goToSettingsSection(page, 'general')
        const select = general.getByRole('combobox', { name: 'Default Landing Page' })
        const control = select.locator('..')
        await select.scrollIntoViewIfNeeded()
        await page.mouse.move(0, 0)
        await control.evaluate(element => {
          element.style.setProperty('--primary-color', '#999')
          element.style.setProperty('--secondary-text-color', '#999')
          element.querySelector('.select-text').blur()
        })
        await page.evaluate(() => document.fonts.ready)
        const clip = await control.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          return {
            x: Math.floor((bounds.x - 4) * devicePixelRatio),
            y: Math.floor((bounds.y - 12) * devicePixelRatio),
            width: Math.ceil((bounds.width + 8) * devicePixelRatio),
            height: Math.ceil((bounds.height + 16) * devicePixelRatio)
          }
        })
        // Electron's framebuffer respects UI zoom when locator screenshots do not.
        const before = await readFile(await captureAppFramebuffer(app, testInfo, 'keyboard-focus-before'))
        await page.keyboard.press('Tab')
        await select.focus()
        await expect(select).toBeFocused()
        expect(await select.evaluate(button => button.matches(':focus-visible'))).toBe(true)
        const focused = await readFile(await captureAppFramebuffer(app, testInfo, 'keyboard-focus-after'))
        // Matching colors must still produce a visible keyboard focus treatment.
        const changedPixels = await page.evaluate(async ({ screenshots, clip }) => {
          const images = await Promise.all(screenshots.map(async screenshot => {
            const image = new Image()
            image.src = `data:image/png;base64,${screenshot}`
            await image.decode()
            return image
          }))
          const canvas = document.createElement('canvas')
          canvas.width = clip.width
          canvas.height = clip.height
          const context = canvas.getContext('2d')
          const pixels = images.map(image => {
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(image, clip.x, clip.y, clip.width, clip.height, 0, 0, clip.width, clip.height)
            return context.getImageData(0, 0, canvas.width, canvas.height).data
          })
          let changed = 0
          for (let index = 0; index < pixels[0].length; index += 4) {
            if ([0, 1, 2].some(channel => Math.abs(pixels[0][index + channel] - pixels[1][index + channel]) > 16)) changed++
          }
          return changed
        }, { screenshots: [before.toString('base64'), focused.toString('base64')], clip })
        expect(changedPixels).toBeGreaterThan(100)
        await expectStableLabel(select)
      })
    }
  })
}
