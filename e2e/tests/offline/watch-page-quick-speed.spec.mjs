import { sel, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { DEMO_MEDIA_URL } from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED, mockMusicMediaType } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test.describe('desktop quick playback speed bar', () => {
  test.use({ seed: { settings: { ...WATCH_PAGE_SEED, useQuickPlaybackSpeedBar: true } } })

  const overflowingPresets = Array.from({ length: 24 }, (_, index) => ({ speed: 0.5 + index * 0.25 }))

  test('keeps speed changes during audio format unload', async ({ app, page }) => {
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
      await view.evaluate(view => { view.activeFormat = 'audio' })
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

  test('keeps quick bar speed changes while a legacy quality waits for availability', async ({ app, page }) => {
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
    await openPlayerOptions(player)
    await player.locator('.legacy-quality-button').click()
    await player.locator('.legacy-qualities').getByRole('menuitemradio', { name: '240p', exact: true }).click()
    expect(await view.evaluate(view => view.$refs.player.hasLoaded)).toBe(true)
    expect(await page.evaluate(() => window.speedQualityLoaded)).toBe(false)
    await player.evaluate(element => element.ui.getControls().hideSettingsMenus())
    await bar.locator('[data-rate="1.5"]').click()
    await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
    await expect.poll(() => page.evaluate(() => window.speedQualityLoaded), { timeout: 15_000 }).toBe(true)
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
    await expect(bar.locator('[data-rate="1.5"]')).toHaveClass(/is-current-rate/)
  })

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

  for (const control of ['menu', 'normal-speed toggle']) {
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
          const selectedRate = 1.5
          const player = page.locator(`${activeTab} .ftVideoPlayer`)
          await openPlayerOptions(player)
          await player.locator('.shaka-playbackrate-button').click()
          const menu = player.locator('.shaka-playback-rates')
          await menu.locator(`.shaka-playback-rate-preset-btn[data-rate="${selectedRate}"]`).click()
          await openPlayerOptions(player)
          await player.locator('.shaka-playbackrate-button').click()
          await expect(menu.locator(`.shaka-playback-rate-preset-btn[data-rate="${selectedRate}"]`)).toHaveAttribute('aria-checked', 'true')
          await menu.locator('.shaka-back-to-overflow-button').click()
          await player.getByRole('button', { name: 'More settings', exact: true }).click()
        }
        const rate = control === 'normal-speed toggle' ? 1 : 1.75
        await page.locator('body').press(control === 'normal-speed toggle' ? 'g' : 'p')
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

  test('keeps quick speed selections made before the music video loads', async ({ app, page }) => {
    await mockMusicMediaType(app, page, 'MUSIC_VIDEO_TYPE_OMV')
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
      // Like openMockedVideo, allow for parsing the uncached player script.
      await expect(bar).toBeVisible({ timeout: 30_000 })
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
})
