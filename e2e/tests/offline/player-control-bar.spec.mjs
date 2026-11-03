import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

const DESKTOP_DEFAULT = ['autoplay', 'captions', 'menu', 'pictureInPicture', 'theatreMode', 'fullWindow', 'fullscreen']

// The class of the element each customizable control renders.
const BUTTON_CLASSES = {
  autoplay: 'autoplay-toggle',
  captions: 'caption-toggle-button',
  menu: 'shaka-overflow-menu-button',
  pictureInPicture: 'shaka-pip-button',
  theatreMode: 'theatre-button',
  fullWindow: 'full-window-button',
  fullscreen: 'shaka-fullscreen-button',
}

/** @param {import('@playwright/test').Locator} player */
function barButtons(player) {
  return player.locator('.shaka-controls-button-panel > button').evaluateAll((elements, classes) => elements
    .map(element => Object.keys(classes).find(id => element.classList.contains(classes[id])))
    .filter(id => id != null), BUTTON_CLASSES)
}

/**
 * Opens the demo video with its controls kept visible.
 * @param {{ app: import('../../helpers/app.mjs').ElectronAppFixture, page: import('@playwright/test').Page }} fixtures
 */
async function openPausedVideo({ app, page }) {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  return player
}

test('reorders the control bar and moves removed buttons into the player menu', async ({ app, page }) => {
  const player = await openPausedVideo({ app, page })
  const initial = await barButtons(player)
  expect(initial).toEqual(DESKTOP_DEFAULT.filter(id => initial.includes(id)))
  expect(initial).toEqual(expect.arrayContaining(['autoplay', 'captions', 'menu', 'pictureInPicture', 'fullWindow', 'fullscreen']))

  const selected = ['fullscreen', 'captions', 'menu']
  await page.evaluate(buttons => window.$store.dispatch('updateControlBarButtons', buttons), selected)
  await expect.poll(() => barButtons(player)).toEqual(selected)

  // The bar's last button, not the fullscreen button, reaches the screen edge.
  await setPlayerFullscreen(page, true)
  await expect.poll(() => player.locator('.shaka-controls-button-panel > button').evaluateAll(elements => elements
    .filter(element => !element.classList.contains('shaka-play-button') && getComputedStyle(element, '::before').content !== 'none')
    .map(element => element.className))).toEqual([expect.stringContaining('shaka-overflow-menu-button')])
  await setPlayerFullscreen(page, false)

  await openPlayerOptions(player)
  const menu = player.locator('.shaka-overflow-menu')
  await expect(menu).toBeVisible()
  const moved = initial.filter(id => !selected.includes(id))
  expect(moved).toContain('theatreMode')
  for (const id of moved) {
    await expect(menu.locator(`.${BUTTON_CLASSES[id]}`), id).toBeVisible()
  }
  await expect(menu.locator('.shaka-fullscreen-button, .caption-toggle-button')).toHaveCount(0)
  // Moved buttons give way to an open submenu like the other menu controls.
  await menu.locator('.shaka-playbackrate-button').click()
  for (const id of moved) {
    await expect(menu.locator(`.${BUTTON_CLASSES[id]}`), id).toBeHidden()
  }
  await player.locator('.shaka-playback-rates .shaka-back-to-overflow-button').click()
  for (const id of moved) {
    await expect(menu.locator(`.${BUTTON_CLASSES[id]}`), id).toBeVisible()
  }
  // A moved button keeps working from the menu.
  await menu.locator('.full-window-button').click()
  await expect(player).toHaveClass(/fullWindow/)
})

test('applies the order to the compact control bar', async ({ app, page }) => {
  const player = await openPausedVideo({ app, page })
  await page.evaluate(() => window.$store.dispatch('updateControlBarButtons', ['fullscreen', 'menu', 'pictureInPicture']))
  await setWindowSize(app, page, { width: 560, height: 800 })
  // Picture-in-picture stays in the menu of the compact desktop layout.
  await expect.poll(() => barButtons(player)).toEqual(['fullscreen', 'menu'])
})

test('applies the order to the mobile control bar', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator('.app').evaluate(element => {
    const applyMobileClass = () => element.classList.add('capacitorTabs')
    new MutationObserver(() => {
      if (!element.classList.contains('capacitorTabs')) applyMobileClass()
    }).observe(element, { attributeFilter: ['class'] })
    applyMobileClass()
  })
  await page.evaluate(() => window.$store.dispatch('updateControlBarButtons', ['pictureInPicture', 'menu']))
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 450, height: 850 })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect.poll(() => barButtons(player)).toEqual(['pictureInPicture', 'menu'])
})

test('puts player menu controls on the control bar', async ({ app, page }) => {
  const player = await openPausedVideo({ app, page })
  await page.evaluate(() => window.$store.dispatch('updateControlBarButtons', ['quality', 'playbackRate', 'loop', 'menu', 'fullscreen']))
  const panel = player.locator('.shaka-controls-button-panel')
  await expect.poll(() => panel.locator('.legacy-quality-button, .shaka-playbackrate-button, .loop-button, .shaka-overflow-menu-button')
    .evaluateAll(elements => elements.map(element => element.ariaLabel)))
    .toEqual(['Resolution', 'Playback speed', 'Loop the current video', 'More settings'])

  await openPlayerOptions(player)
  const menu = player.locator('.shaka-overflow-menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.legacy-quality-button, .shaka-playbackrate-button, .loop-button')).toHaveCount(0)
  await expect(menu.locator('.sleep-timer-button')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // Submenus open from the control bar like from the player menu.
  await panel.locator('.shaka-playbackrate-button').click()
  await expect(player.locator('.shaka-playback-rates')).toBeVisible()
  await page.keyboard.press('Escape')
  await panel.locator('.loop-button').click()
  await expect.poll(() => player.locator('video').evaluate(video => video.loop)).toBe(true)
})

test('hides player menu controls', async ({ app, page }) => {
  const player = await openPausedVideo({ app, page })
  await page.evaluate(async () => {
    await window.$store.dispatch('updateControlBarButtons', ['captions', 'menu', 'fullscreen'])
    await window.$store.dispatch('updateHiddenPlayerMenuControls', ['sleepTimer', 'ambientMode', 'playbackRate', 'theatreMode'])
  })
  await openPlayerOptions(player)
  const menu = player.locator('.shaka-overflow-menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.legacy-quality-button')).toBeVisible()
  await expect(menu.locator('.full-window-button')).toBeVisible()
  await expect(menu.locator('.sleep-timer-button, .ambient-mode-button, .shaka-playbackrate-button, .theatre-button')).toHaveCount(0)

  // A control moved onto the control bar shows there despite being hidden from the menu.
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.$store.dispatch('updateControlBarButtons', ['playbackRate', 'captions', 'menu', 'fullscreen']))
  await expect(player.locator('.shaka-controls-button-panel > .shaka-playbackrate-button')).toBeVisible()
})

test.describe('saved control bar from before the chapters and screenshot buttons were customizable', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableScreenshot: true, controlBarButtons: ['captions', 'menu', 'fullscreen'] } } })

  test('keeps the chapters and screenshot buttons on the control bar', async ({ app, page }) => {
    await expect.poll(() => page.evaluate(() => window.$store.getters.getControlBarButtons))
      .toEqual(['chapters', 'screenshot', 'captions', 'menu', 'fullscreen'])
    const player = await openPausedVideo({ app, page })
    await expect.poll(() => player.locator('.shaka-controls-button-panel > button').evaluateAll(elements => elements
      .map(element => ['screenshot-button', 'shaka-overflow-menu-button'].find(name => element.classList.contains(name)))
      .filter(Boolean)))
      .toEqual(['screenshot-button', 'shaka-overflow-menu-button'])
  })
})

test('scrolls a menu opened from the control bar below its fixed header', { tag: '@scale' }, async ({ app, page }) => {
  await setWindowSize(app, page, { width: 1000, height: 560 })
  const player = await openPausedVideo({ app, page })
  await page.evaluate(async () => {
    // Enough speeds that the menu has to scroll.
    await window.$store.dispatch('updateMaxVideoPlaybackRate', 10)
    await window.$store.dispatch('updateVideoPlaybackRateInterval', 0.05)
    await window.$store.dispatch('updateControlBarButtons', ['playbackRate', 'menu', 'fullscreen'])
  })
  await player.locator('.shaka-controls-button-panel .shaka-playbackrate-button').click()
  const menu = player.locator('.shaka-settings-menu.shaka-playback-rates')
  await expect(menu).toBeVisible()
  await expect.poll(() => menu.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(1)
  // Overlay scrollbars like the player menu, rather than a native scrollbar.
  await expect(menu.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  const header = menu.locator(':scope > .shaka-back-to-overflow-button')
  const headerBounds = await header.evaluate(element => element.getBoundingClientRect().toJSON())
  await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(headerBounds.top, 0)
  // Neither the options nor the scrollbar pass behind the header.
  expect(await header.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(28, 28, 28)')
  await header.hover()
  expect(await header.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(28, 28, 28)')
  expect(await menu.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(headerBounds.top, 0)
  await expect.poll(() => menu.locator(':scope > .os-scrollbar-vertical .os-scrollbar-track').evaluate(element => element.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(headerBounds.bottom - 0.5)
  // An option scrolled into view, like the chosen one when the menu opens, stops below the header.
  const preset = menu.locator('.shaka-playback-rate-preset-btn').nth(100)
  await preset.evaluate(element => element.scrollIntoView({ block: 'nearest', container: 'nearest' }))
  await expect.poll(() => preset.evaluate(element => element.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(headerBounds.bottom - 0.5)
})

test('keeps a valid scroll range when a menu opened from the control bar shrinks', { tag: '@scale' }, async ({ app, page }) => {
  const languages = Array.from({ length: 40 }, (_, index) => `l${String(index).padStart(2, '0')}`)
  /** @param {string[]} trackLanguages */
  const setAudioTracks = trackLanguages => player.evaluate((element, trackLanguages) => {
    const shakaPlayer = element.ui.getControls().getPlayer()
    const tracks = trackLanguages.map((language, index) => ({
      id: index, active: index === 0, language, label: `${language} audio`, channelsCount: 2, spatialAudio: false, roles: [],
    }))
    shakaPlayer.getAudioTracks = () => tracks
    shakaPlayer.dispatchEvent({ type: 'trackschanged' })
  }, trackLanguages)
  const expectValidScrollRange = () => expect.poll(() => menu.evaluate((element) => {
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

  await setWindowSize(app, page, { width: 1000, height: 560 })
  const player = await openPausedVideo({ app, page })
  await page.evaluate(() => window.$store.dispatch('updateControlBarButtons', ['audioTracks', 'menu', 'fullscreen']))
  await setAudioTracks(languages)
  const button = player.locator('.shaka-controls-button-panel .audio-track-button')
  await expect(button).toBeVisible()
  await button.click()
  const menu = player.locator('.shaka-controls-container > .shaka-settings-menu.audio-tracks')
  await expect(menu.getByRole('menuitemradio')).toHaveCount(languages.length)

  // Rebuilding the options into a shorter list leaves a valid scroll range.
  await menu.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await setAudioTracks(languages.slice(0, 8))
  await expect(menu.getByRole('menuitemradio')).toHaveCount(8)
  await expectValidScrollRange()

  // Dragging the scrollbar leaves the menu open, also through an adaptation
  // that keeps the same audio tracks, as playback causes at any time.
  await setAudioTracks(languages)
  await expect(menu.getByRole('menuitemradio')).toHaveCount(languages.length)
  await menu.evaluate(element => element.scrollTo({ top: 0 }))
  const handle = menu.locator(':scope > .os-scrollbar-vertical .os-scrollbar-handle')
  // The handle follows the scroll offset a frame later; grabbing it before
  // then presses the empty track where it was.
  await expect.poll(() => handle.evaluate(element => (
    element.getBoundingClientRect().top - element.parentElement.getBoundingClientRect().top
  ))).toBeLessThan(1)
  const handleBounds = await handle.boundingBox()
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
  await page.mouse.down()
  await player.evaluate(element => element.ui.getControls().getPlayer().dispatchEvent({ type: 'adaptation' }))
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2 + 60, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(menu).toBeVisible()

  // So does a window size that gives the menu more room.
  await setAudioTracks(languages)
  await expect(menu.getByRole('menuitemradio')).toHaveCount(languages.length)
  await menu.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await setWindowSize(app, page, { width: 1260, height: 820 })
  await expectValidScrollRange()
})
