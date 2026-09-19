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
      30000,
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
  await toast.locator('..').locator('..').focus()
  await page.keyboard.press('Escape')
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

for (const scale of [95, 100, 125]) {
  test(`uses available toast width at ${scale}% UI scale`, async ({ app, page, attachScreenshot }) => {
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), scale)
    const message = 'Channel has been removed from your subscriptions'
    await page.evaluate(message => {
      window.ftElectron.showToastOnAllTabs(message, 30000, ['fas', 'trash'])
    }, message)
    const toast = page.locator('.toast', { hasText: message })
    await expect(toast).toBeVisible()
    const lineCount = () => toast.locator('.message').evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })

    await expect.poll(lineCount).toBe(1)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(375, 800)
    })
    await expect.poll(lineCount).toBeGreaterThan(1)
    await expect.poll(() => toast.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })).toBe(true)
    // A toast born in a narrow window must also grow when space becomes available.
    await toast.locator('..').locator('..').focus()
    await page.keyboard.press('Escape')
    await expect(toast).toHaveCount(0)
    await page.evaluate(message => {
      window.ftElectron.showToastOnAllTabs(message, 30000, ['fas', 'trash'])
    }, message)
    await expect.poll(lineCount).toBeGreaterThan(1)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1200, 800)
    })
    await expect.poll(lineCount).toBe(1)
    await attachScreenshot(`Toast fits on one line at ${scale}%`)

    // Clipping older cards in the collapsed stack must not change their text layout.
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('First short toast', 30000)
      window.ftElectron.showToastOnAllTabs('Second short toast', 30000)
    })
    await expect(toast.locator('..').locator('..')).toHaveAttribute('data-index', '2')
    await expect.poll(lineCount).toBe(1)
    await page.locator('.toast', { hasText: 'Second short toast' }).hover()
    await expect(toast.locator('..').locator('..')).toHaveAttribute('data-expanded', 'true')
    await expect.poll(lineCount).toBe(1)
  })
}
