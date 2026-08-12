import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, expectDockedToBottomRight, openMockedVideo } from '../../helpers/player.mjs'
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
async function openDemoVideo({ app, page }) {
  await mockPlayableWatchPage(app, page)
  return await openMockedVideo(page)
}

/** Scrolls the player out of view, which docks it as the scroll mini player. */
function scrollBelowPlayer(player) {
  return player.evaluate(element => {
    const rect = element.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + rect.bottom)
  })
}

test('playback starts', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await expect
    .poll(() => video.evaluate((element) => element.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(1)

  await attachScreenshot('playing video')
})

test('hides the tab play indicator while buffering', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  const tabBarTab = page.locator('.tabBar .tab.active')
  await expect(tabBarTab.locator('.playingIcon')).toBeVisible()
  await attachScreenshot('tab play indicator')

  await video.dispatchEvent('waiting')
  await expect(tabBarTab.locator('.playingIcon')).toHaveCount(0)
  await attachScreenshot('tab while buffering')

  await video.dispatchEvent('playing')
  await expect(tabBarTab.locator('.playingIcon')).toBeVisible()
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

test('zooms the video and keeps the level for the next video', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
  await attachScreenshot('zoomed video')

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  // The zoom level carries over to the next video (#651)
  await page.locator('.tabBar .newTabButton').click()
  await expect(page.locator('.tabBar .tab')).toHaveCount(2)
  const nextVideo = await openMockedVideo(page)
  await expect(nextVideo).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  await page.locator('body').press('Shift+Z')
  await expect(nextVideo).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
})

test('shift-dragging moves the visible part of a zoomed video', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })
  const readTranslation = () => video.evaluate((element) => {
    const { m41, m42 } = new DOMMatrix(getComputedStyle(element).transform)
    return { x: m41, y: m42 }
  })

  await page.locator('body').press('z')
  await page.locator('body').press('z')
  expect(await readTranslation()).toEqual({ x: 0, y: 0 })

  const box = await video.boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.keyboard.down('Shift')
  await page.mouse.move(center.x, center.y)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect(player).toHaveClass(/videoZoomPannable/)

  await page.mouse.down()
  await page.mouse.move(center.x - 120, center.y - 40, { steps: 4 })
  await expect(player).toHaveClass(/videoZoomPanning/)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await attachScreenshot('panned video')

  const panned = await readTranslation()
  expect(panned.x).toBeLessThan(0)
  expect(panned.y).toBeLessThan(0)

  // Panning must not double as a play/pause click
  expect(await video.evaluate((element) => element.paused)).toBe(false)

  // Turning the zoom off recenters the video
  await page.locator('body').press('Shift+Z')
  await page.locator('body').press('Shift+Z')
  await expect(video).toHaveCSS('transform', 'none')
})

test('the overflow menu can turn the zoom off again', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.getByRole('button', { name: 'More Options' }).click()

  const overflowMenu = player.locator('.shaka-overflow-menu')
  await overflowMenu.getByRole('button', { name: 'Zoom' }).click()
  await attachScreenshot('zoom menu')

  await player.locator('.video-zoom-menu').getByRole('button', { name: 'Off' }).click()
  await expect(video).toHaveCSS('transform', 'none')
})

test('keeps the context menu open when the pointer leaves a playing video', async ({ app, page, attachScreenshot }) => {
  await openDemoVideo({ app, page })
  await page.locator('.ftVideoPlayer').click({ button: 'right' })

  const contextMenu = page.locator('.shaka-context-menu')
  await expect(contextMenu).toBeVisible()
  await attachScreenshot('player context menu')

  await page.mouse.move(0, 0)
  await page.waitForTimeout(3500)
  await expect(contextMenu).toBeVisible()
  await attachScreenshot('context menu after the pointer left')
})

test.describe('scroll mini player', () => {
  test('animates into and out of the scroll mini player', async ({ app, page, attachScreenshot }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'no-preference'
      window.scrollMiniPlayerAnimations = []
      const nativeAnimate = Element.prototype.animate

      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('ftVideoPlayer')) {
          const style = getComputedStyle(this)
          window.scrollMiniPlayerAnimations.push({
            className: this.className,
            keyframes,
            options,
            position: style.position,
            zIndex: style.zIndex
          })
        }
        return nativeAnimate.call(this, keyframes, options)
      }
    })

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimations.length)).toBe(1)
    await attachScreenshot('scroll mini player')

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimations.length)).toBe(2)
    await attachScreenshot('back to the inline player')

    const animations = await page.evaluate(() => window.scrollMiniPlayerAnimations)
    for (const animation of animations) {
      expect(animation.options.duration).toBe(300)
      expect(animation.options.easing).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
      expect(animation.keyframes[0].transform).toContain('translate(')
      expect(animation.keyframes[0].transform).toContain('scale(')
      expect(animation.keyframes[1].transform).toBe('none')
    }
    expect(animations[1].className).toContain('scrollMiniPlayerAnimating')
    expect(animations[1].position).toBe('relative')
    expect(animations[1].zIndex).toBe('150')
  })

  test('does not replay the animation after switching tabs', async ({ app, page, attachScreenshot }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'no-preference'
      window.scrollMiniPlayerAnimationCount = 0
      const nativeAnimate = Element.prototype.animate

      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('ftVideoPlayer')) {
          window.scrollMiniPlayerAnimationCount++
        }
        return nativeAnimate.call(this, keyframes, options)
      }
    })

    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimationCount)).toBe(1)

    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await attachScreenshot('second tab open')
    const animationCountBeforeReturn = await page.evaluate(
      () => window.scrollMiniPlayerAnimationCount
    )
    await page.locator('.tabBar .tab').first().click()
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await attachScreenshot('back on the video tab')

    // The old behavior scheduled the restored entrance animation on the next
    // Vue tick, so wait past its duration before checking that none was added.
    await page.waitForTimeout(350)
    expect(await page.evaluate(() => window.scrollMiniPlayerAnimationCount))
      .toBe(animationCountBeforeReturn)
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
    expect(inlineFontSize).toBe(20)

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

test.describe('fast-forward through silence shortcut', () => {
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

  test('shows an on-screen indicator when toggled', async ({ app, page, attachScreenshot }) => {
    await openDemoVideo({ app, page })

    const popup = page.locator(`${activeTab} .valueChangePopup`)
    const skipSilence = () => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getSkipSilence
    })

    await page.locator('body').press('h')
    await expect(popup).toBeVisible()
    await expect(popup).toHaveText(/On/)
    await expect.poll(skipSilence).toBe(true)
    await attachScreenshot('skip silence enabled')

    await page.locator('body').press('h')
    await expect(popup).toBeVisible()
    await expect(popup).toHaveText(/Off/)
    await expect.poll(skipSilence).toBe(false)
    await attachScreenshot('skip silence disabled')
  })
})
