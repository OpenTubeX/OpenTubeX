import { test, expect } from '../../helpers/app.mjs'

test('uses available toast width', { tag: '@scale' }, async ({ app, page, uiScale, attachScreenshot }) => {
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
  await attachScreenshot(`Toast fits on one line at ${uiScale}%`)

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
