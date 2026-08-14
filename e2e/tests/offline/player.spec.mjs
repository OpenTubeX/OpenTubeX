import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import {
  activeTab,
  expectDockedToBottomRight,
  findWatchComponent,
  openMockedVideo,
} from '../../helpers/player.mjs'
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

test('hides configured paused interface elements until pointer activity', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await Promise.all([
      component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', false),
      component.proxy.$store.dispatch('updateShowVideoTitleWhenPaused', false),
      component.proxy.$store.dispatch('updateShowFullscreenActionsWhenPaused', false),
      component.proxy.$store.dispatch('updatePausedInterfaceHideDelay', 0.5),
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

  await expect(player).not.toHaveClass(/pausedInterfaceRevealed/, { timeout: 1500 })
  await expect(title).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(controls).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('opacity', '0')
  await watchComponent.dispose()
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

  // The control panel is hidden until the pointer is over the player
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  const moreOptions = player.getByRole('button', { name: 'More settings' })
  await expect(moreOptions).toBeVisible()
  await moreOptions.click()

  const overflowMenu = player.locator('.shaka-overflow-menu')
  await expect(overflowMenu).toHaveClass(/ft-menu-grid/)
  await expect(overflowMenu).toHaveCSS('display', 'grid')
  await expect(overflowMenu).toHaveCSS('overscroll-behavior', 'contain')
  await expect(overflowMenu.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  expect(await overflowMenu.locator(':scope > button').evaluateAll((buttons) => {
    return buttons.every((button) => getComputedStyle(button).flexDirection === 'column')
  })).toBe(true)
  const statusTypography = await overflowMenu.evaluate((menu) => {
    // The local fixture uses a legacy format, so reproduce Shaka's additional
    // wrapper around the standard resolution status in the live menu.
    const button = document.createElement('button')
    button.innerHTML = `
      <label class="shaka-overflow-button-label">
        <span><span class="shaka-current-selection-span">1080p60</span></span>
      </label>`
    menu.append(button)

    const resolutionStatus = button.querySelector('.shaka-current-selection-span')
    const playbackRateStatus = menu.querySelector(
      '.shaka-playbackrate-button .shaka-current-selection-span'
    )
    const typography = (element) => {
      const { color, fontSize, opacity } = getComputedStyle(element)
      return { color, fontSize, opacity }
    }
    const result = [typography(resolutionStatus), typography(playbackRateStatus)]
    button.remove()
    return result
  })
  expect(statusTypography[0]).toEqual(statusTypography[1])
  expect(statusTypography[0]).toMatchObject({ fontSize: '10px', opacity: '0.75' })
  const overflowMenuHeight = (await overflowMenu.boundingBox()).height

  await overflowMenu.getByRole('button', { name: 'Zoom' }).click()
  const zoomMenu = player.locator('.video-zoom-menu')
  await expect(zoomMenu).toHaveClass(/ft-menu-grid/)
  await expect(zoomMenu).toHaveCSS('flex-wrap', 'wrap')
  expect((await overflowMenu.boundingBox()).height).toBe(overflowMenuHeight)
  const zoomHeader = zoomMenu.locator('.shaka-back-to-overflow-button')
  const zoomHeaderTitle = zoomHeader.getByText('Zoom')
  const [headerBox, titleBox] = await Promise.all([
    zoomHeader.boundingBox(),
    zoomHeaderTitle.boundingBox(),
  ])
  expect(Math.abs(
    (headerBox.x + headerBox.width / 2) - (titleBox.x + titleBox.width / 2)
  )).toBeLessThanOrEqual(1)
  expect(await zoomMenu.evaluate((menu) => {
    // Caption tracks are not part of the local media fixture. Recreate its
    // Options action in another submenu to verify the shared grid geometry.
    const options = document.createElement('button')
    options.className = 'ft-caption-options-button'
    options.textContent = 'Options'
    menu.append(options)

    const header = menu.querySelector('.shaka-back-to-overflow-button')
    const headerBox = header.getBoundingClientRect()
    const optionsBox = options.getBoundingClientRect()
    options.remove()

    return Math.abs(
      (headerBox.top + headerBox.height / 2) - (optionsBox.top + optionsBox.height / 2)
    )
  })).toBeLessThanOrEqual(1)
  await attachScreenshot('zoom menu')

  await zoomMenu.getByRole('button', { name: 'Off' }).click()
  await expect(video).toHaveCSS('transform', 'none')

  // A narrow player folds Autoplay into the overflow menu.
  await player.evaluate(element => { element.style.width = '600px' })
  const autoplaySwitch = overflowMenu.locator('.autoplay-toggle > .ft-autoplay-switch')
  await moreOptions.click()
  await expect(autoplaySwitch).toBeVisible()
  await expect(autoplaySwitch).toHaveCSS('margin-right', '0px')

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateUsePlayerMenuGrid', false)
    await component.proxy.$nextTick()
  })
  await player.hover()
  await moreOptions.click()
  await expect(overflowMenu).not.toHaveClass(/ft-menu-grid/)
  await expect(overflowMenu.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  await expect(autoplaySwitch).toHaveCSS('margin-right', '14px')
  await watchComponent.dispose()
})

test('auto-translates captions into an arbitrary language', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  const moreOptions = player.getByRole('button', { name: 'More settings' })
  await moreOptions.click()

  const overflowMenu = player.locator('.shaka-overflow-menu')
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
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

  const frenchResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/timedtext' && url.searchParams.get('tlang') === 'fr'
  })
  await translations.getByRole('button', { name: 'French' }).click()
  await translations.getByRole('button', { name: 'German' }).click()
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
  await moreOptions.click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
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
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'false')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(0)

  await header.click()
  await captionsMenu.getByRole('button', { name: 'English (auto-generated)', exact: true }).click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'false')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(0)

  const nextVideoId = 'aqz-KE-bpKQ'
  await openMockedVideo(page, nextVideoId)
  await player.hover()
  await moreOptions.click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
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

test('video zoom can be disabled', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateEnableVideoZoom', false)
    await component.proxy.$nextTick()
  })
  await expect(video).toHaveCSS('transform', 'none')

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  await expect(player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Zoom' }))
    .toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'none')

  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateEnableVideoZoom', true)
    await component.proxy.$nextTick()
  })
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
  await watchComponent.dispose()
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
