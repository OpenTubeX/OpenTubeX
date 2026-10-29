import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

const extraCaptionTracks = [
  'ar', 'bg', 'bn', 'bs', 'ca', 'cs', 'da', 'de', 'el', 'es', 'et', 'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi',
  'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pa', 'pl', 'pt', 'ro',
  'ru', 'sk', 'sl', 'sr', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi',
].map(languageCode => ({ languageCode, name: `${languageCode} subtitles` }))

/**
 * @param {import('@playwright/test').Page} page
 */
async function openOverflowMenu(page) {
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.hover({ position: { x: 5, y: 5 } })
  await player.getByRole('button', { name: 'More settings', exact: true }).click()
  return player
}

/**
 * Where the caption menu's header, options and footer are, relative to the menu around them.
 * @param {import('@playwright/test').Locator} player
 */
function captionMenuLayout(player) {
  return player.locator('.shaka-text-languages').evaluate(submenu => {
    const menu = submenu.closest('.shaka-overflow-menu')
    const options = submenu.querySelector(':scope > .ft-caption-list-options')
    const menuRect = menu.getBoundingClientRect()
    const header = submenu.querySelector(':scope > .shaka-back-to-overflow-button').getBoundingClientRect()
    const footer = submenu.querySelector(':scope > .ft-caption-actions').getBoundingClientRect()
    return {
      menuScrolls: menu.scrollHeight > menu.clientHeight + 1,
      optionsScroll: options.scrollHeight > options.clientHeight + 1,
      headerVisible: header.top >= menuRect.top - 1 && header.bottom <= menuRect.bottom + 1,
      footerVisible: footer.top >= menuRect.top - 1 && footer.bottom <= menuRect.bottom + 1,
    }
  })
}

/**
 * Checks the scroll offset, the end of the content and the scrollbar against the options' current range.
 * @param {import('@playwright/test').Locator} options
 */
async function expectValidScrollRange(options) {
  await expect.poll(() => options.evaluate((element) => {
    const range = element.scrollHeight - element.clientHeight
    const last = element.querySelector(':scope > button:last-of-type').getBoundingClientRect()
    const bottom = element.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(element).paddingBottom)
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    const handle = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const usable = !scrollbar.classList.contains('os-scrollbar-unusable')
    return {
      validOffset: element.scrollTop >= 0 && element.scrollTop <= range + 1,
      noEmptySpace: range <= 0 || last.bottom >= bottom - 1,
      scrollbarMatches: usable === (range > 1) && (!usable ||
        Math.abs((handle.top - track.top) / (track.height - handle.height) - element.scrollTop / range) < 0.02),
    }
  })).toEqual({ validOffset: true, noEmptySpace: true, scrollbarMatches: true })
}

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`${usePlayerMenuGrid ? 'grid' : 'list'} player menu`, () => {
    test.use({ seed: { settings: { ...WATCH_PAGE_SEED, enableSubtitlesByDefault: true, usePlayerMenuGrid } } })

    test('scrolls only the caption options between a fixed header and footer @scale', async ({ app, page, attachScreenshot }) => {
      await setWindowSize(app, page, { width: 1500, height: 1000 })
      await mockPlayableWatchPage(app, page, { captionTranslations: true, extraCaptionTracks })
      await openMockedVideo(page)
      const player = await openOverflowMenu(page)
      await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Captions' }).click()
      await expect(player.locator('.shaka-text-languages .shaka-turn-captions-off-button')).toBeAttached()

      if (usePlayerMenuGrid) {
        const height = await player.locator('.shaka-overflow-menu').evaluate(menu => menu.getBoundingClientRect().height)
        expect(height).toBeLessThanOrEqual(340.5)
      }

      const options = player.locator('.shaka-text-languages > .ft-caption-list-options')
      expect(await captionMenuLayout(player)).toEqual({
        menuScrolls: false,
        optionsScroll: true,
        headerVisible: true,
        footerVisible: true,
      })

      // Dragging the scrollbar must not count as a click that closes the submenu.
      const track = options.locator(':scope > .os-scrollbar-vertical')
      const handle = track.locator('.os-scrollbar-handle')
      // The scrollbar only shows while the pointer is over the options.
      await options.hover()
      await expect(track).toHaveClass(/os-scrollbar-visible/)
      const start = await handle.boundingBox()
      const end = await track.boundingBox()
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(start.x + start.width / 2, end.y + end.height + 20, { steps: 5 })
      await page.mouse.up()
      await expect(player.locator('.shaka-text-languages')).toBeVisible()
      await expect(options.getByRole('button', { name: 'Auto-translate' })).toBeInViewport()
      expect(await captionMenuLayout(player)).toMatchObject({ headerVisible: true, footerVisible: true })
      await attachScreenshot('caption options scrolled to the end')

      // Coming back from a page that opens from the list starts at its top again.
      await options.getByRole('button', { name: 'Auto-translate' }).click()
      await player.locator('.ft-caption-translation-menu > .shaka-back-to-overflow-button').click()
      await expect(player.locator('.shaka-text-languages')).toBeVisible()
      await expect.poll(() => options.evaluate(element => element.scrollTop)).toBe(0)

      // Shaka rebuilds the choices when the tracks change, here to a shorter list.
      await options.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
      await player.evaluate((element) => {
        const shakaPlayer = element.ui.getControls().getPlayer()
        const tracks = shakaPlayer.getTextTracks().slice(0, 20)
        shakaPlayer.getTextTracks = () => tracks
        shakaPlayer.dispatchEvent({ type: 'trackschanged' })
      })
      await expect(options.locator(':scope > button')).toHaveCount(23)
      await expectValidScrollRange(options)

      // So does a window size that gives the menu more room.
      await options.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
      await setWindowSize(app, page, { width: 1260, height: 820 })
      await expectValidScrollRange(options)
    })
  })
}

test.describe('list player menu', () => {
  test.use({ seed: { settings: { ...WATCH_PAGE_SEED, usePlayerMenuGrid: false, videoPlaybackRateInterval: 0.1, maxVideoPlaybackRate: 3 } } })

  test('wraps the playback speed presets instead of widening the menu @scale', async ({ app, page, attachScreenshot }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const player = await openOverflowMenu(page)
    await player.locator('.shaka-playbackrate-button').click()
    const presets = player.locator('.shaka-playback-rates > .shaka-playback-rate-presets')
    await expect(presets).toBeVisible()

    const width = await presets.evaluate(element => element.getBoundingClientRect().width)
    expect(width).toBeLessThanOrEqual(400.5)
    const rows = await presets.locator('.shaka-playback-rate-preset-btn').evaluateAll(buttons => {
      return new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size
    })
    expect(rows).toBeGreaterThan(1)
    await attachScreenshot('wrapped playback speed presets')
  })
})
