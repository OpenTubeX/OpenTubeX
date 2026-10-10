import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const uiScale of [100, 95, 125]) {
  test.describe(`resolution badges at ${uiScale}% UI scale`, () => {
    test.use({
      launchArgs: ['--disable-gpu'],
      seed: {
        settings: {
          currentLocale: 'en-US',
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
        },
      },
    })

    test('HD and 4K badges sit above the right edge of resolution labels', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('body')).toHaveClass(/dark/)
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))

      for (const width of [1280, 450]) {
        await setWindowSize(app, page, { width, height: width === 450 ? 700 : 800 })
        await player.hover()
        await player.getByRole('button', { name: 'More settings' }).click()
        await page.locator('.shaka-overflow-menu .legacy-quality-button').click()
        const menu = page.locator('.legacy-qualities')
        await expect(menu).toBeVisible()
        // The demo media has legacy formats without badges. Add Shaka's
        // adaptive-resolution markup to exercise the actual submenu styles.
        await menu.evaluate(element => {
          element.querySelectorAll('button:not(.shaka-back-to-overflow-button)').forEach(button => button.remove())
          for (const [label, mark] of [['1080p', 'HD'], ['720p60', 'HD'], ['2160p60', '4K'], ['1080p (12.5 Mbps)', 'HD']]) {
            const button = document.createElement('button')
            button.className = 'explicit-resolution'
            const span = document.createElement('span')
            span.textContent = label
            const badge = document.createElement('sup')
            badge.className = 'shaka-quality-mark'
            badge.textContent = mark
            button.append(span, badge)
            element.append(button)
          }
        })

        for (const button of await menu.locator('.explicit-resolution').all()) {
          const geometry = await button.evaluate(element => {
            const tile = element.getBoundingClientRect()
            const label = element.querySelector('span').getBoundingClientRect()
            const badge = element.querySelector('sup').getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(element.querySelector('sup'))
            const text = range.getBoundingClientRect()
            return {
              wrapped: label.height > 20,
              raisedBy: label.top - text.top,
              gap: badge.left - label.right,
              rightSpace: tile.right - text.right,
              topSpace: text.top - tile.top,
            }
          })
          const context = JSON.stringify({ width, uiScale, geometry })
          if (!geometry.wrapped) expect(geometry.raisedBy, context).toBeGreaterThan(2)
          expect(geometry.gap, context).toBeGreaterThanOrEqual(0)
          expect(geometry.rightSpace, context).toBeGreaterThanOrEqual(0)
          expect(geometry.topSpace, context).toBeGreaterThanOrEqual(0)
        }
        if (uiScale === 100 && width === 1280) {
          await menu.screenshot({ path: testInfo.outputPath('resolution-badges.png') })
        }
        await page.keyboard.press('Escape')
      }
    })
  })
}
