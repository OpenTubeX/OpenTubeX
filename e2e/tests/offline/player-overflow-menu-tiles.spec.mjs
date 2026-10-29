import { test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: { ...WATCH_PAGE_SEED, videoPlaybackRateInterval: 0.25, maxVideoPlaybackRate: 3 } } })

/**
 * Whether the overflow grid highlights the tile, compared with a tile that is
 * neither pressed nor marked active.
 * @param {import('@playwright/test').Locator} tile
 */
function isHighlighted(tile) {
  return tile.evaluate(button => {
    const menu = button.closest('.shaka-overflow-menu')
    const reference = Array.from(menu.querySelectorAll(':scope > button'))
      .find(other => other !== button && other.getAttribute('aria-pressed') !== 'true' && !other.classList.contains('ft-active'))
    return getComputedStyle(button).backgroundColor !== getComputedStyle(reference).backgroundColor
  })
}

/**
 * @param {import('@playwright/test').Locator} player
 * @param {import('@playwright/test').Locator} tile
 */
async function openOverflowMenuWith(player, tile) {
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
  await player.getByRole('button', { name: 'More settings', exact: true }).click()
  await expect(tile).toBeVisible()
  // Keep the pointer off the tile, whose hover background would mask the highlight.
  await player.hover({ position: { x: 5, y: 5 } })
}

/**
 * @param {import('@playwright/test').Locator} player
 */
function closePlayerMenus(player) {
  return player.evaluate(element => element.ui.getControls().hideSettingsMenus())
}

test('playback speed presets offer every interval step up to the maximum', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const presets = player.locator('.shaka-playback-rates .shaka-playback-rate-preset-btn')
  const openPlaybackRateMenu = async () => {
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    await player.getByRole('button', { name: 'More settings', exact: true }).click()
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

test('playback speed tile is highlighted exactly while the speed is not 1x', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const tile = player.locator('.shaka-overflow-menu .shaka-playbackrate-button')
  const highlighted = () => isHighlighted(tile)
  const openOverflowMenu = () => openOverflowMenuWith(player, tile)
  const closeMenus = () => closePlayerMenus(player)

  await openOverflowMenu()
  expect(await highlighted()).toBe(false)

  // Leaving the submenu open while the overflow menu closes must not keep the tile highlighted.
  await tile.click()
  await expect(player.locator('.shaka-playback-rates')).toBeVisible()
  await closeMenus()
  await openOverflowMenu()
  expect(await highlighted()).toBe(false)

  await tile.click()
  await player.locator('.shaka-playback-rates .shaka-playback-rate-preset-btn[data-rate="1.5"]').click()
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await closeMenus()
  await openOverflowMenu()
  expect(await highlighted()).toBe(true)

  // Speed changes outside the menu update the tile too.
  await closeMenus()
  await page.locator('body').press('g')
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)
  await openOverflowMenu()
  expect(await highlighted()).toBe(false)

  await closeMenus()
  await page.locator('body').press('g')
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await openOverflowMenu()
  expect(await highlighted()).toBe(true)

  // Changing the speed settings rebuilds the controls.
  await closeMenus()
  await page.evaluate(() => window.$store.dispatch('updateMaxVideoPlaybackRate', 4))
  await openOverflowMenu()
  expect(await highlighted()).toBe(true)
})

test.describe('level and toggle tiles', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        showVolumeBoostToggle: true,
        controlBarButtons: ['autoplay', 'captions', 'menu', 'pictureInPicture', 'fullWindow', 'fullscreen'],
      }
    }
  })

  test('zoom, volume boost and theatre mode tiles are highlighted while not at their defaults', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const tiles = {
      zoom: overflowMenu.locator('.video-zoom-button'),
      boost: overflowMenu.locator('.volume-boost-button'),
      theatre: overflowMenu.locator('.theatre-button'),
    }
    const highlightedTiles = async () => {
      await openOverflowMenuWith(player, tiles.zoom)
      const result = {
        zoom: await isHighlighted(tiles.zoom),
        boost: await isHighlighted(tiles.boost),
        theatre: await isHighlighted(tiles.theatre),
      }
      await closePlayerMenus(player)
      return result
    }

    expect(await highlightedTiles()).toEqual({ zoom: false, boost: false, theatre: false })

    await page.locator('body').press('z')
    await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
    expect(await highlightedTiles()).toEqual({ zoom: true, boost: false, theatre: false })

    await openOverflowMenuWith(player, tiles.boost)
    await tiles.boost.click()
    await player.locator('.volume-boost-menu').getByRole('button', { name: '150%' }).click()
    await closePlayerMenus(player)
    expect(await highlightedTiles()).toEqual({ zoom: true, boost: true, theatre: false })

    await openOverflowMenuWith(player, tiles.theatre)
    await tiles.theatre.click()
    await closePlayerMenus(player)
    expect(await highlightedTiles()).toEqual({ zoom: true, boost: true, theatre: true })

    await page.locator('body').press('Shift+Z')
    await expect(video).toHaveCSS('transform', 'none')
    expect(await highlightedTiles()).toEqual({ zoom: false, boost: true, theatre: true })
  })
})
