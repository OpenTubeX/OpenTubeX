import { test, expect } from '../../helpers/innertube.mjs'

const PLAYLIST_URL = 'https://youtu.be/R_kpPJTZ5TY?list=PLuTY0Kb9_4IY9Q1SeMeHLYe7k6DIUk-4L'

test('fullscreen playlist dock scrolls and preserves its position', async ({ page, innertube }) => {
  test.skip(innertube.replay, 'playlist hydration needs the real API')

  const searchInput = page.locator('.topNav .searchInput input.ft-input')
  await searchInput.fill(PLAYLIST_URL)
  await searchInput.press('Enter')
  await page.waitForURL(/#\/watch\/R_kpPJTZ5TY/, { timeout: 60000 })

  const sidebar = page.locator('.playlistItemsWrapper')
  await expect(sidebar).toBeVisible({ timeout: 60000 })
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1000)

  await sidebar.evaluate((element) => { element.scrollTop = 420 })
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollTop)).toBe(420)

  await page.locator('body').press('f')
  const player = page.locator('.ftVideoPlayer')
  await expect.poll(async () => player.evaluate((element) => document.fullscreenElement === element)).toBe(true)
  await page.locator('.fullscreenPlaylistToggle').click({ force: true })

  const dock = page.locator('.fullscreenPlaylistTarget .playlistItemsWrapper')
  await expect(dock).toBeVisible()
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBe(420)
  await page.locator('.fullscreenPlaylistClose').click()
  await expect(page.locator('.fullscreenPlaylistOverlay.open')).toHaveCount(0)
  await page.locator('.fullscreenPlaylistToggle').click({ force: true })
  await expect(dock).toBeVisible()
  const header = page.locator('.fullscreenPlaylistTarget .playlistHeader')
  const headerBounds = await header.boundingBox()
  await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const dockBounds = await dock.boundingBox()
  expect(dockBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1)
  const dockDimensions = await dock.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(dockDimensions.scrollHeight).toBeGreaterThan(dockDimensions.clientHeight)

  await page.mouse.move(
    dockBounds.x + dockBounds.width / 2,
    dockBounds.y + dockBounds.height / 2
  )
  await page.mouse.wheel(0, 480)
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBeGreaterThan(420)
  const dockScrollTop = await dock.evaluate((element) => element.scrollTop)

  await page.locator('body').press('f')
  await expect.poll(async () => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollTop)).toBe(dockScrollTop)
})
