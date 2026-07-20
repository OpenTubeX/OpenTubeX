import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { waitForPlaybackOrSkip } from '../../helpers/player.mjs'

const PLAYLIST_URL = 'https://youtu.be/aqz-KE-bpKQ?list=UUSMOQeBJ2RAnuFungnQOxLg'

test('fullscreen playlist dock centers initially and preserves each layout position', async ({ page, innertube }) => {
  test.skip(innertube.replay, 'playlist hydration needs the real API')

  const searchInput = page.locator('.topNav .searchInput input.ft-input')
  await searchInput.fill(PLAYLIST_URL)
  await searchInput.press('Enter')
  await page.waitForURL(/#\/watch\/aqz-KE-bpKQ/, { timeout: 60000 })

  const sidebar = page.locator('.playlistItemsWrapper')
  await expect(sidebar).toBeVisible({ timeout: 60000 })
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1000)
  await waitForPlaybackOrSkip(test, page)

  await sidebar.evaluate((element) => { element.scrollTop = 420 })
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollTop)).toBe(420)

  await setPlayerFullscreen(page, true)
  const sidebarScrollTop = await sidebar.evaluate((element) => element.scrollTop)
  const playlistToggle = page.getByRole('button', { name: 'Playlist', exact: true })
  await playlistToggle.click()
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'true')

  const dock = page.locator('.fullscreenPlaylistTarget .playlistItemsWrapper')
  await expect(dock).toBeVisible()
  const currentDockItem = dock.locator('.playlistItem').filter({ has: page.locator('.videoIndexIcon') })
  await expect.poll(async () => {
    const [dockBounds, itemBounds] = await Promise.all([dock.boundingBox(), currentDockItem.boundingBox()])
    return Math.abs((dockBounds.y + dockBounds.height / 2) - (itemBounds.y + itemBounds.height / 2))
  }).toBeLessThan(2)
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

  const centeredDockScrollTop = await dock.evaluate((element) => element.scrollTop)
  await dock.evaluate((element) => element.scrollBy(0, 480))
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBeGreaterThan(centeredDockScrollTop)
  const dockScrollTop = await dock.evaluate((element) => element.scrollTop)
  await page.getByRole('button', { name: 'Close Playlist' }).click({ force: true })
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'false')
  await playlistToggle.click()
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(dock).toBeVisible()
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBe(dockScrollTop)

  await setPlayerFullscreen(page, false)
  await expect.poll(async () => {
    const restoredScrollTop = await sidebar.evaluate((element) => element.scrollTop)
    return Math.abs(restoredScrollTop - sidebarScrollTop)
  }).toBeLessThan(150)
})
