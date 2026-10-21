import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.describe('resolution badges', { tag: '@scale' }, () => {
  test.use({
    launchArgs: ['--disable-gpu'],
    seed: {
      settings: {
        currentLocale: 'en-US',
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

  test('HD and 4K badges sit above the right edge of resolution labels', async ({ app, page, uiScale }, testInfo) => {
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
        for (const [label, mark] of [
          ['1080p', 'HD'],
          ['720p60', 'HD'],
          ['2160p60', '4K'],
          ['1080p (12.5 Mbps)', 'HD'],
          ['1080p60 (1.5 Mbps) VP9', 'HD'],
          ['1080p60 (12.5 Mbps) AV01', 'HD'],
          ['2160p60 HDR (25 Mbps) AVC', '4K'],
        ]) {
          const button = document.createElement('button')
          button.className = 'explicit-resolution'
          const span = document.createElement('span')
          span.textContent = label
          if (label.endsWith('VP9')) span.classList.add('shaka-chosen-item')
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
            clippedHeight: element.querySelector('span').scrollHeight - element.querySelector('span').clientHeight,
            clippedWidth: element.querySelector('span').scrollWidth - element.querySelector('span').clientWidth,
            raisedBy: label.top - text.top,
            gap: badge.left - label.right,
            rightSpace: tile.right - text.right,
            topSpace: text.top - tile.top,
          }
        })
        const context = JSON.stringify({ width, uiScale, geometry })
        expect(geometry.clippedHeight, context).toBeLessThanOrEqual(1)
        expect(geometry.clippedWidth, context).toBeLessThanOrEqual(1)
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
