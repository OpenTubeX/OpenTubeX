import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

const audioLanguages = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'es', 'et', 'fa', 'fi', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id',
  'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv',
]

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
 * Where the submenu's header and options are, relative to the menu around them.
 * @param {import('@playwright/test').Locator} submenu
 */
function submenuLayout(submenu) {
  return submenu.evaluate(element => {
    const menu = element.closest('.shaka-overflow-menu')
    const menuRect = menu.getBoundingClientRect()
    const header = element.querySelector(':scope > .shaka-back-to-overflow-button').getBoundingClientRect()
    // Whatever scrolled clips the options, which mustn't pass behind the header.
    const scroller = [element, menu].find(candidate => candidate.scrollTop > 0) ?? element
    return {
      menuScrolls: menu.scrollHeight > menu.clientHeight + 1,
      submenuScrolls: element.scrollHeight > element.clientHeight + 1,
      headerVisible: header.top >= menuRect.top - 1 && header.bottom <= menuRect.bottom + 1,
      optionsClippedBelowHeader: scroller.getBoundingClientRect().top + scroller.clientTop >= header.bottom - 1,
    }
  })
}

/**
 * Checks the scroll offset, the end of the options and the scrollbar against the submenu's current range.
 * @param {import('@playwright/test').Locator} submenu
 */
async function expectValidScrollRange(submenu) {
  await expect.poll(() => submenu.evaluate((element) => {
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

/**
 * Replaces the player's audio tracks, which rebuilds the audio track menu.
 * @param {import('@playwright/test').Locator} player
 * @param {string[]} languages
 * @param {string} [activeLanguage]
 */
function setAudioTracks(player, languages, activeLanguage = languages[0]) {
  return player.evaluate((element, { languages, activeLanguage }) => {
    const shakaPlayer = element.ui.getControls().getPlayer()
    const tracks = languages.map((language, index) => ({
      id: index,
      active: language === activeLanguage,
      language,
      label: `${language} audio`,
      channelsCount: 2,
      spatialAudio: false,
      roles: [],
    }))
    shakaPlayer.getAudioTracks = () => tracks
    shakaPlayer.dispatchEvent({ type: 'trackschanged' })
  }, { languages, activeLanguage })
}

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`${usePlayerMenuGrid ? 'grid' : 'list'} player menu`, () => {
    test.use({ seed: { settings: { ...WATCH_PAGE_SEED, usePlayerMenuGrid } } })

    test('keeps a submenu header in view above its scrolling options @scale', async ({ app, page, attachScreenshot }) => {
      await setWindowSize(app, page, { width: 1500, height: 1000 })
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await setAudioTracks(player, audioLanguages)
      await openOverflowMenu(page)
      await player.locator('.shaka-overflow-menu .audio-track-button').click()
      const submenu = player.locator('.audio-tracks')
      await expect(submenu.getByRole('menuitemradio', { name: 'ar audio' })).toBeVisible()

      if (usePlayerMenuGrid) {
        const height = await player.locator('.shaka-overflow-menu').evaluate(menu => menu.getBoundingClientRect().height)
        expect(height).toBeLessThanOrEqual(340.5)
      }

      // Dragging the scrollbar must not count as a click that closes the submenu.
      const track = submenu.locator(':scope > .os-scrollbar-vertical')
      const handle = track.locator('.os-scrollbar-handle')
      // The scrollbar only shows while the pointer is over the options.
      await submenu.getByRole('menuitemradio', { name: 'ar audio' }).hover()
      await expect(track).toHaveClass(/os-scrollbar-visible/)
      const start = await handle.boundingBox()
      const end = await track.boundingBox()
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(start.x + start.width / 2, end.y + end.height + 20, { steps: 5 })
      await page.mouse.up()
      await expect(submenu).toBeVisible()
      await expect(submenu.getByRole('menuitemradio', { name: 'sv audio' })).toBeInViewport()
      await expect.poll(() => submenuLayout(submenu)).toEqual({
        menuScrolls: false,
        submenuScrolls: true,
        headerVisible: true,
        optionsClippedBelowHeader: true,
      })
      await attachScreenshot('audio tracks scrolled to the end')

      // The header still goes back to the menu.
      await submenu.locator(':scope > .shaka-back-to-overflow-button').click()
      await expect(player.locator('.shaka-overflow-menu .audio-track-button')).toBeVisible()

      // Opening the submenu again starts at its top.
      await player.locator('.shaka-overflow-menu .audio-track-button').click()
      await expect.poll(() => submenu.evaluate(element => element.scrollTop)).toBe(0)

      // Unless that leaves the chosen option out of view.
      await submenu.locator(':scope > .shaka-back-to-overflow-button').click()
      await setAudioTracks(player, audioLanguages, 'sv')
      await player.locator('.shaka-overflow-menu .audio-track-button').click()
      await expect(submenu.getByRole('menuitemradio', { name: 'sv audio' })).toBeInViewport()

      // Rebuilding the options into a shorter list leaves a valid scroll range.
      await submenu.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
      await setAudioTracks(player, audioLanguages.slice(0, 14))
      await expect(submenu.getByRole('menuitemradio')).toHaveCount(14)
      await expectValidScrollRange(submenu)

      // So does a window size that gives the submenu more room.
      await setAudioTracks(player, audioLanguages)
      await expect(submenu.getByRole('menuitemradio')).toHaveCount(audioLanguages.length)
      await submenu.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
      await setWindowSize(app, page, { width: 1260, height: 820 })
      await expectValidScrollRange(submenu)
    })

    test('opens caption appearance at its top again @scale', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      await openMockedVideo(page)
      const player = await openOverflowMenu(page)
      await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Captions' }).click()
      const options = player.locator('.shaka-text-languages').getByRole('button', { name: 'Options', exact: true })
      await options.click()
      const appearance = player.locator('.ft-caption-appearance-menu')
      await expect(appearance).toBeVisible()
      // Short enough for the controls to scroll in every layout
      await player.locator('.shaka-overflow-menu').evaluate(element => { element.style.maxHeight = '220px' })
      await appearance.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
      await expect.poll(() => appearance.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await appearance.locator(':scope > .shaka-back-to-overflow-button').click()
      await options.click()
      await expect(appearance).toBeVisible()
      expect(await appearance.evaluate(element => element.scrollTop)).toBe(0)
    })
  })
}
