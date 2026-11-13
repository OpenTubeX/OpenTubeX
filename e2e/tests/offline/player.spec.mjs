import { goTo, sel, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, expectDockedToBottomRight, findWatchComponent, openMockedVideo, waitForPlayback, openCaptionLanguages, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

// These used to live in the network suite, where they only ran when YouTube
// served both the watch page and a media stream. Everything they need is the
// player actually playing something, so they run against the local demo
// video and recorded metadata instead.

// yt-dlp isn't installed in the test environment, so its extraction attempt
// only costs time and puts a fallback toast over the player. The migration
// marker stops the store from switching the engine back on launch.
const PLAYER_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

test.use({ seed: { settings: PLAYER_SEED } })

/**
 * @param {{ app: import('../../helpers/app.mjs').ElectronAppFixture, page: import('@playwright/test').Page }} fixtures
 */
async function openDemoVideo({ app, page }, options = {}) {
  await mockPlayableWatchPage(app, page, options)
  return await openMockedVideo(page)
}

/** @param {import('@playwright/test').Page} page */
function expectNotFullscreen(page) {
  return expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
}

/**
 * Double-clicks the mini player's video surface beside its controls.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} player
 */
async function doubleClickMiniPlayerVideo(page, player) {
  const point = await player.evaluate(element => {
    const { left, top, width, height } = element.getBoundingClientRect()
    for (let y = top + height * 0.3; y < top + height * 0.8; y += 4) {
      for (let x = left + width * 0.2; x < left + width * 0.8; x += 4) {
        if (document.elementFromPoint(x, y)?.classList.contains('scrollMiniPointerLayer')) return { x, y }
      }
    }
    return null
  })
  expect(point).not.toBeNull()
  await page.mouse.dblclick(point.x, point.y)
}

/** Scrolls the player out of view, which docks it as the scroll mini player. */
function scrollBelowPlayer(player) {
  return player.evaluate(element => {
    const rect = element.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + rect.bottom)
  })
}

async function openCrossTabMiniPlayerOverWatchTab({ app, page }) {
  await openDemoVideo({ app, page })
  const firstTab = page.locator('.tabBar .tab').first()
  const firstTabId = await page.locator(activeTab).getAttribute('data-tab-id')

  await page.locator('.tabBar .newTabButton').click()
  await openDemoVideo({ app, page })
  const secondTab = page.locator('.tabBar .tab').nth(1)
  const secondTabId = await page.locator(activeTab).getAttribute('data-tab-id')

  await firstTab.click()
  const firstPlayer = page.locator(`.ftVideoPlayer[data-tab-id="${firstTabId}"]`)
  const firstVideo = firstPlayer.locator('video')
  await firstVideo.evaluate(element => element.play())
  await expect.poll(() => firstVideo.evaluate(element => element.paused)).toBe(false)

  await secondTab.click()
  const activePlayer = page.locator(`.ftVideoPlayer[data-tab-id="${secondTabId}"]`)
  await expect(firstPlayer).toHaveClass(/scrollMiniPlayer/)
  await expect(activePlayer).not.toHaveClass(/scrollMiniPlayer/)

  return { activePlayer, firstPlayer, firstVideo }
}

async function expectNoScrollMiniPlayerActivation(page, player, trigger) {
  await player.evaluate(element => {
    window.scrollMiniPlayerActivationCount = 0
    window.scrollMiniPlayerActivationObserver = new MutationObserver(() => {
      if (element.classList.contains('scrollMiniPlayer')) {
        window.scrollMiniPlayerActivationCount++
      }
    })
    window.scrollMiniPlayerActivationObserver.observe(element, { attributeFilter: ['class'] })
  })

  await trigger()
  await page.waitForTimeout(350)

  const activationCount = await page.evaluate(() => {
    window.scrollMiniPlayerActivationObserver.disconnect()
    const count = window.scrollMiniPlayerActivationCount
    delete window.scrollMiniPlayerActivationObserver
    delete window.scrollMiniPlayerActivationCount
    return count
  })
  expect(activationCount).toBe(0)
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
}

/** Asserts that the overlay owns a point where it intersects the detached player. */
async function expectOverlayAbovePlayer(player, overlay) {
  await expect(overlay).toBeVisible()
  const playerElement = await player.elementHandle()
  expect(playerElement).not.toBeNull()

  const result = await overlay.evaluate((overlayElement, playerElement) => {
    const overlayRect = overlayElement.getBoundingClientRect()
    const playerRect = playerElement.getBoundingClientRect()
    const left = Math.max(overlayRect.left, playerRect.left)
    const right = Math.min(overlayRect.right, playerRect.right)
    const top = Math.max(overlayRect.top, playerRect.top)
    const bottom = Math.min(overlayRect.bottom, playerRect.bottom)

    if (right <= left || bottom <= top) {
      return { intersects: false, overlayIsTopmost: false }
    }

    const topmost = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    return {
      intersects: true,
      overlayIsTopmost: topmost !== null && overlayElement.contains(topmost)
    }
  }, playerElement)

  await playerElement.dispose()
  expect(result.intersects).toBe(true)
  expect(result.overlayIsTopmost).toBe(true)
}

test('repeated seek shortcuts accumulate the OSD while seeking immediately', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })
  await video.evaluate(element => {
    element.pause()
    element.currentTime = 0
  })
  const popup = page.locator(`${activeTab} .valueChangePopup`)
  const text = popup.locator('.valueChangeText')

  for (const seconds of [5, 10]) {
    await page.keyboard.press('ArrowRight')
    await expect(text).toHaveText(`${seconds}s`)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(seconds, 3)
  }
  await attachScreenshot('accumulated seek OSD')

  await page.keyboard.press('ArrowLeft')
  await expect(text).toHaveText('5s')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 3)
  await expect(popup).toBeHidden()

  await page.keyboard.press('ArrowRight')
  await expect(text).toHaveText('5s')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(10, 3)

  await page.keyboard.press('0')
  await page.keyboard.press('ArrowRight')
  await expect(text).toHaveText('5s')

  const seekBar = page.locator(`${activeTab} .shaka-seek-bar`)
  await seekBar.click({ position: { x: 0, y: 1 } })
  await seekBar.evaluate(element => element.blur())
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(0, 3)
  await page.keyboard.press('ArrowRight')
  await expect(text).toHaveText('5s')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 3)
})

test('does not restore a consumed link timestamp after an app restart', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=2')
  const timestampNavigation = page.waitForURL(/#\/watch\/jNQXAC9IVRw\?timestamp=2/)
  await page.locator(sel.searchInput).press('Enter')

  await timestampNavigation
  const video = await waitForPlayback(page)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(2)
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw$/)
  await expect(page.locator('.tab.active .tabTitleText')).toHaveText('Me at the zoo')
  await expect(page).toHaveTitle('Me at the zoo - OpenTubeX')

  ;({ page } = await app.relaunch())
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw$/)
  await expect(page.locator('.tab.active .tabTitleText')).toHaveText('Me at the zoo')
  await expect(page).toHaveTitle('Me at the zoo - OpenTubeX')
})

test('a timestamped video stays paused when the window loses focus', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=2')
  await page.locator(sel.searchInput).press('Enter')

  const video = await waitForPlayback(page)
  await video.evaluate(element => element.pause())
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].emit('blur')
  })
  await page.waitForTimeout(2000)

  expect(await video.evaluate(element => element.paused)).toBe(true)
})

test.describe('without autoplay', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, autoplayVideos: false } } })

  test('a paused seek replaces the startup poster with the video after a timestamp', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=2')
    await page.locator(sel.searchInput).press('Enter')
    const video = page.locator(`${activeTab} video`)
    const poster = page.locator(`${activeTab} .countdownPoster`)
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 30_000 }).toBe(4)
    // The start position must not replace the thumbnail before the user acts.
    await expect(poster).toBeVisible()

    await video.evaluate(element => { element.currentTime = 5 })
    await expect(poster).toBeHidden()
    expect(await video.evaluate(element => element.paused)).toBe(true)
  })
})

test('a Short opened in a background tab never starts playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    window.__backgroundShortPlaybackEvents = []
    for (const type of ['play', 'playing']) {
      document.addEventListener(type, (event) => {
        const tabContent = event.target.closest('.tabContent')
        if (tabContent?.getAttribute('aria-hidden') === 'true') {
          window.__backgroundShortPlaybackEvents.push(type)
        }
      }, true)
    }
  })

  const backgroundTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/background-short?short=true',
    title: 'Background Short',
    makeActive: false,
    preloadInBackground: true
  }))
  const backgroundVideo = page.locator(`.tabContent[data-tab-id="${backgroundTab.id}"] video`)

  await expect(backgroundVideo).toHaveCount(1, { timeout: 30_000 })
  await expect.poll(() => backgroundVideo.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(1000)

  expect(await page.evaluate(() => window.__backgroundShortPlaybackEvents)).toEqual([])
  expect(await backgroundVideo.evaluate(element => ({
    paused: element.paused,
    currentTime: element.currentTime
  }))).toEqual({ paused: true, currentTime: 0 })
})

test('hides configured paused interface elements until pointer activity', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await Promise.all([
      component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', false),
      component.proxy.$store.dispatch('updateShowVideoTitleWhenPaused', false),
      component.proxy.$store.dispatch('updateShowFullscreenActionsWhenPaused', false),
      // Long enough for the reveal to finish fading in on a busy machine.
      component.proxy.$store.dispatch('updatePausedInterfaceHideDelay', 60),
    ])
    await component.proxy.$nextTick()
  })

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const title = player.locator('.playerFullscreenTitleOverlay')
  const actions = player.locator('.fullscreenActions')
  const controls = player.locator('.shaka-controls-button-panel')
  const seekBar = player.locator('.shaka-seek-bar-container')

  await page.locator('body').press('s')
  await expect(player).toHaveClass(/fullWindow/)
  await video.evaluate(element => element.pause())
  await expect(player).toHaveClass(/playerPaused/)
  await expect(title).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(controls).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('pointer-events', 'none')

  const playerBounds = await player.boundingBox()
  await page.mouse.move(
    playerBounds.x + playerBounds.width / 2,
    playerBounds.y + playerBounds.height / 2
  )
  await expect(player).toHaveClass(/pausedInterfaceRevealed/)
  await expect(title).toHaveCSS('opacity', '1')
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(seekBar).toHaveCSS('opacity', '1')

  // Each pointer move restarts the hide timer with the current delay.
  await watchComponent.evaluate(component => component.proxy.$store.dispatch('updatePausedInterfaceHideDelay', 0.5))
  await page.mouse.move(playerBounds.x + playerBounds.width / 2 + 10, playerBounds.y + playerBounds.height / 2)
  await expect(player).not.toHaveClass(/pausedInterfaceRevealed/, { timeout: 1500 })
  await expect(title).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(controls).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('opacity', '0')
  await watchComponent.dispose()
})

// Regression: playback speed controls stopped working (1c958d468)
test('keyboard shortcuts change the playback rate', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('p')
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBeGreaterThan(1)
  await attachScreenshot('playback rate raised')
  const raisedRate = await video.evaluate((element) => element.playbackRate)

  await page.locator('body').press('o')
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBeLessThan(raisedRate)
  await attachScreenshot('playback rate lowered')
})

for (const holdPlaybackRateMultiplier of [0, 3]) {
  test.describe(`seekbar shortcuts with hold to speed up ${holdPlaybackRateMultiplier ? 'enabled' : 'disabled'}`, () => {
    test.use({ seed: { settings: { ...PLAYER_SEED, holdPlaybackRateMultiplier } } })

    test('Space toggles playback after clicking the seekbar', async ({ app, page }) => {
      const video = await openDemoVideo({ app, page })
      const seekBar = page.locator(`${activeTab} .shaka-seek-bar`)
      for (const fullscreen of [false, true]) {
        await setPlayerFullscreen(page, fullscreen)
        await seekBar.hover()
        await seekBar.click({ position: { x: 100, y: 1 } })
        await expect(seekBar).toBeFocused()
        await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

        await page.keyboard.press('Space')
        await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
        await expect(seekBar).toBeFocused()

        const time = await video.evaluate(element => element.currentTime)
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(time + 5, 3)
        expect(await video.evaluate(element => element.paused)).toBe(true)

        await page.keyboard.press('Space')
        await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
        await expect(seekBar).toBeFocused()

        if (holdPlaybackRateMultiplier) {
          await page.keyboard.down('Space')
          try {
            await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(holdPlaybackRateMultiplier)
          } finally {
            await page.keyboard.up('Space')
          }
          await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)
          expect(await video.evaluate(element => element.paused)).toBe(false)
        }
      }
    })
  })
}

test('other player shortcuts remain available after clicking the seekbar', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const seekBar = page.locator(`${activeTab} .shaka-seek-bar`)
  await seekBar.hover()
  await seekBar.click({ position: { x: 100, y: 1 } })
  await expect(seekBar).toBeFocused()

  await page.keyboard.press('k')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

  const muted = await video.evaluate(element => element.muted)
  await page.keyboard.press('m')
  await expect.poll(() => video.evaluate(element => element.muted)).toBe(!muted)
  await page.keyboard.press('m')
  await expect.poll(() => video.evaluate(element => element.muted)).toBe(muted)

  await page.keyboard.press('p')
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)
  await page.keyboard.press('o')
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)

  await page.keyboard.press('5')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(
    await video.evaluate(element => element.duration / 2), 3
  )
  await page.keyboard.press('Home')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(0)

  await page.keyboard.press('f')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
  await expect(seekBar).toBeFocused()
  await page.keyboard.press('f')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)

  await page.keyboard.press('k')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('seekbar dragging preserves paused and playing states', { tag: '@scale' }, async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const seekBar = page.locator(`${activeTab} .shaka-seek-bar`)
  for (const paused of [true, false]) {
    await video.evaluate((element, paused) => paused ? element.pause() : element.play(), paused)
    await seekBar.hover()
    const bounds = await seekBar.boundingBox()
    await page.mouse.move(bounds.x + 6 + (bounds.width - 12) * 0.2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 6 + (bounds.width - 12) * 0.6, bounds.y + bounds.height / 2, { steps: 5 })
    await page.mouse.up()
    const duration = await video.evaluate(element => element.duration)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(duration * 0.58)
    expect(await video.evaluate(element => element.currentTime)).toBeLessThan(duration * 0.7)
    expect(await video.evaluate(element => element.paused)).toBe(paused)
  }
})

test('clicking the seekbar during playback seeks only once', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const seekBar = page.locator(`${activeTab} .shaka-seek-bar`)
  await seekBar.hover()
  await video.evaluate(element => {
    window.seekingEvents = 0
    element.addEventListener('seeking', () => window.seekingEvents++)
  })
  await seekBar.click({ position: { x: 200, y: 1 } })
  // A repeated seek would restart the audio that already played at the target.
  await expect.poll(() => video.evaluate(element => !element.seeking && !element.paused && element.readyState >= 3)).toBe(true)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.seekingEvents)).toBe(1)
})

test('player shortcuts do not run while typing in focused inputs or selects', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const search = page.locator(sel.searchInput)
  await search.fill('')
  await search.pressSequentially('k f m ')
  await expect(search).toHaveValue('k f m ')
  expect(await video.evaluate(element => element.paused)).toBe(false)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  await goTo(page, 'settings')

  const region = page.getByRole('combobox', { name: 'Region for Trending' })
  await region.focus()
  await expect(region).toHaveAttribute('aria-expanded', 'false')
  await region.pressSequentially('kenya')
  await expect(region.locator('.selectedValue')).toHaveText('Kenya')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

  await region.click()
  await expect(region).toHaveAttribute('aria-expanded', 'true')

  await region.pressSequentially('kenya')

  await expect(region).toHaveAttribute('aria-activedescendant', /-option-\d+$/)
  const activeOptionId = await region.getAttribute('aria-activedescendant')
  await expect(page.locator(`#${activeOptionId}`)).toHaveText('Kenya')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test.describe('player wheel gestures', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        displayVideoPlayButton: true,
        videoVolumeMouseScroll: false,
        videoSkipMouseScroll: true,
        videoPlaybackRateMouseScroll: true,
      }
    }
  })

  for (const gesture of ['seek', 'speed']) {
    test(`scroll-to-${gesture} works across the video with controls shown and hidden`, async ({ app, page }) => {
      const video = await openDemoVideo({ app, page })
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      const controls = player.locator('.shaka-controls-container')
      await video.evaluate(element => {
        element.pause()
        element.currentTime = 10
        element.playbackRate = 1.25
      })
      // Corners and center of the video, above the bottom control toolbar.
      const points = [[0.2, 0.25], [0.8, 0.25], [0.5, 0.45], [0.2, 0.65], [0.8, 0.65]]
      for (const fullscreen of [false, true]) {
        await setPlayerFullscreen(page, fullscreen)
        const bounds = await player.boundingBox()
        for (const shown of [false, true]) {
          for (const [horizontal, vertical] of points) {
            const point = { x: bounds.x + bounds.width * horizontal, y: bounds.y + bounds.height * vertical }
            await page.mouse.move(point.x, point.y)
            const scrollY = await page.evaluate(() => window.scrollY)
            const value = () => video.evaluate((element, gesture) => gesture === 'seek' ? element.currentTime : element.playbackRate, gesture)
            if (gesture === 'speed') await page.keyboard.down('Control')
            try {
              for (const [delta, expected] of [[-120, gesture === 'seek' ? 15 : 1.3], [120, gesture === 'seek' ? 10 : 1.25]]) {
                await controls.evaluate((element, shown) => {
                  if (shown) element.setAttribute('shown', 'true')
                  else element.removeAttribute('shown')
                }, shown)
                const target = await page.evaluate(point => {
                  const element = document.elementFromPoint(point.x, point.y)
                  return `${element.tagName}.${element.getAttribute('class')}`
                }, point)
                await page.mouse.wheel(0, delta)
                await expect.poll(value, { message: `${gesture} over ${target}; fullscreen=${fullscreen}, controls shown=${shown}` }).toBe(expected)
                expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
              }
            } finally {
              if (gesture === 'speed') await page.keyboard.up('Control')
            }
          }
        }
      }
    })
  }

  test('scroll-to-seek works over the center play icon', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => { element.pause(); element.currentTime = 10 })
    const icon = page.locator(`${activeTab} .shaka-big-buttons-container .shaka-play-button svg`).first()
    for (const fullscreen of [false, true]) {
      await setPlayerFullscreen(page, fullscreen)
      await icon.hover()
      await page.mouse.wheel(0, -120)
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(15)
      await page.mouse.wheel(0, 120)
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(10)
    }
  })

  test('scroll-to-speed works over the center play icon', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => { element.pause(); element.playbackRate = 1.25 })
    const icon = page.locator(`${activeTab} .shaka-big-buttons-container .shaka-play-button svg`).first()
    for (const fullscreen of [false, true]) {
      await setPlayerFullscreen(page, fullscreen)
      await icon.hover()
      for (const modifier of ['Control', 'Meta']) {
        await page.keyboard.down(modifier)
        try {
          await page.mouse.wheel(0, -120)
          await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.3)
          await page.mouse.wheel(0, 120)
          await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)
        } finally {
          await page.keyboard.up(modifier)
        }
      }
    }
  })
})

test('mobile speed holds pass through hidden center buttons and restore playback on release', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator('.app').evaluate(element => {
    const mobile = () => {
      for (const name of ['capacitorTabs', 'capacitorTabletLayout']) {
        if (!element.classList.contains(name)) element.classList.add(name)
      }
    }
    new MutationObserver(mobile).observe(element, { attributeFilter: ['class'] })
    mobile()
  })
  const video = await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const controls = player.locator('.shaka-controls-container')
  const playButton = player.locator('.shaka-big-buttons-container .shaka-play-button')
  const session = await page.context().newCDPSession(page)
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [point] : [],
  })
  try {
    for (const fullscreen of [false, true]) {
      await setPlayerFullscreen(page, fullscreen)
      await video.evaluate(element => { element.loop = true; element.playbackRate = 1.25; return element.play() })
      await controls.evaluate(element => element.removeAttribute('shown'))
      await expect(playButton).toHaveCSS('opacity', '0')
      const bounds = await playButton.boundingBox()
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      await touch('touchStart', center)
      await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(2.5)
      await touch('touchEnd')
      await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)
      expect(await video.evaluate(element => element.paused)).toBe(false)
      await expect(controls).not.toHaveAttribute('shown')

      // Let the hold's release-click suppression expire before a fresh tap.
      await page.waitForTimeout(400)
      // A short tap reveals controls; the visible center button still pauses.
      await touch('touchStart', center)
      await touch('touchEnd')
      await expect(controls).toHaveAttribute('shown', 'true')
      await playButton.click()
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
    }
  } finally {
    await touch('touchCancel').catch(() => {})
    await session.detach()
  }
})

test('keeps video zoom within its tab', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
  await attachScreenshot('zoomed video')

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  // Recreating the player for another video in the same tab keeps that tab's
  // zoom level.
  const nextVideoInTab = await openMockedVideo(page, 'aqz-KE-bpKQ')
  await expect(nextVideoInTab).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  // A new tab starts at the default zoom instead of inheriting another
  // player's level.
  await page.locator('.tabBar .newTabButton').click()
  await expect(page.locator('.tabBar .tab')).toHaveCount(2)
  const nextVideo = await openMockedVideo(page)
  await expect(nextVideo).toHaveCSS('transform', 'none')

  await page.locator('body').press('z')
  await expect(nextVideo).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')

  const tabs = page.locator('.tabBar .tab')
  await tabs.first().click()
  await expect(page.locator(`${activeTab} video`)).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  await tabs.last().click()
  await expect(page.locator(`${activeTab} video`)).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
})

test('pinch zoom starts over the paused player controls without toggling playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = window.$store
    return store.dispatch('updateDisplayVideoPlayButton', true)
  })
  const video = await openMockedVideo(page)
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))

  for (let step = 0; step < 4; step++) await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 0, 0)')
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect(player).toHaveCSS('touch-action', 'none')
  const zoomedBox = await video.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(zoomedBox.x + zoomedBox.width / 2, zoomedBox.y + zoomedBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(zoomedBox.x + zoomedBox.width / 2 - 60, zoomedBox.y + zoomedBox.height / 2)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await video.evaluate(element => element.pause())

  const playIcon = player.locator('.shaka-big-buttons-container .shaka-play-button path').first()
  await expect(playIcon).toBeVisible()
  const [iconBox, playerBox] = await Promise.all([
    playIcon.boundingBox(),
    player.boundingBox(),
  ])
  const first = {
    x: iconBox.x + iconBox.width / 2,
    y: iconBox.y + iconBox.height / 2,
  }
  const second = {
    x: Math.min(first.x + 70, playerBox.x + playerBox.width - 20),
    y: first.y,
  }
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, first)).toBe('path')

  const startGeometry = await video.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return {
      zoom: matrix.a,
      translation: { x: matrix.e, y: matrix.f },
      center: {
        x: bounds.left + bounds.width / 2 - matrix.e,
        y: bounds.top + bounds.height / 2 - matrix.f,
      },
    }
  })
  await player.evaluate(element => {
    const pointers = { start: new Map(), current: new Map(), pinchStart: null }
    globalThis.__playerPinchTestPointers = pointers
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return
      const point = { x: event.clientX, y: event.clientY }
      pointers.start.set(event.pointerId, point)
      pointers.current.set(event.pointerId, point)
      if (pointers.current.size === 2) {
        pointers.pinchStart = [...pointers.current.values()]
      }
    }, true)
    element.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }
    }, true)
  })

  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...first, id: 1 }],
  })
  await page.waitForTimeout(200)
  const firstAtPinch = { x: first.x + 12, y: first.y, id: 1 }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [firstAtPinch],
  })
  await page.waitForTimeout(80)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [firstAtPinch, { ...second, id: 2 }],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: firstAtPinch.x - 50, y: firstAtPinch.y, id: 1 },
      { x: second.x + 50, y: second.y, id: 2 },
    ],
  })

  await expect.poll(() => video.evaluate(element => {
    return new DOMMatrix(getComputedStyle(element).transform).a
  })).toBeGreaterThan(startGeometry.zoom)
  const pinchTransform = await video.evaluate(element => {
    const { a: scale, e: x, f: y } = new DOMMatrix(getComputedStyle(element).transform)
    return { scale, x, y }
  })
  const pointerCoordinates = await page.evaluate(() => {
    const pointers = globalThis.__playerPinchTestPointers
    return {
      start: [...pointers.start.values()],
      current: [...pointers.current.values()],
      pinchStart: pointers.pinchStart,
    }
  })
  expect(pointerCoordinates.start).toHaveLength(2)
  expect(pointerCoordinates.current).toHaveLength(2)
  expect(pointerCoordinates.pinchStart).toHaveLength(2)
  const startFocal = {
    x: (pointerCoordinates.pinchStart[0].x + pointerCoordinates.pinchStart[1].x) / 2 - startGeometry.center.x,
    y: (pointerCoordinates.pinchStart[0].y + pointerCoordinates.pinchStart[1].y) / 2 - startGeometry.center.y,
  }
  const currentFocal = {
    x: (pointerCoordinates.current[0].x + pointerCoordinates.current[1].x) / 2 - startGeometry.center.x,
    y: (pointerCoordinates.current[0].y + pointerCoordinates.current[1].y) / 2 - startGeometry.center.y,
  }
  const content = {
    x: (startFocal.x - startGeometry.translation.x) / startGeometry.zoom,
    y: (startFocal.y - startGeometry.translation.y) / startGeometry.zoom,
  }
  expect(pinchTransform.scale).toBeGreaterThan(1)
  expect(pinchTransform.x).toBeCloseTo(currentFocal.x - pinchTransform.scale * content.x, 0)
  expect(pinchTransform.y).toBeCloseTo(currentFocal.y - pinchTransform.scale * content.y, 0)

  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()

  const persistedTransform = await video.evaluate(element => {
    const { a: scale, e: x, f: y } = new DOMMatrix(getComputedStyle(element).transform)
    return { scale, x, y }
  })
  expect(persistedTransform.scale).toBeCloseTo(pinchTransform.scale, 4)
  expect(persistedTransform.x).toBeCloseTo(currentFocal.x - persistedTransform.scale * content.x, 0)
  expect(persistedTransform.y).toBeCloseTo(currentFocal.y - persistedTransform.scale * content.y, 0)
  await expect(player.locator('.video-zoom-button')).toHaveAttribute(
    'shaka-status',
    `${Math.round(persistedTransform.scale * 100)}%`
  )
  expect(await video.evaluate(element => element.paused)).toBe(true)

  await player.locator('.shaka-big-buttons-container .shaka-play-button').click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('volume boost amplifies the audio within its tab', async ({ app, page, attachScreenshot }) => {
  // The demo media is silent, so record the audio graph and multiply the gains
  // between each player's media element and the output.
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect
    window.__volumeBoostSources = []
    AudioNode.prototype.connect = function (target, ...args) {
      (this.__targets ??= []).push(target)
      if (this instanceof MediaElementAudioSourceNode && !window.__volumeBoostSources.includes(this)) {
        window.__volumeBoostSources.push(this)
      }
      return connect.call(this, target, ...args)
    }
  })
  const sourceCount = () => page.evaluate(() => window.__volumeBoostSources.length)
  const outputGain = (sourceIndex = -1) => page.evaluate((sourceIndex) => {
    const gainTo = (node) => {
      if (node === node.context.destination) return 1
      const own = node instanceof GainNode ? node.gain.value : 1
      const paths = (node.__targets ?? []).map(gainTo).filter(gain => gain !== null)
      return paths.length === 1 ? own * paths[0] : null
    }
    const gain = gainTo(window.__volumeBoostSources.at(sourceIndex))
    return gain === null ? null : Math.round(gain * 100) / 100
  }, sourceIndex)

  // About 6 dB halves the amplitude.
  await openDemoVideo({ app, page }, { loudnessDb: { 'aqz-KE-bpKQ': 20 * Math.log10(2) } })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await openPlayerOptions(player)
  const boostButton = player.locator('.shaka-overflow-menu .volume-boost-button')
  // Volume boost is opt-in.
  await expect(player.locator('.shaka-overflow-menu')).toBeVisible()
  await expect(boostButton).toHaveCount(0)
  await page.evaluate(() => window.$store.dispatch('updateShowVolumeBoostToggle', true))
  // Rebuilding the controls closes the menu.
  await expect(player.locator('.shaka-overflow-menu')).toBeHidden()
  await player.hover()
  await openPlayerOptions(player)
  await expect(boostButton).toContainText('Off')
  // The player only routes its audio through Web Audio once it is boosted.
  expect(await sourceCount()).toBe(0)

  // The icon follows the selected icon pack.
  const boostIcon = boostButton.locator(':scope > svg')
  await expect(boostIcon.locator('path')).not.toHaveCount(0)
  const materialIcon = await boostIcon.innerHTML()
  await page.evaluate(() => window.$store.dispatch('updateIconPack', 'remix'))
  await expect.poll(() => boostIcon.innerHTML()).not.toBe(materialIcon)
  await expect(boostIcon.locator('path')).not.toHaveCount(0)

  await boostButton.click()
  const boostMenu = player.locator('.volume-boost-menu')
  await expect(boostMenu.getByRole('button')).toHaveText(['Volume Boost', 'Off', '125%', '150%', '175%', '200%'])
  await attachScreenshot('volume boost menu')
  await boostMenu.getByRole('button', { name: '150%' }).click()
  await expect.poll(outputGain).toBe(1.5)
  expect(await sourceCount()).toBe(1)

  // Choosing a level returns to the overflow menu, which shows it.
  await expect(boostButton).toContainText('150%')
  await boostButton.click()
  await expect(boostMenu.getByRole('button', { name: '150%' })).toHaveAttribute('aria-selected', 'true')
  await boostMenu.getByRole('button', { name: '200%' }).click()
  await expect.poll(outputGain).toBe(2)

  // Another video in the same tab keeps the boost, and loudness
  // normalization turns it down because YouTube reports it as louder.
  await openMockedVideo(page, 'aqz-KE-bpKQ')
  await expect.poll(sourceCount).toBe(2)
  await expect.poll(outputGain).toBe(1)
  await page.evaluate(() => window.$store.dispatch('updateNormalizeLoudness', false))
  await expect.poll(outputGain).toBe(2)

  // A new tab starts without a boost.
  await page.locator('.tabBar .newTabButton').click()
  await expect(page.locator('.tabBar .tab')).toHaveCount(2)
  const nextPlayer = page.locator(`${activeTab} .ftVideoPlayer`)
  await openMockedVideo(page)
  await nextPlayer.hover()
  await openPlayerOptions(nextPlayer)
  await expect(nextPlayer.locator('.volume-boost-button')).toContainText('Off')
  expect(await sourceCount()).toBe(2)

  // Hiding the toggle again also stops boosting the background tab.
  await page.evaluate(() => window.$store.dispatch('updateShowVolumeBoostToggle', false))
  await expect(nextPlayer.locator('.volume-boost-button')).toHaveCount(0)
  await expect.poll(() => outputGain(1)).toBe(1)

  // Showing it again does not resume the earlier boost.
  await page.evaluate(() => window.$store.dispatch('updateShowVolumeBoostToggle', true))
  await nextPlayer.hover()
  await openPlayerOptions(nextPlayer)
  await expect(nextPlayer.locator('.volume-boost-button')).toContainText('Off')
  await expect.poll(() => outputGain(1)).toBe(1)
})

test('mono audio plays every channel in both ears', async ({ app, page, attachScreenshot }) => {
  // The demo media is silent, so record the audio graph, follow the player's
  // chain to the node that feeds the output, and render a left-only signal
  // through that node's channel configuration.
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect
    window.__playerSources = []
    AudioNode.prototype.connect = function (target, ...args) {
      (this.__targets ??= []).push(target)
      if (this instanceof MediaElementAudioSourceNode) {
        window.__playerSources.push(this)
      }
      return connect.call(this, target, ...args)
    }
  })
  const leftOnlyOutput = () => page.evaluate(async () => {
    let node = window.__playerSources.at(-1)
    if (!node) return null
    while (node.__targets[0] !== node.context.destination) {
      node = node.__targets[0]
    }
    const context = new OfflineAudioContext(2, 128, 48000)
    const buffer = context.createBuffer(2, 128, 48000)
    buffer.getChannelData(0).fill(1)
    const source = context.createBufferSource()
    source.buffer = buffer
    const output = context.createGain()
    output.channelCount = node.channelCount
    output.channelCountMode = node.channelCountMode
    output.channelInterpretation = node.channelInterpretation
    source.connect(output).connect(context.destination)
    source.start()
    const rendered = await context.startRendering()
    return [rendered.getChannelData(0)[0], rendered.getChannelData(1)[0]]
  })

  await openDemoVideo({ app, page })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await openPlayerOptions(player)
  const monoButton = player.locator('.shaka-overflow-menu .mono-audio-button')
  // The mono audio toggle is opt-in.
  await expect(player.locator('.shaka-overflow-menu')).toBeVisible()
  await expect(monoButton).toHaveCount(0)
  await page.evaluate(() => window.$store.dispatch('updateShowMonoAudioToggle', true))
  // Rebuilding the controls closes the menu.
  await expect(player.locator('.shaka-overflow-menu')).toBeHidden()
  await player.hover()
  await openPlayerOptions(player)
  await expect(monoButton).toHaveAttribute('aria-pressed', 'false')
  // The player only routes its audio through Web Audio once mono is on.
  expect(await leftOnlyOutput()).toBeNull()

  await monoButton.click()
  await expect(monoButton).toHaveAttribute('aria-pressed', 'true')
  await attachScreenshot('mono audio toggle')
  await expect.poll(leftOnlyOutput).toEqual([0.5, 0.5])
  expect(await page.evaluate(() => window.$store.getters.getMonoAudio)).toBe(true)

  // The setting applies to every video, so the next one starts in mono.
  await openMockedVideo(page, 'aqz-KE-bpKQ')
  await expect.poll(() => page.evaluate(() => window.__playerSources.length)).toBe(2)
  await expect.poll(leftOnlyOutput).toEqual([0.5, 0.5])

  await player.hover()
  await openPlayerOptions(player)
  await monoButton.click()
  await expect(monoButton).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(leftOnlyOutput).toEqual([1, 0])

  // Hiding the toggle leaves the setting itself in charge.
  await page.evaluate(() => window.$store.dispatch('updateMonoAudio', true))
  await expect.poll(leftOnlyOutput).toEqual([0.5, 0.5])
  await page.evaluate(() => window.$store.dispatch('updateShowMonoAudioToggle', false))
  await expect(monoButton).toHaveCount(0)
  await expect.poll(leftOnlyOutput).toEqual([0.5, 0.5])
})

test.describe('mobile player menus', { tag: '@scale' }, () => {
  test('options and submenus stay above the center play button', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator('.app').evaluate(element => {
      const applyMobileClass = () => element.classList.add('capacitorTabs')
      new MutationObserver(() => {
        if (!element.classList.contains('capacitorTabs')) applyMobileClass()
      }).observe(element, { attributeFilter: ['class'] })
      applyMobileClass()
    })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await setWindowSize(app, page, { width: 450, height: 850 })

    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const centerButton = player.locator('.shaka-big-buttons-container .shaka-play-button')
    await player.hover()
    await expect(centerButton).toBeVisible()
    await openPlayerOptions(player)
    const menu = player.locator('.shaka-overflow-menu')
    await attachScreenshot('mobile options menu above center play button')
    await expectOverlayAbovePlayer(centerButton, menu)

    await menu.getByRole('button', { name: 'Zoom' }).click()
    const submenu = player.locator('.video-zoom-menu')
    await expectOverlayAbovePlayer(centerButton, submenu)
    await submenu.getByRole('button', { name: 'Off', exact: true }).click()
    await expect(submenu).toBeHidden()
    await expect(menu).toBeVisible()
    await player.locator('.phonePlayerOptions[open]').press('Escape')
    await expect(menu).toBeHidden()
    await centerButton.click()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  })
})

test('mobile fullscreen keeps menus and SponsorBlock notices above the action dock', async ({ app, page }) => {
  await openDemoVideo({ app, page })
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const actions = player.locator('.fullscreenActions')
  await page.locator('body').press('s')
  await player.hover()
  await expect(actions).toBeVisible()

  await openPlayerOptions(player)
  await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Zoom' }).click()
  await expect(player.locator('.video-zoom-menu')).toBeVisible()
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('pointer-events', 'none')

  const layers = await player.evaluate(element => {
    const notice = document.createElement('div')
    notice.className = 'skippedSegmentsWrapper'
    element.append(notice)
    const result = {
      actions: Number(getComputedStyle(element.querySelector('.fullscreenActions')).zIndex),
      notice: Number(getComputedStyle(notice).zIndex),
      controls: Number(getComputedStyle(element.querySelector('.shaka-controls-container')).zIndex),
    }
    notice.remove()
    return result
  })
  expect(layers.notice).toBeGreaterThan(layers.actions)
  expect(layers.controls).toBeGreaterThan(layers.notice)
})

test('auto-translates captions into an arbitrary language', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await openPlayerOptions(player)

  const overflowMenu = player.locator('.shaka-overflow-menu')
  await openCaptionLanguages(player)
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()

  const translationMenu = player.locator('.ft-caption-translation-menu')
  const header = translationMenu.locator(':scope > .shaka-back-to-overflow-button')
  const translations = translationMenu.locator('.ft-caption-translation-options')
  await expect(translationMenu).toBeVisible()
  await expect(translations).toHaveClass(/ft-menu-grid/)
  await expect(translations.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  await expect(overflowMenu.locator(':scope > .os-scrollbar-vertical')).toHaveCSS('display', 'none')
  expect(await translations.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)

  const [headerBounds, translationsBounds, scrollbarBounds] = await Promise.all([
    header.boundingBox(),
    translations.boundingBox(),
    translations.locator(':scope > .os-scrollbar-vertical').boundingBox(),
  ])
  expect(translationsBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1)
  expect(scrollbarBounds.y).toBeGreaterThanOrEqual(translationsBounds.y - 1)

  await translations.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => translations.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await attachScreenshot('auto-translate language grid')

  const isFrenchCaptions = url => url.pathname === '/api/timedtext' && url.searchParams.get('tlang') === 'fr'
  const frenchResponse = page.waitForResponse(response => isFrenchCaptions(new URL(response.url())))
  // Selecting a language closes the menu once its captions load. Hold French
  // until German is chosen, so the later choice always overtakes the earlier one.
  let releaseFrench
  const frenchHeld = new Promise(resolve => { releaseFrench = resolve })
  await page.route(isFrenchCaptions, async route => {
    await frenchHeld
    await route.fallback()
  })
  await translations.getByRole('button', { name: 'French' }).click()
  await translations.getByRole('button', { name: 'German' }).click()
  releaseFrench()
  await expect(player.locator('.shaka-text-languages')).toBeVisible()
  expect(await overflowMenu.evaluate(element => element.scrollTop)).toBe(0)
  await expect(player.locator('.shaka-text-languages')).toContainText('German')
  await frenchResponse
  await expect(player.locator('.shaka-text-languages')).toContainText('German')

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateUsePlayerMenuGrid', false)
    await component.proxy.$nextTick()
  })
  await page.keyboard.press('Escape')
  await player.hover()
  await openPlayerOptions(player)
  await openCaptionLanguages(player)
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
  await expect(translations).not.toHaveClass(/ft-menu-grid/)
  const selectedTranslation = translations.getByRole('button', { name: 'German' })
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'true')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(2)

  const [listBounds, languageBounds] = await Promise.all([
    translations.boundingBox(),
    translations.getByRole('button', { name: 'Afrikaans' }).boundingBox(),
  ])
  expect(Math.abs(languageBounds.x - listBounds.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(languageBounds.width - listBounds.width)).toBeLessThanOrEqual(1)

  await header.click()
  const captionsMenu = player.locator('.shaka-text-languages')
  await captionsMenu.getByRole('button', { name: 'Off' }).click()
  await openCaptionLanguages(player)
  await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'false')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(0)

  await header.click()
  await captionsMenu.getByRole('menuitemradio', { name: 'English (auto-generated)', exact: true }).click()
  await openCaptionLanguages(player)
  await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'false')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(0)

  const nextVideoId = 'aqz-KE-bpKQ'
  await openMockedVideo(page, nextVideoId)
  await player.hover()
  await openPlayerOptions(player)
  await openCaptionLanguages(player)
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
  const nextVideoTranslationRequest = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/timedtext' &&
      url.searchParams.get('v') === nextVideoId &&
      url.searchParams.get('tlang') === 'de'
  })
  await translations.getByRole('button', { name: 'German' }).click()
  await nextVideoTranslationRequest
  await watchComponent.dispose()
})

test('keeps the context menu open when the pointer leaves a playing video', async ({ app, page, attachScreenshot }) => {
  await openDemoVideo({ app, page })
  await page.locator('.ftVideoPlayer').click({ button: 'right' })

  const contextMenu = page.locator('.shaka-context-menu')
  await expect(contextMenu).toBeVisible()
  await attachScreenshot('player context menu')

  await page.mouse.move(0, 0)
  // Outlast the controls hide delay before checking that the menu stays open.
  await page.waitForTimeout(3500)
  await expect(contextMenu).toBeVisible()
  await attachScreenshot('context menu after the pointer left')
})

test('scopes the mobile fullscreen swipe movement to the video in tablet layout', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const appRoot = page.locator('.app')
  const player = page.locator(`${activeTab} .ftVideoPlayer`)

  await appRoot.evaluate(element => element.classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await expect(appRoot).toHaveCSS('touch-action', 'auto')
  await expect(player).toHaveClass(/mobileFullscreenSwipeEnabled/)
  await expect(player).toHaveCSS('touch-action', 'none')

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateEnableVideoZoom', false)
  })
  await expect(player).toHaveCSS('touch-action', 'pan-x')

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateEnableMobileFullscreenSwipe', false)
  })
  await expect(player).not.toHaveClass(/mobileFullscreenSwipeEnabled/)
  // Downward mini-player swipes remain enabled independently of fullscreen.
  await expect(player).toHaveCSS('touch-action', 'pan-x pan-down')

  await player.evaluate(element => {
    element.classList.add('mobileFullscreenSwiping')
    element.style.setProperty('--mobile-fullscreen-swipe-offset', '-42px')
  })
  await expect(video).toHaveCSS('translate', '0px -42px')
  await expect(player).toHaveCSS('transform', 'none')
})

test('uses mobile surface taps for controls and keeps an on-video play button', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const appRoot = page.locator('.app')
  await appRoot.evaluate(element => {
    const applyMobileClasses = () => {
      if (!element.classList.contains('capacitorTabs')) element.classList.add('capacitorTabs')
      if (!element.classList.contains('capacitorTabletLayout')) element.classList.add('capacitorTabletLayout')
    }
    new MutationObserver(applyMobileClasses).observe(element, { attributeFilter: ['class'] })
    applyMobileClasses()
  })
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateRememberVolume', false)
    await store.dispatch('updateDefaultVolume', 0.25)
    // Outlast the expect timeout so only a tap can hide the playing controls.
    await store.dispatch('updatePlayingInterfaceHideDelay', 60)
  })
  const video = await openMockedVideo(page)
  await expect.poll(() => appRoot.evaluate(element => Math.abs(
    element.getBoundingClientRect().width - window.innerWidth
  ))).toBeLessThanOrEqual(1)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const surface = player.locator('.shaka-controls-container')
  const playButtons = player.locator('.shaka-big-buttons-container .shaka-play-button')

  await surface.evaluate(element => element.setAttribute('casting', 'true'))
  await expect(playButtons).toHaveCount(1)
  await expect(player.locator('.shaka-controls-button-panel .shaka-play-button')).toBeHidden()
  await expect(player.locator('.shaka-controls-button-panel .shaka-pip-button')).toBeVisible()
  await expect(player.locator('.shaka-settings-menu .shaka-pip-button')).toHaveCount(0)
  await expect(player.locator('.shaka-mute-button, .shaka-volume-bar-container')).toHaveCount(0)
  await expect.poll(() => video.evaluate(element => ({ muted: element.muted, volume: element.volume })))
    .toEqual({ muted: false, volume: 1 })
  await surface.evaluate(element => element.removeAttribute('casting'))
  await video.evaluate(element => element.play())
  await surface.evaluate(element => element.setAttribute('shown', 'true'))

  let pointerId = 1
  const tapPlayer = async (relativeX = 0.5) => {
    const bounds = await player.boundingBox()
    if (!bounds) throw new Error('player is not visible')
    const clientX = bounds.x + bounds.width * relativeX
    const clientY = bounds.y + bounds.height * 0.42
    const currentPointerId = pointerId++

    return await surface.evaluate((element, { clientX, clientY, pointerId }) => {
      const pointer = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
        isPrimary: true,
        pointerId,
        pointerType: 'touch'
      }
      // Create every event before dispatching so their timestamps describe a
      // quick tap even when the handlers of earlier events run slowly.
      const events = [
        new PointerEvent('pointerdown', pointer),
        new TouchEvent('touchstart', {
          bubbles: true,
          touches: [new Touch({ identifier: pointerId, target: element, clientX, clientY })]
        }),
        new PointerEvent('pointerup', pointer),
        new TouchEvent('touchend', { bubbles: true, cancelable: true })
      ]
      const touchEnd = events.pop()
      for (const event of events) element.dispatchEvent(event)
      return !element.dispatchEvent(touchEnd)
    }, { clientX, clientY, pointerId: currentPointerId })
  }

  expect(await tapPlayer()).toBe(true)
  await expect(surface).not.toHaveAttribute('shown')
  expect(await video.evaluate(element => element.paused)).toBe(false)
  await page.evaluate(() => window.$store.dispatch('updatePlayingInterfaceHideDelay', 3))

  expect(await tapPlayer()).toBe(true)
  await expect(surface).toHaveAttribute('shown', 'true')
  await page.waitForTimeout(1000)
  await expect(surface).toHaveAttribute('shown', 'true')
  expect(await video.evaluate(element => element.paused)).toBe(false)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()

  await surface.evaluate(element => element.removeAttribute('shown'))
  await video.evaluate(element => element.pause())
  await expect(surface).toHaveAttribute('shown', 'true')
  // Paused controls stay shown on their own, so only the tap can hide them.
  expect(await tapPlayer()).toBe(true)
  await expect(surface).not.toHaveAttribute('shown')
  expect(await video.evaluate(element => element.paused)).toBe(true)

  expect(await tapPlayer(0.85)).toBe(true)
  await expect(surface).toHaveAttribute('shown', 'true')
  // Space the taps so they are not handled as a double tap.
  await page.waitForTimeout(500)
  // Side taps wait out the double-tap window before hiding; a double tap would
  // seek instead and leave the paused controls shown.
  expect(await tapPlayer(0.85)).toBe(true)
  await expect(surface).not.toHaveAttribute('shown')

  expect(await tapPlayer()).toBe(true)
  await expect(surface).toHaveAttribute('shown', 'true')

  await video.evaluate(element => {
    Object.defineProperty(element, 'ended', { configurable: true, value: true })
    element.dispatchEvent(new Event('ended'))
  })
  await expect(surface).toHaveAttribute('shown', 'true')
  expect(await tapPlayer()).toBe(true)
  await page.waitForTimeout(3500)
  await expect(surface).toHaveAttribute('shown', 'true')
  await expect(player.locator('.shaka-controls-button-panel')).toHaveCSS('opacity', '1')
  await expect(player.locator('.shaka-seek-bar-container')).toHaveCSS('opacity', '1')

  await player.evaluate(element => element.classList.add('fullWindow'))
  const mobileCenterButtonWidth = await playButtons.last().evaluate(element => (
    element.getBoundingClientRect().width
  ))
  expect(mobileCenterButtonWidth).toBeGreaterThanOrEqual(48)
  expect(mobileCenterButtonWidth).toBeLessThanOrEqual(64)
})

test('keeps mobile double-tap seek zones on the video beside the fullscreen queue', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator('.app').evaluate(element => {
    const applyMobileClass = () => {
      if (!element.classList.contains('capacitorTabs')) element.classList.add('capacitorTabs')
    }
    new MutationObserver(applyMobileClass).observe(element, { attributeFilter: ['class'] })
    applyMobileClass()
  })
  const video = await openMockedVideo(page)
  await page.evaluate(() => window.$store.commit('addVideoToWatchQueue', {
    video: { videoId: 'queued00000', title: 'Queued video', author: 'Queue channel' }
  }))
  await video.evaluate(element => element.pause())
  // A landscape phone, where the queue takes about 40% of the player.
  await setWindowSize(app, page, { width: 900, height: 400 })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await page.locator('body').press('s')
  await expect(player).toHaveClass(/fullWindow/)
  const surface = player.locator('.shaka-controls-container')
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => component.proxy.$refs.player.setFullscreenQueue(true))
  await expect(player.locator('.fullscreenQueueOverlay.open')).toBeVisible()
  await expect.poll(() => player.evaluate(element => (
    element.querySelector('.shaka-controls-container').getBoundingClientRect().right -
    element.querySelector('.fullscreenQueueOverlay').getBoundingClientRect().left
  ))).toBeLessThanOrEqual(0)

  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [point] : []
  })
  try {
    // Zones split the visible video, not the player that also holds the queue.
    for (const [relativeX, direction] of [[0.9, 1], [0.1, -1], [0.5, 0]]) {
      await video.evaluate(element => { element.currentTime = 10 })
      const bounds = await surface.boundingBox()
      const point = { x: bounds.x + bounds.width * relativeX, y: bounds.y + bounds.height * 0.3 }
      expect(await page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.closest('.shaka-controls-container') !== null
      ), point)).toBe(true)
      for (let tap = 0; tap < 2; tap++) {
        await touch('touchStart', point)
        await touch('touchEnd')
      }
      await expect.poll(() => video.evaluate(element => Math.sign(element.currentTime - 10))).toBe(direction)
      // Separate the next location's taps from this double tap.
      await page.waitForTimeout(400)
    }
  } finally {
    await touch('touchCancel').catch(() => {})
    await cdp.detach()
  }
})

test('handles mobile title taps before Shaka can toggle fullscreen in tablet layout', async ({ app, page }) => {
  await openDemoVideo({ app, page })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const title = player.locator('.playerFullscreenTitleOverlay')

  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await setPlayerFullscreen(page, true)

  let pointerId = 20
  const tapAt = async (clientX, clientY, targetSelector) => {
    return await page.evaluate(({ clientX, clientY, pointerId, targetSelector }) => {
      const target = targetSelector === null
        ? document.elementFromPoint(clientX, clientY)
        : document.querySelector(targetSelector)
      if (!(target instanceof Element)) throw new Error('touch target is not visible')

      for (const type of ['pointerdown', 'pointerup']) {
        target.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          button: 0,
          clientX,
          clientY,
          isPrimary: true,
          pointerId,
          pointerType: 'touch'
        }))
      }

      return !target.dispatchEvent(new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true
      }))
    }, { clientX, clientY, pointerId: pointerId++, targetSelector })
  }

  const titleBounds = await title.boundingBox()
  if (!titleBounds) throw new Error('fullscreen title is not visible')
  const clientX = titleBounds.x + Math.min(titleBounds.width / 2, 120)
  const clientY = titleBounds.y + titleBounds.height / 2

  expect(await tapAt(clientX, clientY, '.playerFullscreenTitleOverlay')).toBe(true)
  await expect(player).toHaveClass(/fullscreenMetadataOpen/)
  await expect.poll(() => player.evaluate(element => document.fullscreenElement === element)).toBe(true)

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(component => component.proxy.$refs.player.setFullscreenMetadata(false))
  await expect(player).not.toHaveClass(/fullscreenMetadataOpen/)

  expect(await tapAt(clientX, clientY, '.playerFullscreenTitleOverlay')).toBe(true)
  await page.waitForTimeout(80)
  expect(await tapAt(clientX, clientY, null)).toBe(true)
  // Give Shaka's double-tap fullscreen toggle time to run if it was not suppressed.
  await page.waitForTimeout(320)

  await expect.poll(() => player.evaluate(element => document.fullscreenElement === element)).toBe(true)
  await watchComponent.dispose()
})

test.describe('scroll mini player', () => {
  test('a stationary touch reveals hidden mini-player controls without pausing', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    const player = page.locator('.ftVideoPlayer')
    await video.evaluate(element => element.play())
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await page.mouse.move(0, 0)
    const button = player.locator('.scrollMiniPlayPause')
    await expect(button).toHaveClass(/isHidden/, { timeout: 6000 })
    await expect(button).toHaveCSS('opacity', '0')
    const bounds = await player.boundingBox()
    const session = await page.context().newCDPSession(page)
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
    await expect(button).not.toHaveClass(/isHidden/)
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  })

  test('keeps a phone mini player above the bottom navigation', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    })

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.evaluate(() => {
      const app = document.querySelector('.app')
      app.classList.add('capacitorTabs', 'capacitorPhoneLayout')
      app.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
      document.querySelector('.tabBar')?.style.setProperty('display', 'none')
      window.dispatchEvent(new Event('resize'))
    })

    await expect(player).toHaveClass(/scrollMiniPlayer/)

    const expectBottomNavigationClearance = async () => {
      await expect.poll(async () => {
        const [playerBounds, navigationBounds] = await Promise.all([
          player.boundingBox(),
          page.locator('.sideNav').boundingBox()
        ])
        if (playerBounds == null || navigationBounds == null) {
          return Number.NEGATIVE_INFINITY
        }
        return navigationBounds.y - (playerBounds.y + playerBounds.height)
      }).toBeGreaterThanOrEqual(15)
    }

    await expectBottomNavigationClearance()

    const dragHandle = player.locator('.scrollMiniDragHandle')
    const dragStart = await dragHandle.boundingBox()
    if (!dragStart) throw new Error('scroll mini player drag handle is not visible')
    const dragX = dragStart.x + dragStart.width / 2
    const dragY = dragStart.y + dragStart.height / 2
    await dragHandle.dispatchEvent('pointerdown', {
      button: 0,
      clientX: dragX,
      clientY: dragY,
      pointerId: 1,
      pointerType: 'touch'
    })
    await page.evaluate(({ dragX }) => {
      for (const type of ['pointermove', 'pointerup']) {
        window.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          clientX: dragX,
          clientY: window.innerHeight,
          pointerId: 1,
          pointerType: 'touch'
        }))
      }
    }, { dragX })

    await expectBottomNavigationClearance()
  })

  test.describe('bottom tabs at fractional scale', () => {
    test.use({ seed: { settings: { ...PLAYER_SEED, tabBarPosition: 'bottom', uiScale: 125 } } })
    test('keeps the mini player above mobile navigation and bottom tabs', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      const player = page.locator('.ftVideoPlayer')
      await scrollBelowPlayer(player)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await setWindowSize(app, page, { width: 480, height: 800 })
      for (const overflowing of [false, true]) {
        if (overflowing) {
          await page.evaluate(async () => {
            for (let index = 0; index < 8; index++) {
              await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
            }
          })
          await expect(page.locator('.tabsContainer > .os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-visible/)
        }
        await page.locator('.sideNav a').first().evaluate(link => link.focus({ preventScroll: true }))
        await expect.poll(() => player.evaluate(element => {
          const playerBounds = element.getBoundingClientRect()
          const navigationBounds = document.querySelector('.sideNav').getBoundingClientRect()
          return navigationBounds.top - playerBounds.bottom
        })).toBeGreaterThanOrEqual(15)
      }
    })
  })

  for (const uiScale of [100, 125]) {
    test.describe(`mini-player transition at ${uiScale}% UI scale`, () => {
      test.use({ seed: { settings: { ...PLAYER_SEED, uiScale, ambientMode: true } } })

      test('keeps expensive player work out of the mini-player transition', { tag: '@performance' }, async ({ app, page }) => {
        const video = await openDemoVideo({ app, page })
        if (uiScale === 100) await video.evaluate(element => element.pause())
        const player = page.locator('.ftVideoPlayer')
        const watchComponent = await page.evaluateHandle(findWatchComponent)
        await watchComponent.evaluate(component => {
          window.miniTransitionState = component.refs.player.$.setupState
        })
        await watchComponent.dispose()

        await player.evaluate(element => {
          document.documentElement.dataset.reducedMotion = 'no-preference'
          window.miniTransitionWork = { readbacks: 0, rebuilds: 0, ambientFrames: 0 }
          window.miniSettledReadbacks = 0
          const state = window.miniTransitionState
          const nativeReadback = CanvasRenderingContext2D.prototype.getImageData
          CanvasRenderingContext2D.prototype.getImageData = function (...args) {
            if (state.scrollMiniPlayerAnimating) {
              window.miniTransitionWork.readbacks++
            } else if (state.scrollMiniPlayerActive && this.canvas.width === 9 && this.canvas.height === 3) {
              window.miniSettledReadbacks++
            }
            return nativeReadback.apply(this, args)
          }
          const nativeDraw = CanvasRenderingContext2D.prototype.drawImage
          CanvasRenderingContext2D.prototype.drawImage = function (...args) {
            if (state.scrollMiniPlayerAnimating && this.canvas.matches('.ambientCanvas, .ambientLayoutCanvas, .ambientFullscreenCanvas')) {
              window.miniTransitionWork.ambientFrames++
            }
            return nativeDraw.apply(this, args)
          }
          const controls = element.querySelector('.shaka-controls-button-panel')
          new MutationObserver(records => {
            window.miniTransitionWork.rebuilds += records.filter(record =>
              [...record.removedNodes].some(node => node.contains(controls) || node === controls)
            ).length
          }).observe(element, { childList: true, subtree: true })
        })

        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
        await scrollBelowPlayer(player)
        await expect(player).toHaveClass(/scrollMiniPlayer/)
        await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
        await expect.poll(() => page.evaluate(() => window.miniSettledReadbacks)).toBeGreaterThan(0)
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
        await cdp.detach()
        await expect(page.locator('.ambientCanvas')).toBeVisible()
        expect(await page.evaluate(() => window.miniTransitionWork)).toEqual({ readbacks: 0, rebuilds: 0, ambientFrames: 0 })
      })
    })
  }

  test.describe('mini-player transition', { tag: '@scale' }, () => {
    test.use({ seed: { settings: { ...PLAYER_SEED, ambientMode: true } } })

    test('adapts the inline controls after resizing the window while docked', async ({ app, page, uiScale }) => {
      const video = await openDemoVideo({ app, page })
      await video.evaluate(element => element.pause())
      const player = page.locator('.ftVideoPlayer')
      const fullWindow = player.locator('.shaka-controls-button-panel .full-window-button')
      await expect(fullWindow).toHaveCount(1)

      await scrollBelowPlayer(player)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      // Size the viewport in CSS pixels so the inline player stays clearly
      // below the 634px overflow-menu threshold at every UI scale.
      await setWindowSize(app, page, { width: Math.round(620 * uiScale / 100), height: Math.round(850 * uiScale / 100) })
      await expect(fullWindow).toHaveCount(1)

      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      await expect(fullWindow).toHaveCount(0)

      await setWindowSize(app, page, { width: 1600, height: 900 })
      await expect(fullWindow).toHaveCount(1)
    })
  })

  test('expands the mini player on double-click', { tag: '@scale' }, async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)

    // A double-click on a control keeps the mini player, even right after a
    // click on the video.
    for (const control of ['.scrollMiniPlayPause', '.scrollMiniDragHandle']) {
      await player.locator('.scrollMiniPointerLayer').click({ position: { x: 20, y: 60 } })
      await player.locator(control).dblclick()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
    }
    await expectNotFullscreen(page)

    await doubleClickMiniPlayerVideo(page, player)
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expectNotFullscreen(page)

    // During playback, controls hide under a resting pointer. The first click
    // reveals them, so the second click lands on one of them.
    for (const control of ['.scrollMiniPlayPause', '.scrollMiniDragHandle']) {
      // Ending playback would reveal the controls again.
      await video.evaluate(element => {
        element.currentTime = 0
        return element.play()
      })
      await scrollBelowPlayer(player)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      const hiddenControl = player.locator(control)
      const bounds = await hiddenControl.boundingBox()
      const x = bounds.x + bounds.width / 2
      const y = bounds.y + bounds.height / 2
      await page.mouse.move(x, y)
      await expect(hiddenControl).toHaveClass(/isHidden/, { timeout: 10_000 })
      // Double-click without moving, as mouse.dblclick() would reveal the controls first.
      for (const clickCount of [1, 2]) {
        await page.mouse.down({ clickCount })
        await page.mouse.up({ clickCount })
      }
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      expect(await video.evaluate(element => element.paused)).toBe(false)
    }
  })

  test('restores a phone mini player by tapping its tucked sliver', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)

    const dragHandle = player.locator('.scrollMiniDragHandle')
    const dragStart = await dragHandle.boundingBox()
    if (!dragStart) throw new Error('scroll mini player drag handle is not visible')
    const dragY = dragStart.y + dragStart.height / 2

    await dragHandle.dispatchEvent('pointerdown', {
      button: 0,
      clientX: dragStart.x + dragStart.width / 2,
      clientY: dragY,
      pointerId: 1,
      pointerType: 'touch'
    })
    await expect(page.locator('body')).toHaveClass(/scroll-mini-player-grabbing/)
    await page.evaluate(({ dragY }) => {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 10,
        clientY: dragY,
        pointerId: 1,
        pointerType: 'touch'
      }))
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 10,
        clientY: dragY,
        pointerId: 1,
        pointerType: 'touch'
      }))
    }, { dragY })

    await expect(player).toHaveClass(/scrollMiniPlayerStashed/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
    await expect(player.locator('.scrollMiniPlayerControls button')).toHaveCount(1)
    await expect(player.locator('.scrollMiniPlayPause')).toHaveCount(0)
    await expect(player.locator('.scrollMiniPointerLayer')).toHaveCSS('pointer-events', 'auto')
    await expect(player.locator('video')).toHaveCSS('pointer-events', 'none')

    const visibleWidthBeforeResize = await player.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left)
    })
    await setWindowSize(app, page, { width: 420, height: 760 })
    await expect(player).toHaveClass(/scrollMiniPlayerStashed/)
    await expect.poll(async () => {
      const bounds = await player.boundingBox()
      if (!bounds) return Number.POSITIVE_INFINITY
      return Math.min(420, bounds.x + bounds.width) - Math.max(0, bounds.x)
    }).toBeCloseTo(visibleWidthBeforeResize, 0)

    const restoreLayer = player.locator('.scrollMiniPointerLayer')
    const restoreBounds = await restoreLayer.boundingBox()
    if (!restoreBounds) throw new Error('tucked scroll mini player restore target is not visible')
    const pausedBeforeRestore = await video.evaluate(element => element.paused)
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const restoreX = (
      Math.max(0, restoreBounds.x) +
      Math.min(viewport.width, restoreBounds.x + restoreBounds.width)
    ) / 2
    const restoreY = (
      Math.max(0, restoreBounds.y) +
      Math.min(viewport.height, restoreBounds.y + restoreBounds.height)
    ) / 2
    await expect.poll(() => page.evaluate(({ x, y }) => {
      return document.elementFromPoint(x, y)?.closest('.scrollMiniPointerLayer') != null
    }, { x: restoreX, y: restoreY })).toBe(true)

    await page.mouse.move(restoreX, restoreY)
    await page.mouse.down()

    await expect(player).not.toHaveClass(/scrollMiniPlayerStashed/)
    await page.mouse.up()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(pausedBeforeRestore)
  })

  test.describe('on all tabs', () => {
    test.use({
      seed: {
        settings: {
          ...PLAYER_SEED,
          uiScale: 125
        }
      }
    })

    async function usePortraitShort(page) {
      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate(async component => {
        component.proxy.useCustomShortsPlayerForCurrentVideo = true
        component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
        await component.proxy.$nextTick()
      })
      await watch.dispose()
      // Keep local playback, but report the dimensions of a portrait stream.
      await page.locator('.ftVideoPlayer video').evaluate(video => {
        Object.defineProperties(video, {
          videoWidth: { configurable: true, value: 360 },
          videoHeight: { configurable: true, value: 640 }
        })
        video.dispatchEvent(new Event('resize'))
      })
      await expect(page.locator('.ftVideoPlayer')).toHaveClass(/shortsPlayer/)
    }

    test('hides Shorts controls in the cross-tab mini player and restores them on return', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      await usePortraitShort(page)
      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      // During playback the mini player hides its play/pause button after a
      // few seconds, and a click on the hidden button only reveals the
      // controls. Pause the media directly; pausing reveals the button.
      await player.locator('video').evaluate(video => video.pause())
      await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)
      await expect(player.locator('.shortsTopControls')).toBeHidden()
      await expect(player).toHaveCSS('overflow', 'clip')
      await expect(player.locator('.scrollMiniPlayPause')).toBeVisible()
      await expect(player).toBeInViewport({ ratio: 1 })
      // Playwright screenshots crop Electron's output at non-100% UI scale.
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].capturePage()
        return image.toPNG().toString('base64')
      })
      await test.info().attach('Shorts cross-tab mini player', {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
      })

      await page.locator('.tabBar .tab').first().click()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(player.locator('.shortsTopControls')).toBeVisible()
    })

    test('returns to the video tab on double-click', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(2)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)

      await doubleClickMiniPlayerVideo(page, player)
      await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expectNotFullscreen(page)
    })

    test('keeps the most recently left video visible across tabs', async ({ app, page, attachScreenshot }) => {
      const video = await openDemoVideo({ app, page })
      // An ended video leaves the mini player, and this test can outlast the
      // short demo clip on a busy machine.
      await video.evaluate(element => { element.loop = true })
      const playbackTimeBeforeSwitch = await video.evaluate(element => element.currentTime)

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(2)
      await expect(player).toBeVisible()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      const returnButton = player.locator('.scrollMiniScrollTop')
      await expect(returnButton).toHaveAttribute(
        'title',
        'Return to video tab'
      )
      await expect(returnButton).toHaveAttribute('tabindex', '0')
      await expect(returnButton.locator('.ft-icon'))
        .toHaveAttribute('data-icon', 'back-to-tab')
      const dismissButton = player.getByRole('button', { name: 'Hide mini player' })
      await expect(dismissButton).toBeVisible()
      expect(await dismissButton.evaluate(button => {
        return button.getBoundingClientRect().left >
          button.previousElementSibling.getBoundingClientRect().left
      })).toBe(true)
      const floatingVideo = player.locator('video')
      await expect.poll(() => floatingVideo.evaluate(element => element.currentTime))
        .toBeGreaterThan(playbackTimeBeforeSwitch)

      const playPauseButton = player.locator('.scrollMiniPlayPause')
      // The button hides after three seconds of playback, which the steps above
      // can outlast on a busy machine, and click() does not move the pointer far
      // enough to reveal it. Move over it and click right away, as a user would;
      // click()'s actionability checks can outlast the next three seconds too.
      const { x, y, width, height } = await playPauseButton.boundingBox()
      await page.mouse.move(x + width / 2 - 10, y + height / 2)
      await page.mouse.move(x + width / 2, y + height / 2)
      await page.mouse.down()
      await page.mouse.up()
      await expect.poll(() => floatingVideo.evaluate(element => element.paused)).toBe(true)
      await playPauseButton.click()
      await expect.poll(() => floatingVideo.evaluate(element => element.paused)).toBe(false)
      await attachScreenshot('mini player on another tab')

      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(3)
      await expect(player).toBeVisible()

      await player.locator('.scrollMiniScrollTop').click()
      await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    })

    test('hides the detached mini player until its video tab is revisited', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      const player = page.locator('.ftVideoPlayer')
      const video = player.locator('video')
      const playbackTimeBeforeSwitch = await video.evaluate(element => element.currentTime)
      const videoTab = page.locator('.tabBar .tab').first()

      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await player.getByRole('button', { name: 'Hide mini player' }).click()

      await expect(player).toHaveCSS('opacity', '0')
      await expect(player).toHaveAttribute('aria-hidden', 'true')
      await expect(player).toHaveAttribute('inert', '')
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
      await expect.poll(() => video.evaluate(element => element.currentTime))
        .toBeGreaterThan(playbackTimeBeforeSwitch)

      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(3)
      await expect(player).toHaveCSS('opacity', '0')

      await videoTab.click()
      await expect(player).toBeVisible()
      await expect(player).toHaveCSS('opacity', '1')
      await expect(player).not.toHaveAttribute('inert', '')
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(player.getByRole('button', { name: 'Hide mini player' })).toHaveCount(0)

      await page.locator('.tabBar .tab').nth(1).click()
      await expect(player).toBeVisible()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player.getByRole('button', { name: 'Hide mini player' })).toBeVisible()
    })

    test('does not show a second mini player after switching between watch tabs', async ({ app, page }) => {
      const { activePlayer } = await openCrossTabMiniPlayerOverWatchTab({ app, page })

      await expectNoScrollMiniPlayerActivation(
        page,
        activePlayer,
        () => scrollBelowPlayer(activePlayer)
      )
      await expect(page.locator('.ftVideoPlayer.scrollMiniPlayer')).toHaveCount(1)
    })

    test('keeps the active tab docked when a hidden tab cannot take the mini player', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      const firstTab = page.locator('.tabBar .tab').first()
      const firstTabId = await page.locator(activeTab).getAttribute('data-tab-id')
      await page.locator('.tabBar .newTabButton').click()
      await openDemoVideo({ app, page })
      const secondTabId = await page.locator(activeTab).getAttribute('data-tab-id')
      const activePlayer = page.locator(`.ftVideoPlayer[data-tab-id="${firstTabId}"]`)
      const outgoingPlayer = page.locator(`.ftVideoPlayer[data-tab-id="${secondTabId}"]`)
      const setOnAllTabs = async (value) => {
        const watch = await page.evaluateHandle(findWatchComponent)
        await watch.evaluate((component, value) => component.proxy.$store.dispatch('updateKeepPlayingOnNavigation', value), value)
        await watch.dispose()
      }

      await firstTab.click()
      await expect(outgoingPlayer).toHaveClass(/scrollMiniPlayer/)
      await setOnAllTabs(false)
      await expect(outgoingPlayer).not.toHaveClass(/scrollMiniPlayer/)
      await scrollBelowPlayer(activePlayer)
      await expect(activePlayer).toHaveClass(/scrollMiniPlayer/)

      // The outgoing tab is hidden now, so it cannot measure a player to dock.
      // Trying must not leave it owning the mini player the active tab gave up.
      await setOnAllTabs(true)
      await page.evaluate(() => window.scrollBy(0, 1))
      await expect(outgoingPlayer).not.toHaveClass(/scrollMiniPlayer/)
      await expect(activePlayer).toHaveClass(/scrollMiniPlayer/)
    })

    test('docks the scrolled active tab as soon as the cross-tab video ends', async ({ app, page }) => {
      const { activePlayer, firstPlayer, firstVideo } = await openCrossTabMiniPlayerOverWatchTab({ app, page })
      await scrollBelowPlayer(activePlayer)
      await expect(activePlayer).not.toHaveClass(/scrollMiniPlayer/)

      await firstVideo.evaluate(element => {
        Object.defineProperty(element, 'ended', { configurable: true, value: true })
        element.dispatchEvent(new Event('ended'))
      })
      await expect(firstPlayer).not.toHaveClass(/scrollMiniPlayer/)
      await expect(activePlayer).toHaveClass(/scrollMiniPlayer/)
    })

    test('allows the active tab mini player after the cross-tab video ends', async ({ app, page }) => {
      const { activePlayer, firstPlayer, firstVideo } = await openCrossTabMiniPlayerOverWatchTab({ app, page })

      await firstVideo.evaluate(element => {
        Object.defineProperty(element, 'ended', { configurable: true, value: true })
        element.dispatchEvent(new Event('ended'))
      })
      await expect(firstPlayer).not.toHaveClass(/scrollMiniPlayer/)

      await scrollBelowPlayer(activePlayer)

      await expect(activePlayer).toHaveClass(/scrollMiniPlayer/)
      await expect(page.locator('.ftVideoPlayer.scrollMiniPlayer')).toHaveCount(1)
    })

    test('does not show the cross-tab mini player for a paused video', async ({ app, page }) => {
      const video = await openDemoVideo({ app, page })
      await video.evaluate(element => element.pause())
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()

      await expect(player).toBeHidden()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    })

    test('removes the mini player when its source tab closes', async ({ app, page }) => {
      await openDemoVideo({ app, page })

      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.ftVideoPlayer')).toBeVisible()

      await page.locator('.tabBar .tab').first().locator('.closeButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(1)
      await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
    })

    test('keeps menus and utility windows above the mini player', async ({ app, page }) => {
      await openDemoVideo({ app, page })

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)

      await page.locator('.profileTrigger').click()
      const quickSettings = page.getByRole('dialog', { name: 'Quick settings' })
      await expectOverlayAbovePlayer(player, quickSettings)

      await quickSettings.getByRole('button', { name: 'All settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expectOverlayAbovePlayer(player, settings)
      await settings.getByRole('button', { name: 'Close', exact: true }).click()

      await page.locator('.profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings' })
        .getByRole('button', { name: 'Downloads' }).click()
      const downloads = page.getByRole('dialog', { name: 'Downloads', exact: true })
      await expectOverlayAbovePlayer(player, downloads)
    })

    test('hides an existing mini player when videos stop playing after leaving them', async ({ app, page }) => {
      await openDemoVideo({ app, page })

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)

      await page.locator('.profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings' })
        .getByRole('button', { name: 'All settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.locator('.settingsMenu [data-section="playback"]').click()
      await settings.getByRole('combobox', { name: 'When leaving a video' }).click()
      await page.getByRole('option', { name: 'Stop playing', exact: true }).click()

      await expect(player).toBeHidden()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    })

    test.describe('with automatic Picture-in-Picture', () => {
      test.use({
        seed: {
          settings: {
            ...PLAYER_SEED,
            autoPictureInPictureTriggers: ['tab'],
            keepPlayingOnNavigation: false,
            uiScale: 125
          }
        }
      })

      test('uses PiP instead of the cross-tab mini player', async ({ app, page }) => {
        await openDemoVideo({ app, page })
        const player = page.locator('.ftVideoPlayer')
        const video = player.locator('video')

        await page.locator('.tabBar .newTabButton').click()
        await expect.poll(() => video.evaluate(
          element => document.pictureInPictureElement === element
        )).toBe(true)
        await expect(player).toBeHidden()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)

        // A later scroll update must not bring the in-app player back while
        // the same video is still presented by the native PiP window.
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
        await expect(player).toBeHidden()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)

        await page.evaluate(() => document.exitPictureInPicture())
        await expect.poll(() => page.evaluate(
          () => document.pictureInPictureElement === null
        )).toBe(true)
      })

      test('does not fall back to the cross-tab mini player while paused', async ({ app, page }) => {
        const video = await openDemoVideo({ app, page })
        await video.evaluate(element => element.pause())
        await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

        const player = page.locator('.ftVideoPlayer')
        await page.locator('.tabBar .newTabButton').click()

        await expect.poll(() => page.evaluate(
          () => document.pictureInPictureElement === null
        )).toBe(true)
        await expect(player).toBeHidden()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      })
    })
  })

  test('scales the captions down with the scroll mini player', async ({ app, page, attachScreenshot }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    await player.evaluate(element => {
      if (element.querySelector('.shaka-text-container')) return

      const captions = document.createElement('div')
      captions.className = 'shaka-text-container'
      element.append(captions)
    })

    const captions = player.locator('.shaka-text-container')
    const getFontSize = () => captions.evaluate(element => {
      return Number.parseFloat(getComputedStyle(element).fontSize)
    })
    const inlineFontSize = await getFontSize()
    // 20px at a player height of 540px
    expect(inlineFontSize).toBeCloseTo(20 * await video.evaluate(element => element.clientHeight) / 540, 1)

    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)

    // The mini player is only a couple of hundred pixels tall, so inline sized captions covered all of it.
    await expect.poll(getFontSize).toBeLessThan(inlineFontSize * 0.8)
    await attachScreenshot('mini player captions')

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(getFontSize).toBe(inlineFontSize)
  })

  test('keeps the mini player docked across window resizes', async ({ app, page, attachScreenshot }) => {
    await setWindowSize(app, page, { width: 1200, height: 850 })
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')

    // Docked bottom-right in the small window.
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await attachScreenshot('docked in the small window')

    // Growing the window used to leave the player where the old bottom edge
    // was, i.e. floating in the middle of the screen.
    const grown = await setWindowSize(app, page, { width: 1600, height: 1050 })
    await expectDockedToBottomRight(player, grown)
    await attachScreenshot('docked after growing the window')

    // ...and the stale position outlived a trip back to the inline player.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)

    const shrunk = await setWindowSize(app, page, { width: 1300, height: 900 })
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expectDockedToBottomRight(player, shrunk)
    await attachScreenshot('docked after shrinking the window')
  })

  test.describe('large captions', () => {
    test.use({
      seed: {
        settings: {
          ...PLAYER_SEED,
          defaultCaptionSettings: JSON.stringify({ fontScale: 4 })
        }
      }
    })

    test('keeps the captions inside the scroll mini player', async ({ app, page, attachScreenshot }) => {
      const video = await openDemoVideo({ app, page })
      await video.evaluate(element => element.pause())

      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => {
        if (element.querySelector('.shaka-text-container')) return

        const captions = document.createElement('div')
        captions.className = 'shaka-text-container'
        const cue = document.createElement('div')
        const text = document.createElement('span')
        text.setAttribute('translate', 'no')
        // Shaka scales the cues by the configured font size
        text.style.fontSize = '4em'
        text.textContent = 'a caption long enough to wrap over several lines in a small player, '
          .repeat(3)
        cue.append(text)
        captions.append(cue)
        element.append(captions)
      })

      await scrollBelowPlayer(player)
      await expect(player).toHaveClass(/scrollMiniPlayer/)

      // The maximum font size used to overflow the mini player in every direction.
      await expect.poll(() => player.evaluate(element => {
        const playerRect = element.getBoundingClientRect()
        const captionRect = element.querySelector('.shaka-text-container').getBoundingClientRect()

        return {
          top: captionRect.top >= playerRect.top,
          bottom: captionRect.bottom <= playerRect.bottom,
          left: captionRect.left >= playerRect.left,
          right: captionRect.right <= playerRect.right
        }
      })).toEqual({ top: true, bottom: true, left: true, right: true })
      await attachScreenshot('large captions in the mini player')
    })
  })
})

test.describe('pinned player', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, scrollPlayerMode: 'pin' } } })

  test('stays below the top navigation while scrolling and docks when it is too tall', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    await setWindowSize(app, page, { width: 480, height: 860 })
    const player = page.locator('.ftVideoPlayer')
    const playerTop = () => player.evaluate(element => element.getBoundingClientRect().top)
    const navigationBottom = await page.locator('.topNav').evaluate(element => element.getBoundingClientRect().bottom)

    await page.evaluate(() => window.scrollTo(0, 700))
    await expect.poll(playerTop).toBeCloseTo(navigationBottom, 0)
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    // The page scrollbar starts below the pinned player instead of running behind it.
    const scrollbarTop = () => page.locator('body > .os-scrollbar-vertical').evaluate(element => element.getBoundingClientRect().top)
    const pinnedAreaBottom = await page.locator('.videoArea').evaluate(element => element.getBoundingClientRect().bottom)
    await expect.poll(scrollbarTop).toBeCloseTo(pinnedAreaBottom, 0)

    // Half of this window is shorter than the player, so it docks instead.
    await setWindowSize(app, page, { width: 500, height: 420 })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(scrollbarTop).toBe(0)
  })
})

test.describe('skip silence shortcut', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        keyboardShortcuts: JSON.stringify({
          VIDEO_PLAYER: {
            PLAYBACK: {
              TOGGLE_SKIP_SILENCE: 'h'
            }
          }
        })
      }
    }
  })

  test('keeps the setting within its tab', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    const readSkipSilenceState = () => page.evaluate(() => {
      const store = window.$store
      return {
        activeTabId: store.getters.getActiveTabId,
        values: { ...store.state.tabs.skipSilenceByTabId }
      }
    })

    await page.locator('body').press('h')
    const firstTabId = (await readSkipSilenceState()).activeTabId
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: true }
    })

    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await openMockedVideo(page)

    const secondTabId = (await readSkipSilenceState()).activeTabId
    expect(secondTabId).not.toBe(firstTabId)
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: true }
    })
    expect(await page.evaluate((tabId) => {
      const store = window.$store
      return store.getters.getTabSkipSilence(tabId)
    }, secondTabId)).toBe(false)

    await page.locator('body').press('h')
    await page.locator('body').press('h')
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: {
        [firstTabId]: true,
        [secondTabId]: false
      }
    })
  })

  test('applies the default only to newly-created tabs', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    const readSkipSilenceState = () => page.evaluate(() => {
      const store = window.$store
      return {
        activeTabId: store.getters.getActiveTabId,
        values: { ...store.state.tabs.skipSilenceByTabId }
      }
    })

    const firstTabId = (await readSkipSilenceState()).activeTabId
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateShowSkipSilenceButton', true)
      await store.dispatch('updateEnableSkipSilenceByDefault', true)
    })

    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: false }
    })
    await page.locator('body').press('h')
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: true }
    })

    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await openMockedVideo(page)

    const secondTabId = (await readSkipSilenceState()).activeTabId
    expect(secondTabId).not.toBe(firstTabId)
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: {
        [firstTabId]: true,
        [secondTabId]: true
      }
    })

    await page.locator('body').press('h')
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: {
        [firstTabId]: true,
        [secondTabId]: false
      }
    })
  })

  test('disables the setting for an unmounted player when the control is hidden', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateShowSkipSilenceButton', true)
    })
    await page.locator('body').press('h')

    await page.locator('.sideNav a[href="#/history"]').first().evaluate(link => link.click())
    await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toHaveCount(0)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateShowSkipSilenceButton', false)
    })

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getTabSkipSilence(store.getters.getActiveTabId)
    })).toBe(false)
  })
})

test.describe('skip silence default', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        showSkipSilenceButton: true,
        enableSkipSilenceByDefault: true
      }
    }
  })

  test('enables silence skipping in the initial tab', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getTabSkipSilence(store.getters.getActiveTabId)
    })).toBe(true)
  })
})

test.describe('playback when navigating away', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, keepPlayingOnNavigation: true } } })

  test('keeps the ended mini player visible and replays while browsing', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await page.getByRole('link', { name: 'Go to Subscriptions', exact: true }).click()
    await expect(page).toHaveURL(/#\/subscriptions$/)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await video.evaluate(element => { element.currentTime = element.duration })
    await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
    await expect(player).toBeVisible()
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    const replay = player.locator('.scrollMiniPlayPause')
    await expect(replay).not.toHaveClass(/isHidden/)
    await expect(replay).toHaveAccessibleName('Replay')
    await expect(replay.locator('[data-icon="replay"] svg')).toBeVisible()
    await replay.click()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(5)
    await expect(page).toHaveURL(/#\/subscriptions$/)
  })

  test('keeps the same video playing while browsing and returning', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
    await openDemoVideo({ app, page })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    const originalVideo = await video.elementHandle()
    const time = await video.evaluate(element => element.currentTime)
    const title = await page.locator('.tabBar .tab').innerText()
    await page.getByRole('link', { name: 'Go to Subscriptions', exact: true }).click()
    await expect(page).toHaveURL(/#\/subscriptions$/)
    await expect(player).toBeVisible()
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(page.locator('.tabBar .tab')).toHaveCount(1)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(time)
    await page.evaluate(() => {
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      document.querySelector('.tabContent[aria-hidden="false"] > .routerView').append(spacer)
      window.scrollTo(0, 900)
    })
    await attachScreenshot('video continues while browsing subscriptions')
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
    // Slow the 300 ms restore down, so that a loaded machine still renders
    // enough of its frames to sample.
    await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 25))
    await player.evaluate(element => {
      document.documentElement.dataset.reducedMotion = 'no-preference'
      window.oversizedMiniControls = []
      window.miniRestoreFrames = 0
      window.miniRestoreGeometry = []
      const sample = time => {
        if (!element.isConnected) return
        const bounds = element.getBoundingClientRect()
        const center = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
        window.miniRestoreGeometry.push({
          time: time ?? performance.now(),
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
          visible: element.contains(center)
        })
        if (element.hasAttribute('data-inline-mini-drag')) {
          window.miniRestoreFrames++
          for (const button of element.querySelectorAll('.scrollMiniPlayerControls button')) {
            const style = getComputedStyle(button)
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
            const scale = button.getBoundingClientRect().width / button.offsetWidth
            if (scale > 1.1) window.oversizedMiniControls.push(scale)
          }
        }
        window.miniRestoreSample = requestAnimationFrame(sample)
      }
      sample()
    })
    await player.locator('.scrollMiniScrollTop').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    const samples = await page.evaluate(() => {
      cancelAnimationFrame(window.miniRestoreSample)
      return { frames: window.miniRestoreFrames, oversized: window.oversizedMiniControls, geometry: window.miniRestoreGeometry }
    })
    expect(samples.frames).toBeGreaterThan(0)
    expect(samples.oversized).toEqual([])
    const start = samples.geometry[0]
    const end = samples.geometry.at(-1)
    const expanding = samples.geometry.filter(frame => frame.width > start.width + 5 && frame.width < end.width - 5)
    expect(expanding.length, 'the video visibly expands from the mini player').toBeGreaterThan(2)
    expect(expanding.filter(frame => !frame.visible), 'the moving video stays above the Watch preview').toEqual([])
    const distance = Math.hypot(end.left - start.left, end.top - start.top, end.width - start.width, end.height - start.height)
    // The slowed restore eases out over 1200 ms, so it moves at most
    // 3 * distance / 1200 ms. A sample can show the frame before its timestamp,
    // so allow the previous interval too. Frames skipped under load then widen
    // the bound instead of looking like a jump.
    const maximumSpeed = 3 * distance / 1200
    const jumps = samples.geometry.slice(1).flatMap((frame, index) => {
      const previous = samples.geometry[index]
      const step = Math.hypot(frame.left - previous.left, frame.top - previous.top, frame.width - previous.width, frame.height - previous.height)
      const elapsed = frame.time - (samples.geometry[index - 1] ?? previous).time
      return step < Math.max(distance / 2, maximumSpeed * elapsed) ? [] : [{ step, elapsed }]
    })
    expect(jumps, 'the player must not jump at the preview handoff').toEqual([])
    expect(await video.evaluate((element, original) => element === original, originalVideo)).toBe(true)
    await expect(page.locator('.tabBar .tab')).toHaveText(title)
  })
})

test.describe('navigation playback lifecycle', () => {
  test.use({ seed: { settings: PLAYER_SEED } })

  test('returns through history without restarting playback', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    const component = await page.evaluateHandle(findWatchComponent)
    const original = await page.locator('.ftVideoPlayer video').elementHandle()
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/scrollMiniPlayer/)
    await component.evaluate(component => component.proxy.tabRouter.back())
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayer/)
    expect(await page.locator('.ftVideoPlayer video').evaluate((element, original) => element === original, original)).toBe(true)
  })

  test('retains paused playback when navigating away and switching tabs', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())
    const original = await video.elementHandle()
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    const player = page.locator('.ftVideoPlayer')
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).toBeVisible()
    await page.locator('.tabBar .newTabButton').click()
    await expect(player).toBeVisible()
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await player.locator('.scrollMiniScrollTop').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    expect(await player.locator('video').evaluate((element, original) => element === original && element.paused, original)).toBe(true)
  })

  for (const uiScale of [85, 100]) {
    test.describe(`loading navigation at ${uiScale}% UI scale`, () => {
      test.use({ seed: { settings: { ...PLAYER_SEED, keepPlayingOnNavigation: true, uiScale } } })
      test('retains the poster and pending load while navigating away and returning', async ({ app, page }) => {
        await mockPlayableWatchPage(app, page)
        const media = Promise.withResolvers()
        let requests = 0
        await page.route('**/videoplayback?id=opentubex-e2e-demo**', async route => {
          requests++
          await media.promise
          await route.fallback()
        })
        try {
          await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
          await page.locator(sel.searchInput).press('Enter')
          const player = page.locator('.ftVideoPlayer')
          await expect(player).toBeVisible()
          await expect.poll(() => requests).toBeGreaterThan(0)
          const component = await page.evaluateHandle(findWatchComponent)
          const original = await player.locator('video').elementHandle()
          expect(await original.evaluate(element => element.readyState)).toBe(0)
          expect(await component.evaluate(component => component.proxy.$refs.player.hasLoaded)).toBe(false)
          await component.evaluate(component => component.proxy.tabRouter.push('/history'))
          await expect(page).toHaveURL(/#\/history$/)
          await expect(player).toBeVisible()
          await expect(player).toHaveClass(/scrollMiniPlayer/)
          expect(await player.locator('video').evaluate((element, original) => element === original && element.readyState === 0, original)).toBe(true)
          await player.locator('.scrollMiniScrollTop').click()
          await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
          await expect(player).not.toHaveClass(/scrollMiniPlayer/)
          expect(await player.locator('video').evaluate((element, original) => element === original, original)).toBe(true)
        } finally {
          media.resolve()
        }
        await waitForPlayback(page)
      })
    })
  }

  test('disabling navigation playback disposes the retained player', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    const component = await page.evaluateHandle(findWatchComponent)
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/scrollMiniPlayer/)
    await component.evaluate(component => component.proxy.$store.dispatch('updateKeepPlayingOnNavigation', false))
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
    await openDemoVideo({ app, page })
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
  })

  test('returning during retained-player disposal mounts fresh playable video', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    const component = await page.evaluateHandle(findWatchComponent)
    const original = await page.locator('.ftVideoPlayer video').elementHandle()
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    const disposal = await component.evaluateHandle(component => {
      const watch = component.proxy
      const originalRouteChange = watch.handleRouteChange
      let release
      const gate = new Promise(resolve => { release = resolve })
      const state = { release, started: false, returned: false }
      watch.handleRouteChange = async (...args) => {
        state.started = true
        await gate
        return originalRouteChange(...args)
      }
      return state
    })
    try {
      await component.evaluate(component => component.proxy.$store.dispatch('updateKeepPlayingOnNavigation', false))
      await expect.poll(() => disposal.evaluate(state => state.started)).toBe(true)
      await component.evaluate((component, state) => {
        component.proxy.tabRouter.push('/watch/jNQXAC9IVRw').then(() => { state.returned = true })
      }, disposal)
      await expect(page).toHaveURL(/#\/history$/)
      expect(await disposal.evaluate(state => state.returned)).toBe(false)
    } finally {
      await disposal.evaluate(state => state.release())
    }
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    const video = page.locator('.ftVideoPlayer video')
    await expect(video).toBeVisible()
    expect(await video.evaluate((element, old) => element === old, original)).toBe(false)
    await expect.poll(() => video.evaluate(element => !element.paused && element.readyState >= 2)).toBe(true)
  })

  test('replaces retained playback when opening another video', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/scrollMiniPlayer/)
    await openMockedVideo(page, 'L_LUpnjgPso')
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(1)
    await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayer/)
  })
})

test.describe('navigation playback disabled', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, keepPlayingOnNavigation: false } } })

  test('stops playback when navigating away', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
  })
})

test.describe('retained navigation player across tabs', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, keepPlayingOnNavigation: true } } })

  test('keeps playback across video tabs with only navigation playback enabled', async ({ app, page }) => {
    const { firstVideo, firstPlayer } = await openCrossTabMiniPlayerOverWatchTab({ app, page })
    const before = await firstVideo.evaluate(element => element.currentTime)
    await expect(firstPlayer).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => firstVideo.evaluate(element => element.paused)).toBe(false)
    await expect.poll(() => firstVideo.evaluate(element => element.currentTime)).toBeGreaterThan(before)
  })

  test('returns to the source page from another tab and cleans up on close', async ({ app, page }) => {
    await openDemoVideo({ app, page })
    const video = await page.locator('.ftVideoPlayer video').elementHandle()
    await page.getByRole('link', { name: 'Go to Subscriptions', exact: true }).click()
    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/scrollMiniPlayer/)
    await page.locator('.scrollMiniScrollTop').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayer/)
    expect(await page.locator('.ftVideoPlayer video').evaluate((element, original) => element === original, video)).toBe(true)
    await page.getByRole('link', { name: 'Go to Subscriptions', exact: true }).click()
    await page.locator('.tabBar .tab').first().getByRole('button', { name: 'Close Tab', exact: true }).click()
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
  })
})

test.describe('navigation playback with automatic tab picture-in-picture enabled', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, keepPlayingOnNavigation: true, autoPictureInPictureTriggers: ['tab'] } } })

  test('keeps the outgoing video in the mini player', async ({ app, page }) => {
    const { firstVideo, firstPlayer } = await openCrossTabMiniPlayerOverWatchTab({ app, page })
    await expect(firstPlayer).toBeVisible()
    await expect(firstPlayer).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => firstVideo.evaluate(element => element.paused)).toBe(false)
    expect(await page.evaluate(() => document.pictureInPictureElement === null)).toBe(true)
  })
})
