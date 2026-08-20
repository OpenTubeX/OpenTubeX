import { setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      uiScale: 95,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

test('keeps toast wrapping stable without scrollbars in player fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.evaluate(() => {
    window.ftElectron.showToastOnAllTabs(
      'IP block recovery script finished',
      1000,
      ['fas', 'check']
    )
  })

  const toast = page.locator('.toast', { hasText: 'IP block recovery script finished' })
  await expect(toast).toBeVisible()
  await expect(toast.locator('..')).toHaveCSS('transform', 'none')

  const measure = () => toast.evaluate((element) => {
    const message = element.querySelector('.message')
    const toastBounds = element.getBoundingClientRect()
    const messageBounds = message.getBoundingClientRect()

    return {
      toastWidth: toastBounds.width,
      toastHeight: toastBounds.height,
      messageWidth: messageBounds.width,
      messageHeight: messageBounds.height,
      messageScrollWidth: message.scrollWidth,
      messageScrollHeight: message.scrollHeight,
      messageClientWidth: message.clientWidth,
      messageClientHeight: message.clientHeight,
      overflowY: getComputedStyle(element).overflowY
    }
  })

  const windowed = await measure()
  await expect(toast).toHaveCount(0)

  await setPlayerFullscreen(page, true)
  await page.evaluate(() => {
    window.ftElectron.showToastOnAllTabs(
      'IP block recovery script finished',
      30000,
      ['fas', 'check']
    )
  })
  await expect(toast).toBeVisible()
  await expect(toast.locator('..')).toHaveCSS('transform', 'none')

  const fullscreen = await measure()

  expect(fullscreen.overflowY).toBe('visible')
  await expect(toast.locator('.os-scrollbar')).toHaveCount(0)
  expect(fullscreen.messageScrollWidth).toBeLessThanOrEqual(fullscreen.messageClientWidth)
  expect(fullscreen.messageScrollHeight).toBeLessThanOrEqual(fullscreen.messageClientHeight)
  expect(fullscreen.toastWidth).toBeCloseTo(windowed.toastWidth, 0)
  expect(fullscreen.toastHeight).toBeCloseTo(windowed.toastHeight, 0)
  expect(fullscreen.messageWidth).toBeCloseTo(windowed.messageWidth, 0)
  expect(fullscreen.messageHeight).toBeCloseTo(windowed.messageHeight, 0)
})
