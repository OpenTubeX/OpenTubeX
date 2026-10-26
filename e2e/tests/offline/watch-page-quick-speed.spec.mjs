import { sel, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { DEMO_MEDIA_URL } from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED, mockMusicMediaType } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test.describe('desktop quick playback speed bar', () => {
  test.use({ seed: { settings: { ...WATCH_PAGE_SEED, useQuickPlaybackSpeedBar: true } } })

  const overflowingPresets = Array.from({ length: 24 }, (_, index) => ({ speed: 0.5 + index * 0.25 }))

  for (const format of ['audio', 'legacy']) {
    test(`keeps speed changes during ${format} format unload`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      const view = await watchViewHandle(page)
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      const bar = player.locator('.ft-quick-playback-rate-bar')
      await view.evaluate((view, url) => {
        view.manifestSrc = url
        view.manifestMimeType = 'video/webm'
      }, DEMO_MEDIA_URL)
      await expect.poll(() => view.evaluate(view => view.$refs.player.hasLoaded)).toBe(true)
      if (format === 'legacy') {
        await view.evaluate(view => { view.activeFormat = 'audio' })
        await expect.poll(() => view.evaluate(view => view.$refs.player.hasLoaded)).toBe(true)
      }

      await player.evaluate(element => {
        const player = element.ui.getControls().getPlayer()
        const unload = player.unload.bind(player)
        const pending = new Promise(resolve => { window.finishSpeedUnload = resolve })
        window.speedUnloadStarted = false
        player.unload = async (...args) => {
          window.speedUnloadStarted = true
          await pending
          return unload(...args)
        }
      })
      try {
        await view.evaluate((view, format) => { view.activeFormat = format }, format)
        await expect.poll(() => page.evaluate(() => window.speedUnloadStarted)).toBe(true)
        await expect.poll(() => view.evaluate(view => view.$refs.player.hasLoaded)).toBe(false)
        await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
        await bar.locator('[data-rate="1.5"]').click()
        await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
        await page.evaluate(() => window.finishSpeedUnload())
        await expect.poll(() => view.evaluate(view => view.$refs.player.hasLoaded)).toBe(true)
        await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
        await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
      } finally {
        await page.evaluate(() => window.finishSpeedUnload())
      }
    })
  }

  for (const control of ['quick bar', 'menu']) {
    test(`keeps ${control} speed changes while a legacy quality waits for availability`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const view = await watchViewHandle(page)
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      const bar = player.locator('.ft-quick-playback-rate-bar')
      await view.evaluate(async view => {
        view.legacyFormats = [...view.legacyFormats, {
          ...view.legacyFormats[0],
          width: 426,
          height: 240,
          qualityLabel: '240p',
          availableAt: Math.floor(Date.now() / 1000) + 8
        }]
        await view.$nextTick()
      })
      await player.evaluate(element => {
        element.ui.configure({ enableTooltips: false })
        window.speedQualityLoaded = false
        element.ui.getControls().getPlayer().addEventListener('loaded', () => {
          window.speedQualityLoaded = true
        }, { once: true })
      })
      await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
      await player.getByRole('button', { name: 'More settings', exact: true }).click()
      await player.locator('.legacy-quality-button').click()
      await player.locator('.legacy-qualities').getByRole('button', { name: '240p', exact: true }).click()
      expect(await view.evaluate(view => view.$refs.player.hasLoaded)).toBe(true)
      expect(await page.evaluate(() => window.speedQualityLoaded)).toBe(false)
      await player.evaluate(element => element.ui.getControls().hideSettingsMenus())
      if (control === 'quick bar') {
        await bar.locator('[data-rate="1.5"]').click()
      } else {
        await player.getByRole('button', { name: 'More settings', exact: true }).click()
        await player.locator('.shaka-playbackrate-button').click()
        await player.locator('.shaka-playback-rates').getByRole('button', { name: '1.5x', exact: true }).click()
      }
      await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
      await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
      await expect.poll(() => page.evaluate(() => window.speedQualityLoaded), { timeout: 15_000 }).toBe(true)
      await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
      await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
    })
  }

  test('keeps custom speeds outside the native playback range', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    // While playing, the controls hide again after a few idle seconds.
    await video.evaluate(element => element.pause())
    await page.evaluate(() => window.$store.dispatch(
      'updateQuickPlaybackSpeedBarOptions', JSON.stringify([0.05, 20, 1].map(speed => ({ speed })))
    ))
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const bar = player.locator('.ft-quick-playback-rate-bar')
    for (const rate of [0.05, 20, 1]) {
      await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
      const button = bar.locator(`[data-rate="${rate}"]`)
      await button.click()
      await expect(button).toHaveClass(/is-current-rate/)
      await expect.poll(() => player.evaluate(element => element.ui.getControls().getPlayer().getPlaybackRate())).toBe(rate)
    }
  })

  for (const control of ['quick bar', 'menu', 'normal-rate menu', 'normal-speed toggle']) {
    test(`keeps ${control} speed selections while the DASH manifest is still loading`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const manifestUrl = 'https://media.test/pending-speed.mpd'
      const mediaUrl = DEMO_MEDIA_URL.replaceAll('&', '&amp;')
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT30S" minBufferTime="PT0.1S">
        <Period>
          <AdaptationSet mimeType="video/webm" codecs="vp9,opus">
            <Representation id="demo" bandwidth="200000" width="640" height="360">
              <SegmentList duration="30">
                <Initialization sourceURL="${mediaUrl}"/>
                <SegmentURL media="${mediaUrl}"/>
              </SegmentList>
            </Representation>
          </AdaptationSet>
        </Period>
      </MPD>`
      let releaseManifest
      const manifestReady = new Promise(resolve => { releaseManifest = resolve })
      let manifestRequested
      const requested = new Promise(resolve => { manifestRequested = resolve })
      await page.route(manifestUrl, async route => {
        manifestRequested()
        await manifestReady
        await route.fulfill({ contentType: 'application/dash+xml', body: manifest })
      })

      try {
        const watch = await page.evaluateHandle(findWatchComponent)
        await watch.evaluate((component, url) => {
          component.proxy.manifestMimeType = 'application/dash+xml'
          component.proxy.manifestSrc = url
          component.proxy.activeFormat = 'dash'
          component.proxy.playerLoadGeneration++
        }, manifestUrl)
        await requested
        const bar = page.locator(`${activeTab} .ft-quick-playback-rate-bar`)
        await expect.poll(() => video.evaluate(element => element.readyState)).toBe(0)
        await page.locator(`${activeTab} .shaka-controls-container`).evaluate(element => element.setAttribute('shown', 'true'))
        if (!control.endsWith('menu')) {
          await bar.locator('[data-rate="1.5"]').click()
          await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
        } else {
          if (control === 'normal-rate menu') await bar.locator('[data-rate="1.5"]').click()
          const selectedRate = control === 'normal-rate menu' ? 1 : 1.5
          const player = page.locator(`${activeTab} .ftVideoPlayer`)
          await player.getByRole('button', { name: 'More settings', exact: true }).click()
          await player.locator('.shaka-playbackrate-button').click()
          const menu = player.locator('.shaka-playback-rates')
          await menu.getByRole('button', { name: `${selectedRate}x`, exact: true }).click()
          await player.getByRole('button', { name: 'More settings', exact: true }).click()
          await player.locator('.shaka-playbackrate-button').click()
          await expect(menu.getByRole('button', { name: `${selectedRate}x`, exact: true })).toHaveAttribute('aria-selected', 'true')
          await menu.locator('.shaka-back-to-overflow-button').click()
          await player.getByRole('button', { name: 'More settings', exact: true }).click()
        }
        const rate = control === 'normal-speed toggle' || control === 'normal-rate menu' ? 1 : 1.75
        if (control !== 'normal-rate menu') {
          await page.locator('body').press(control === 'normal-speed toggle' ? 'g' : 'p')
        }
        await expect(bar.locator(`[data-rate="${rate}"]`)).toHaveClass(/is-current-rate/)

        releaseManifest()
        await waitForPlayback(page)
        await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(rate)
        await expect(bar.locator(`[data-rate="${rate}"]`)).toHaveClass(/is-current-rate/)
        if (control === 'normal-speed toggle') {
          await page.locator('body').press('g')
          await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
          await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
        }
      } finally {
        releaseManifest()
      }
    })
  }

  for (const music of [false, true]) {
    test(`keeps quick speed selections made before the ${music ? 'music ' : ''}video loads`, async ({ app, page }) => {
      if (music) await mockMusicMediaType(app, page, 'MUSIC_VIDEO_TYPE_OMV')
      else await mockPlayableWatchPage(app, page)
      let releaseMedia
      const mediaReady = new Promise(resolve => { releaseMedia = resolve })
      await page.route(`${DEMO_MEDIA_URL}*`, async route => {
        await mediaReady
        await route.fallback()
      })

      try {
        await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
        await page.locator(sel.searchInput).press('Enter')
        const video = page.locator(`${activeTab} video`)
        const bar = page.locator(`${activeTab} .ft-quick-playback-rate-bar`)
        await expect(bar).toBeVisible()
        await expect.poll(() => video.evaluate(element => element.readyState)).toBe(0)

        for (const rate of [1.25, 1.5]) {
          const button = bar.locator(`[data-rate="${rate}"]`)
          await page.locator(`${activeTab} .shaka-controls-container`).evaluate(element => element.setAttribute('shown', 'true'))
          await button.click()
          await expect(button).toHaveClass(/is-current-rate/)
        }

        releaseMedia()
        await waitForPlayback(page)
        await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
        await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
      } finally {
        releaseMedia()
      }
    })
  }

  test('smoothly scrolls clipped quick speeds without dropping wheel ticks', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await setWindowSize(app, page, { width: 1050, height: 850 })
    await page.evaluate(async presets => {
      const store = window.$store
      await store.dispatch('updateQuickPlaybackSpeedBarOptions', JSON.stringify(presets))
      await store.dispatch('updateReducedMotion', 'off')
    }, overflowingPresets)
    await page.locator('body').press('s')
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    const bar = page.locator('.ft-quick-playback-rate-bar')
    await expect.poll(() => bar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(240)

    for (const frosted of [true, false]) {
      await page.evaluate(frosted => window.$store.dispatch('updateUseFrostedGlassPlayerUi', frosted), frosted)
      for (const horizontal of [false, true]) {
        await bar.evaluate(element => { element.scrollLeft = 0 })
        const movement = await bar.evaluate(async (element, horizontal) => {
          // Dispatch together so the animation cannot advance between ticks.
          for (let tick = 0; tick < 3; tick++) {
            element.dispatchEvent(new WheelEvent('wheel', {
              deltaX: horizontal ? 80 : 0,
              deltaY: horizontal ? 0 : 80,
              bubbles: true,
              cancelable: true
            }))
          }
          const initial = element.scrollLeft
          const samples = []
          const deadline = performance.now() + 2000
          while (performance.now() < deadline && element.scrollLeft < 239) {
            await new Promise(resolve => requestAnimationFrame(resolve))
            samples.push(element.scrollLeft)
          }
          return { initial, samples, final: element.scrollLeft }
        }, horizontal)
        expect(movement.initial).toBe(0)
        expect(movement.samples.some(offset => offset > 0 && offset < 239)).toBe(true)
        expect(Math.abs(movement.final - 240)).toBeLessThanOrEqual(1)
        // Let scrollend clear the previous destination before the next gesture.
        await page.waitForTimeout(100)
      }
    }

    await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
    expect(await bar.evaluate(element => {
      element.scrollLeft = 0
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
      return element.scrollLeft
    })).toBeCloseTo(120, 0)
  })

  test('contains quick speed wheel input at both ends', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await setWindowSize(app, page, { width: 1050, height: 850 })
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    const bar = page.locator('.ft-quick-playback-rate-bar')

    for (const presets of [overflowingPresets, [{ speed: 1 }]]) {
      await page.evaluate(presets => window.$store.dispatch(
        'updateQuickPlaybackSpeedBarOptions', JSON.stringify(presets)
      ), presets)
      await expect.poll(() => bar.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(presets.length > 1)

      for (const scrollSpeed of [100, 200]) {
        await page.evaluate(speed => window.$store.dispatch('updateScrollSpeed', speed), scrollSpeed)
        for (const edge of ['start', 'end']) {
          await page.evaluate(() => window.scrollTo(0, 100))
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
          const previousScrollLeft = await bar.evaluate((element, edge) => {
            element.scrollLeft = edge === 'start' ? 0 : element.scrollWidth
            return element.scrollLeft
          }, edge)
          await bar.hover()
          const previousPageScroll = await page.evaluate(() => window.scrollY)
          const delta = edge === 'start' ? -120 : 120
          for (const horizontal of [false, true]) {
            await page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta)
            // Wheel dispatch returns before Chromium applies its default scroll.
            await page.waitForTimeout(250)
            expect(await page.evaluate(() => window.scrollY)).toBe(previousPageScroll)
            expect(await bar.evaluate(element => element.scrollLeft)).toBe(previousScrollLeft)
          }
        }
      }
    }
  })

  test('uses available control space before clipping presets', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(presets => window.$store.dispatch(
      'updateQuickPlaybackSpeedBarOptions', JSON.stringify(presets)
    ), overflowingPresets)
    await page.locator('body').press('s')
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullWindow/)
    const bar = page.locator('.ft-quick-playback-rate-bar')
    for (const [index, width] of [1050, 1350, 1750].entries()) {
      await setWindowSize(app, page, { width, height: 850 + index * 10 })
      await expect.poll(() => bar.evaluate(element => (
        element.scrollWidth > element.clientWidth + 1 &&
          element.parentElement.querySelector('.shaka-spacer').getBoundingClientRect().width > 1
      ))).toBe(false)
    }
    await expect.poll(() => bar.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(640)
  })

  test('clamps scrolled presets after content and viewport changes', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await page.locator('body').press('s')
    const bar = page.locator('.ft-quick-playback-rate-bar')
    const view = await watchViewHandle(page)

    for (const [index, change] of ['resize', 'presets', 'labels', 'locale', 'save action', 'save label'].entries()) {
      await setWindowSize(app, page, { width: 1050 + index * 10, height: 850 + index * 10 })
      await page.evaluate(async presets => {
        const store = window.$store
        await store.dispatch('updateQuickPlaybackSpeedBarOptions', JSON.stringify(presets))
        await store.dispatch('updateAutoUpdateChannelPlaybackSpeeds', false)
        await store.dispatch('updateCurrentLocale', 'de-DE')
      }, overflowingPresets.map(preset => ({ ...preset, name: `Playback speed ${preset.speed}` })))
      await expect.poll(() => bar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
      const previousScrollLeft = await bar.evaluate(element => {
        element.scrollLeft = element.scrollWidth
        return element.scrollLeft
      })

      if (change === 'resize') {
        await setWindowSize(app, page, { width: 1350, height: 900 })
      } else if (change === 'save label') {
        await expect(bar.locator('.ft-quick-playback-rate-save')).toHaveAttribute('data-remove', 'false')
        await view.evaluate(view => view.saveChannelPlaybackSpeed(view.currentPlaybackRate))
        await expect(bar.locator('.ft-quick-playback-rate-save')).toHaveAttribute('data-remove', 'true')
      } else {
        await page.evaluate(async ({ change, presets }) => {
          const store = window.$store
          if (change === 'presets' || change === 'labels') {
            await store.dispatch('updateQuickPlaybackSpeedBarOptions', JSON.stringify(change === 'presets' ? presets.slice(0, 2) : presets))
          } else if (change === 'locale') {
            await store.dispatch('updateCurrentLocale', 'en-US')
          } else {
            await store.dispatch('updateAutoUpdateChannelPlaybackSpeeds', true)
          }
        }, { change, presets: overflowingPresets })
      }

      await expect.poll(() => bar.evaluate((element, previous) => {
        const bounds = element.getBoundingClientRect()
        const lastButton = element.querySelector('button:last-child').getBoundingClientRect()
        const padding = Number.parseFloat(getComputedStyle(element).paddingRight)
        return {
          offsetReduced: element.scrollLeft < previous,
          offsetValid: element.scrollLeft <= element.scrollWidth - element.clientWidth + 1,
          noEmptySpace: bounds.right - padding - lastButton.right <= 1,
          scrollbarHidden: getComputedStyle(element).scrollbarWidth === 'none'
        }
      }, previousScrollLeft), { message: `scroll range after ${change}` }).toEqual({ offsetReduced: true, offsetValid: true, noEmptySpace: true, scrollbarHidden: true })
    }
  })

  test('scrolls clipped presets with the mouse wheel without changing playback', async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await page.evaluate(presets => window.$store.dispatch(
      'updateQuickPlaybackSpeedBarOptions', JSON.stringify(presets)
    ), overflowingPresets)
    await setWindowSize(app, page, { width: 1050, height: 850 })
    await page.locator('body').press('s')
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    const bar = page.locator('.ft-quick-playback-rate-bar')
    await expect.poll(() => bar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
    const before = await video.evaluate(element => ({ rate: element.playbackRate, volume: element.volume }))
    for (const frosted of [true, false]) {
      await page.evaluate(frosted => window.$store.dispatch('updateUseFrostedGlassPlayerUi', frosted), frosted)
      await bar.locator('[data-rate="1"]').hover()
      // Hover can scroll the preset into view after the previous theme's end test.
      await bar.evaluate(element => { element.scrollLeft = 0 })
      await expect.poll(() => bar.evaluate(element => element.scrollLeft)).toBe(0)
      await page.mouse.wheel(0, 120)
      await expect.poll(() => bar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await page.mouse.wheel(0, -120)
      await expect.poll(() => bar.evaluate(element => element.scrollLeft)).toBe(0)
      await page.mouse.wheel(120, 0)
      await expect.poll(() => bar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await page.mouse.wheel(-120, 0)
      await expect.poll(() => bar.evaluate(element => element.scrollLeft)).toBe(0)
      for (const edge of ['start', 'end']) {
        expect(await bar.evaluate((element, edge) => {
          element.scrollLeft = edge === 'start' ? 0 : element.scrollWidth
          const previousScrollLeft = element.scrollLeft
          const event = new WheelEvent('wheel', {
            deltaY: edge === 'start' ? -120 : 120,
            bubbles: true,
            cancelable: true
          })
          let bubbled = false
          const onWheel = () => { bubbled = true }
          element.parentElement.addEventListener('wheel', onWheel, { once: true })
          element.dispatchEvent(event)
          element.parentElement.removeEventListener('wheel', onWheel)
          return {
            defaultPrevented: event.defaultPrevented,
            bubbled,
            offsetUnchanged: element.scrollLeft === previousScrollLeft
          }
        }, edge)).toEqual({ defaultPrevented: true, bubbled: false, offsetUnchanged: true })
      }
      await bar.evaluate(element => { element.scrollLeft = 0 })
      expect(await video.evaluate(element => ({ rate: element.playbackRate, volume: element.volume }))).toEqual(before)
      if (frosted) {
        await testInfo.attach('desktop quick speed controls', {
          body: await page.locator('.shaka-controls-button-panel').screenshot(),
          contentType: 'image/png'
        })
      }
    }
  })

  test('follows later player speed changes after a quick speed selection', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const bar = page.locator('.ft-quick-playback-rate-bar')
    const firstSpeed = bar.locator('[data-rate="1.25"]')
    const nextSpeed = bar.locator('[data-rate="1.5"]')

    // During playback, Shaka hides the forced controls whenever it next recomputes their visibility.
    await video.evaluate(element => element.pause())
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    await firstSpeed.click()
    await expect(firstSpeed).toHaveClass(/is-current-rate/)
    await video.evaluate(element => { element.playbackRate = 1.5 })
    await expect(nextSpeed).toHaveClass(/is-current-rate/)
    await expect(firstSpeed).not.toHaveClass(/is-current-rate/)
  })

  test('quick speeds fade in step with the bottom controls', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const result = await page.evaluate(async () => {
      const controls = document.querySelector('.shaka-controls-container')
      const panel = controls.querySelector('.shaka-controls-button-panel')
      const bar = panel.querySelector('.ft-quick-playback-rate-bar')
      const glass = panel.querySelector('.ft-right-control-glass')
      const layers = [glass, bar]
      controls.setAttribute('shown', 'true')
      layers.forEach(element => element.getAnimations().forEach(animation => animation.finish()))
      controls.removeAttribute('shown')
      for (const element of layers) {
        const fade = element.getAnimations().find(animation => animation.transitionProperty === 'opacity')
        if (!fade) throw new Error('Controls fade transition not found')
        fade.pause()
        fade.currentTime = 300
      }
      return {
        glassOpacity: Number(getComputedStyle(glass).opacity),
        barOpacity: Number(getComputedStyle(bar).opacity)
      }
    })
    expect(result.glassOpacity).toBeGreaterThan(0.1)
    expect(result.glassOpacity).toBeLessThan(0.9)
    expect(Math.abs(result.barOpacity - result.glassOpacity)).toBeLessThan(0.05)
  })

  test('uses the shaded glass surface', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const bar = page.locator('.ft-quick-playback-rate-bar')
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    await expect(bar).toBeVisible()
    await expect(bar).toHaveCSS('backdrop-filter', /blur\(10px\)/)
    const surface = await bar.evaluate(element => {
      const style = getComputedStyle(element)
      const visibleButton = [...element.querySelectorAll('button')]
        .find(button => button.getBoundingClientRect().height > 0)
      return {
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
        height: element.getBoundingClientRect().height,
        topInset: visibleButton.getBoundingClientRect().top - element.getBoundingClientRect().top
      }
    })
    expect(surface.backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
    expect(surface.backdropFilter).toContain('blur(10px)')
    expect(surface.boxShadow).not.toBe('none')
    expect(surface.height).toBe(34)
    expect(surface.topInset).toBeGreaterThanOrEqual(4)
    const currentRate = bar.locator('.ft-quick-playback-rate-button.is-current-rate')
    await expect(currentRate).toHaveCSS('min-height', '26px')
    await currentRate.hover()
    await expect(currentRate).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.22)')
    await expect(currentRate).toHaveCSS('background-image', /rgba\(255, 255, 255, 0.12\)/)
  })

  test('speed button hover does not stick on touchscreens', async ({ app, page }) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    const button = page.locator('.ft-quick-playback-rate-button:visible:not(.is-current-rate)').first()
    await expect(button).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
    await button.hover()
    await expect(button).toHaveCSS('background-image', 'none')
    await session.detach()
  })
})
