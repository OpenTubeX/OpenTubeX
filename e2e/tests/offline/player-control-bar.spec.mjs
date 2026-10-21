import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
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

  await player.getByRole('button', { name: 'More settings' }).click()
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
