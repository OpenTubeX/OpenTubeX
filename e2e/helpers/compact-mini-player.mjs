import { expect } from '@playwright/test'

/** Checks the compact strip using rendered geometry and real playback controls. */
export async function checkCompactMiniPlayer(page, player, capture = async () => {}, prepareLayout = async () => {}) {
  const video = player.locator('video').first()
  const controls = player.locator('.mobileMiniBarPlayback')
  const expand = player.locator('.mobileMiniBarExpand')
  const route = page.url()
  const expectLayout = async (collapsed) => {
    await expect(expand).toHaveAttribute('aria-expanded', String(!collapsed))
    await prepareLayout(collapsed)
    await expect.poll(() => player.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(collapsed ? 64 : 112, 1)
    await expect(controls.getByRole('button')).toHaveCount(collapsed ? 1 : 3)
    await expect.poll(() => player.evaluate(element => {
      const bar = element.getBoundingClientRect()
      const title = element.querySelector('.mobileMiniBarTitle').getBoundingClientRect()
      const buttons = [...element.querySelectorAll('.mobileMiniBarPlayback > button, .mobileMiniBarExpand, .mobileMiniBarDismiss')]
      const bounds = buttons.map(button => button.getBoundingClientRect())
      return title.width > 0 && title.right <= bar.right && bounds.every((rect, index) =>
        rect.width >= 47.9 && rect.height >= 47.9 && rect.left >= bar.left - 0.5 && rect.right <= bar.right + 0.5 && rect.bottom <= bar.bottom + 0.5 &&
        bounds.slice(index + 1).every(other => rect.right <= other.left + 0.5 || other.right <= rect.left + 0.5 || rect.bottom <= other.top + 0.5 || other.bottom <= rect.top + 0.5))
    })).toBe(true)
    await expect.poll(() => page.locator('.app > .routerView').evaluate(element => Number.parseFloat(getComputedStyle(element).paddingBlockEnd))).toBe(collapsed ? 64 : 112)
    await expect(player.locator('.mobileMiniBarUploader')).toBeHidden()
    await expect(page).toHaveURL(route)
  }
  await expectLayout(true)
  await video.evaluate(element => element.pause())
  await controls.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await controls.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await capture('compact')
  await expand.click()
  await expectLayout(false)
  await video.evaluate(element => { element.currentTime = 15 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await controls.getByRole('button', { name: 'Rewind 10 seconds' }).click()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 1)
  await controls.getByRole('button', { name: 'Forward 10 seconds' }).click()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(15, 1)
  await capture('expanded')
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight))
  const expandedScrollHeight = await page.evaluate(() => document.scrollingElement.scrollHeight)
  await expand.focus()
  await page.keyboard.press('Space')
  await expectLayout(true)
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.scrollingElement
    return Math.abs(window.scrollY - Math.max(0, scroller.scrollHeight - scroller.clientHeight))
  })).toBeLessThanOrEqual(1)
  await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight)).toBeLessThan(expandedScrollHeight)
  await controls.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
}
