import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: { ...WATCH_PAGE_SEED, videoPlaybackRateInterval: 0.25, maxVideoPlaybackRate: 3 } } })

test('playback speed presets offer every interval step up to the maximum', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const presets = player.locator('.shaka-playback-rates .shaka-playback-rate-preset-btn')
  const openPlaybackRateMenu = async () => {
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    await openPlayerOptions(player)
    await player.locator('.shaka-playbackrate-button').click()
  }
  const presetRates = () => presets.evaluateAll(buttons => buttons.map(button => Number(button.dataset.rate)))

  await openPlaybackRateMenu()
  expect(await presetRates()).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3])

  await player.evaluate(element => element.ui.getControls().hideSettingsMenus())
  await page.evaluate(async () => {
    await window.$store.dispatch('updateVideoPlaybackRateInterval', 0.5)
    await window.$store.dispatch('updateMaxVideoPlaybackRate', 4)
  })
  await openPlaybackRateMenu()
  expect(await presetRates()).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])

  await presets.filter({ hasText: '3.5' }).click()
  await expect.poll(() => player.locator('video').evaluate(element => element.playbackRate)).toBe(3.5)
})

test.describe('phone options sheet', () => {
  test('keeps two rows inline and spaces out larger tiles in full window', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    // The same CSS viewport at every UI scale
    const windowSize = (width, height) => setWindowSize(app, page, { width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
    await windowSize(390, 844)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const sheet = player.locator('.phonePlayerOptions')
    const openSheet = async () => {
      await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
      await player.locator('.shaka-overflow-menu-button').click({ force: true })
      await expect(sheet.locator('.shaka-playbackrate-button')).toBeVisible()
    }
    const measure = () => sheet.evaluate((element) => {
      const tiles = [...element.querySelectorAll(':scope > .shaka-overflow-menu > button')]
        .filter(tile => tile.checkVisibility())
        .map(tile => ({ box: tile.getBoundingClientRect(), parts: [...tile.children].filter(part => part.checkVisibility()).map(part => part.getBoundingClientRect()) }))
      const [first, second] = tiles
      const secondRow = tiles.find(tile => tile.box.top > first.box.bottom)
      return {
        height: first.box.height,
        columnGap: second.box.left - first.box.right,
        rowGap: secondRow ? secondRow.box.top - first.box.bottom : null,
        secondRowEnd: secondRow?.box.bottom ?? null,
        sheetEnd: element.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(element).paddingBottom),
        // Icons, names and values that leave their tile
        overflowing: tiles.filter(({ box, parts }) => parts.some(part => part.top < box.top - 0.5 || part.bottom > box.bottom + 0.5)).length,
      }
    })

    await openSheet()
    const inline = await measure()
    expect(inline.overflowing).toBe(0)
    expect(inline.secondRowEnd).not.toBeNull()
    expect(inline.secondRowEnd).toBeLessThanOrEqual(inline.sheetEnd + 0.5)
    await sheet.evaluate(element => element.querySelector('.phonePlayerOptionsClose').click())
    await expect(sheet).toBeHidden()

    await windowSize(844, 390)
    await page.keyboard.press('s')
    await expect(player).toHaveClass(/fullWindow/)
    await openSheet()
    const fullWindow = await measure()
    expect(fullWindow.overflowing).toBe(0)
    expect(fullWindow.height).toBeGreaterThan(inline.height + 16)
    expect(fullWindow.columnGap).toBeGreaterThanOrEqual(7.5)
    expect(fullWindow.rowGap).not.toBeNull()
    expect(fullWindow.rowGap).toBeGreaterThanOrEqual(7.5)
  })
})
