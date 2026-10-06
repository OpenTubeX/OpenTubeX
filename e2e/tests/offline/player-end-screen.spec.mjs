import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { test, expect, setWindowSize, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      playNextVideo: false,
      hideRecommendedVideos: true,
      hideEndScreenAnnotations: false,
    }
  }
})

async function endVideo(video) {
  await video.evaluate(element => {
    element.currentTime = element.duration - 0.1
    return element.play()
  })
  await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
}

async function openVideo({ app, page }) {
  await mockPlayableWatchPage(app, page)
  await page.route('https://i.ytimg.com/**', route => route.fulfill({
    path: fileURLToPath(new URL('../../fixtures/media/video-thumbnail.svg', import.meta.url)),
    contentType: 'image/svg+xml'
  }))
  const video = await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => {
    component.proxy.videoAnnotations = [{
      id: 'end-video',
      type: 'VIDEO',
      title: 'Annotated video',
      startTime: 0,
      endTime: 1000,
      left: 0.6,
      top: 0.2,
      width: 0.3,
      aspectRatio: 16 / 9,
      route: '/watch/aqz-KE-bpKQ',
      thumbnail: component.proxy.thumbnail,
    }]
  })
  return { video, watch }
}

for (const dataSaver of [false, true]) {
  test(`reuses the startup poster and its resolution fallback with data saver ${dataSaver}`, async ({ app, page }) => {
    await page.evaluate(async dataSaver => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAutoplayVideos', false)
      await store.dispatch('updateThumbnailDataSaver', dataSaver)
    }, dataSaver)
    await mockPlayableWatchPage(app, page)
    const requests = []
    await page.route('https://i.ytimg.com/**', route => {
      requests.push(route.request().url())
      if (/\/(?:maxres|sd)default.jpg$/.test(route.request().url())) {
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"/>'
        })
      }
      return route.fulfill({
        path: fileURLToPath(new URL('../../fixtures/media/video-thumbnail.svg', import.meta.url)),
        contentType: 'image/svg+xml'
      })
    })
    await page.evaluate(() => window.ftElectron.tabs.create({ route: '/watch/jNQXAC9IVRw' }))
    const video = page.locator('.ftVideoPlayer video')
    const startup = page.locator('.countdownPoster img:not(.retryImagePlaceholder)')
    await expect(startup).toBeVisible()
    await expect(startup).toHaveAttribute('src', new RegExp(`/${dataSaver ? 'mq' : 'hq'}default.jpg$`))
    await expect(video).not.toHaveAttribute('poster', /.+/)
    if (dataSaver) {
      expect(requests).toEqual(['https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg'])
    }
    const poster = await startup.elementHandle()
    const startupPoster = await startup.getAttribute('src')
    await expect.poll(() => video.evaluate(element => element.duration)).toBeGreaterThan(1)
    await startup.evaluate(image => {
      window.__posterReloads = 0
      image.addEventListener('load', () => { window.__posterReloads++ })
    })
    for (let repeat = 0; repeat < 2; repeat++) {
      await endVideo(video)
      const ended = page.locator('.endedPoster img:not(.retryImagePlaceholder)')
      await expect(ended).toHaveAttribute('src', startupPoster)
      expect(await ended.evaluate((image, original) => image === original, poster)).toBe(true)
      await expect(page.locator('.endedPoster .retryImagePlaceholder')).toHaveCount(0)
      expect(await page.evaluate(() => window.__posterReloads)).toBe(0)
      await video.evaluate(element => { element.currentTime = 1 })
      await expect(page.locator('.endedPoster')).toHaveCount(0)
    }
  })
}

test('shows an already loaded poster without flashing its placeholder on each video end', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  const svg = await readFile(new URL('../../fixtures/media/video-thumbnail.svg', import.meta.url), 'utf8')
  await watch.evaluate(async (component, svg) => {
    const src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    const image = new Image()
    image.src = src
    await image.decode()
    component.proxy.thumbnail = src
    await component.proxy.$nextTick()
  }, svg)
  for (let repeat = 0; repeat < 2; repeat++) {
    const frames = await page.evaluateHandle(() => {
      const state = { placeholders: 0, posters: 0 }
      let frame
      const sample = () => {
        const poster = document.querySelector('.endedPoster')
        if (poster) {
          state.posters++
          if (poster.querySelector('.retryImagePlaceholder')) state.placeholders++
        }
        frame = requestAnimationFrame(sample)
      }
      frame = requestAnimationFrame(sample)
      return { state, stop: () => cancelAnimationFrame(frame) }
    })
    await endVideo(video)
    await expect(page.locator('.endedPoster img:not(.retryImagePlaceholder)')).toBeVisible()
    const observed = await frames.evaluate(async ({ state, stop }) => {
      await new Promise(resolve => requestAnimationFrame(resolve))
      stop()
      return state
    })
    expect(observed.posters).toBeGreaterThan(0)
    expect(observed.placeholders, 'cached posters must be ready at the first painted frame').toBe(0)
    await video.evaluate(element => { element.currentTime = 1 })
    await expect(page.locator('.endedPoster')).toHaveCount(0)
  }
})

test('restores the poster and hides annotations at the end, then clears it on seek and replay', async ({ app, page }) => {
  const { video } = await openVideo({ app, page })
  await expect(page.locator('.videoAnnotations')).toBeVisible()
  await endVideo(video)
  const poster = page.locator('.endedPoster')
  await expect(poster).toBeVisible()
  await expect(poster.locator('img:not(.retryImagePlaceholder)')).toHaveCSS('opacity', '0.35')
  await expect.poll(() => poster.locator('img:not(.retryImagePlaceholder)').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('.videoAnnotations')).toHaveCount(0)
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await video.evaluate(element => { element.currentTime = 1 })
  await expect(poster).toHaveCount(0)
  await expect(page.locator('.videoAnnotations')).toBeVisible()
  await endVideo(video)
  await expect(poster).toBeVisible()
  await page.locator('.shaka-controls-button-panel .shaka-play-button').click()
  await expect(poster).toHaveCount(0)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('hides only end-screen recommendations when the focused setting is enabled', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.recommendedVideos = [{ videoId: 'video000000', title: 'Next video', type: 'video' }]
  })
  await endVideo(video)
  await expect(page.locator('.endedRecommendation')).toHaveCount(1)
  await expect(page.locator('.watchVideoRecommendations')).toBeVisible()

  await watch.evaluate(component => component.proxy.$store.dispatch('updateHideEndScreenRecommendations', true))
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await expect(page.locator('.watchVideoRecommendations')).toBeVisible()
  await expect(page.locator('.endedPoster')).toBeVisible()
  await expect(page.locator('.videoAnnotations')).toHaveCount(0)

  await watch.evaluate(component => component.proxy.$store.dispatch('updateHideEndScreenRecommendations', false))
  await expect(page.locator('.endedRecommendation')).toHaveCount(1)
})

test('shows recommended thumbnails over a darkened poster with working keyboard navigation', async ({ app, page, attachScreenshot }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.recommendedVideos = Array.from({ length: 8 }, (_, index) => ({
      videoId: `video00000${index}`,
      title: `Recommended video ${index + 1}`,
      author: 'Example channel',
      authorId: 'example-channel',
      type: 'video',
      lengthSeconds: 120,
    }))
  })
  const titleStyle = element => {
    const style = getComputedStyle(element)
    return Object.fromEntries([
      'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
      'backgroundImage', 'fontSize', 'fontWeight', 'lineHeight', 'textShadow'
    ].map(property => [property, /^[\d.]+px$/.test(style[property])
      ? Math.round(parseFloat(style[property]) * 10) / 10
      : style[property]]))
  }
  const annotationTitleStyle = await page.locator('.annotationTitle').evaluate(titleStyle)
  await endVideo(video)
  const cards = page.locator('.endedRecommendation')
  await expect(cards).toHaveCount(6)
  await expect.poll(() => cards.first().locator('.endedRecommendationTitle').evaluate(titleStyle)).toEqual(annotationTitleStyle)
  await expect(cards.first().locator('.endedRecommendationTitleText')).toBeVisible()
  await expect(cards.first().locator('.endedRecommendationTitleText')).toHaveText('Recommended video 1')
  await expect(page.locator('.endedPoster img:not(.retryImagePlaceholder)')).toHaveCSS('opacity', '0.35')
  await expect(cards.first()).toHaveAttribute('href', '#/watch/video000000')
  await expect(cards.first().locator('img:not(.retryImagePlaceholder)')).toHaveAttribute('src', /\/vi\/video000000\/maxresdefault.jpg$/)
  await watch.evaluate(component => component.proxy.$store.dispatch('updateThumbnailDataSaver', true))
  await expect(cards.first().locator('img:not(.retryImagePlaceholder)')).toHaveAttribute('src', /\/vi\/video000000\/mqdefault.jpg$/)
  await watch.evaluate(component => component.proxy.$store.dispatch('updateThumbnailDataSaver', false))
  await expect(cards.first().locator('img:not(.retryImagePlaceholder)')).toHaveAttribute('src', /\/vi\/video000000\/maxresdefault.jpg$/)
  await expect.poll(() => cards.first().locator('img:not(.retryImagePlaceholder)').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await cards.first().click({ trial: true })
  await attachScreenshot('video ended with recommendations')
  await setPlayerFullscreen(page, true)
  await expect(cards.first()).toBeVisible()
  await cards.first().click({ trial: true })
  await setPlayerFullscreen(page, false)
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await setWindowSize(app, page, { width: 480, height: 800 })
  const grid = page.locator('.endedRecommendations')
  await expect.poll(() => grid.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  await expect(cards.first()).toBeVisible()
  await expect(cards.nth(4)).toBeHidden()
  await expect(cards.first().locator('.endedRecommendationTitleText')).toBeVisible()
  await attachScreenshot('video ended in a narrow player')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateBlurThumbnails', true))
  await expect(cards.first().locator('img:not(.retryImagePlaceholder)')).toHaveCSS('filter', 'blur(20px)')
  await expect(cards.first().locator('.endedRecommendationTitle')).toHaveCSS('filter', 'none')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateBlurThumbnails', false))
  await expect(cards.first().locator('img:not(.retryImagePlaceholder)')).toHaveCSS('filter', 'none')
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateThumbnailPreference', 'hidden')
  })
  await expect(cards.first().locator('img:not(.retryImagePlaceholder)')).toHaveAttribute('src', /thumbnail_placeholder/)
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', true)
  })
  await expect(grid).toHaveCount(0)
  await expect(page.locator('.endedPoster img:not(.retryImagePlaceholder)')).toHaveCSS('opacity', '0.35')
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
  })
  await cards.first().focus()
  await cards.first().press('Enter')
  await expect(page).toHaveURL(/#\/watch\/video000000$/)
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await waitForPlayback(page)
})

test('shows the poster and recommendations after canceling autoplay, and starts a fresh countdown on replay', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.autoplayNextRecommendedVideo = true
    component.proxy.recommendedVideos = [{ videoId: 'video000000', title: 'Next video', type: 'video' }]
  })
  await endVideo(video)
  await expect(page.locator('.autoplayCountdownOverlay')).toBeVisible()
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await page.locator('.autoplayCountdownOverlay').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.autoplayCountdownOverlay')).toHaveCount(0)
  await expect(page.locator('.endedPoster')).toBeVisible()
  await expect(page.locator('.endedRecommendation')).toBeVisible()
  await expect(page.locator('.endedRecommendation')).toHaveAttribute('aria-label', 'Next video')
  expect(await watch.evaluate(component => component.proxy.autoplayEnabled)).toBe(true)
  expect(await watch.evaluate(component => component.proxy.playNextTimeout)).toBeNull()
  await video.evaluate(element => { element.currentTime = 1 })
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await endVideo(video)
  await expect(page.locator('.autoplayCountdownOverlay')).toBeVisible()
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
})

for (const defaultInterval of [0, 1]) {
  test(`does not flash the end screen when autoplay advances after ${defaultInterval} seconds`, async ({ app, page }) => {
    const { video, watch } = await openVideo({ app, page })
    await watch.evaluate(async (component, interval) => {
      await component.proxy.$store.dispatch('updateDefaultInterval', interval)
      component.proxy.autoplayNextRecommendedVideo = true
      component.proxy.recommendedVideos = [{ videoId: 'video000000', title: 'Next video', type: 'video' }]
    }, defaultInterval)
    const endScreen = await page.evaluateHandle(() => {
      const state = { appeared: false }
      const observer = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && (node.matches('.endedPoster') || node.querySelector('.endedPoster'))) {
              state.appeared = true
            }
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      return { state, observer }
    })
    await video.evaluate(element => {
      element.currentTime = element.duration - 0.1
      return element.play()
    })
    await expect(page).toHaveURL(/#\/watch\/video000000$/)
    expect(await endScreen.evaluate(({ state, observer }) => {
      observer.disconnect()
      return state.appeared
    })).toBe(false)
  })
}

for (const continuationState of ['pending', 'failed', 'delayed', 'delayed-loop']) {
  test(`YouTube playlist autoplay advances with a ${continuationState} continuation request`, async ({ app, page }) => {
    const { watch } = await openVideo({ app, page })
    const atBoundary = continuationState.startsWith('delayed')
    let requested = false
    let releaseContinuation
    const continuationGate = new Promise(resolve => { releaseContinuation = resolve })
    await page.route('**/youtubei/v1/browse**', async route => {
      if (route.request().postDataJSON()?.continuation !== 'autoplay-continuation') return route.fallback()
      requested = true
      if (continuationState !== 'failed') await continuationGate
      if (atBoundary) {
        await route.fulfill({
          json: {
            onResponseReceivedActions: [{
              appendContinuationItemsAction: {
                continuationItems: [{
                  playlistVideoRenderer: {
                    videoId: 'video000000',
                    title: { simpleText: 'Second video', accessibility: { accessibilityData: { label: 'Second video' } } },
                    index: { simpleText: '2' },
                    shortBylineText: { runs: [{ text: 'Test', navigationEndpoint: { browseEndpoint: { browseId: 'UCtest' } } }] },
                    thumbnail: { thumbnails: [] },
                    isPlayable: true,
                    lengthSeconds: '10',
                    lengthText: { simpleText: '0:10' },
                    navigationEndpoint: { watchEndpoint: { videoId: 'video000000' } }
                  }
                }]
              }
            }]
          }
        })
      } else {
        await route.fulfill({ status: 500, body: 'Continuation failed' })
      }
    })
    try {
      await watch.evaluate(async (component, atBoundary) => {
        const view = component.proxy
        await view.$store.dispatch('updateDefaultInterval', 3)
        view.$store.commit('setCachedPlaylist', {
          tabId: view.tabId,
          value: {
            id: 'youtube-autoplay',
            title: 'YouTube autoplay regression',
            totalVideoCount: 100,
            channelName: 'Test',
            channelId: '',
            items: [{ videoId: 'jNQXAC9IVRw', title: 'First video', lengthSeconds: 10 }, ...(atBoundary ? [] : [{ videoId: 'video000000', title: 'Second video', lengthSeconds: 10 }])],
            continuationData: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20261006.00.00' }, user: {}, request: {} },
              path: '/browse',
              payload: { continuation: 'autoplay-continuation' }
            })
          }
        })
        await view.tabRouter.push({ path: '/watch/jNQXAC9IVRw', query: { playlistId: 'youtube-autoplay' } })
      }, atBoundary)
      await expect.poll(() => requested).toBe(true)
      const video = await waitForPlayback(page)
      await watch.evaluate(component => { component.proxy.autoplayNextPlaylistVideo = true })
      if (continuationState === 'delayed-loop') await page.getByRole('button', { name: 'Loop Playlist', exact: true }).click()
      await expect(page.locator('.watchVideoPlaylist p').filter({ hasText: 'unavailable' })).toHaveCount(0)
      await endVideo(video)
      if (atBoundary) {
        await expect.poll(() => watch.evaluate(component => component.proxy.waitingForPlaylistContinuation)).toBe(true)
        await expect(page.locator('.autoplayCountdownOverlay')).toHaveCount(0)
        await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?playlistId=youtube-autoplay/)
        releaseContinuation()
      }
      await expect(page.locator('.autoplayCountdownOverlay')).toBeVisible()
      await expect(page.locator('.autoplayTitle')).toHaveText('Second video')
      await expect(page).toHaveURL(/#\/watch\/video000000\?playlistId=youtube-autoplay/)
      await waitForPlayback(page)
    } finally {
      releaseContinuation()
    }
  })
}

test('filters hidden and current videos and keeps the poster darkened when none remain', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    await component.proxy.$store.dispatch('updateForbiddenTitles', JSON.stringify(['blocked']))
    await component.proxy.$store.dispatch('updateChannelsHidden', JSON.stringify([{ name: 'hidden-channel' }]))
    component.proxy.recommendedVideos = [
      { videoId: component.proxy.videoId, title: 'Current video' },
      { videoId: 'video000001', title: 'Blocked title' },
      { videoId: 'video000002', title: 'Hidden channel video', authorId: 'hidden-channel' },
      { videoId: 'video000003', title: 'Visible video' },
    ]
  })
  await endVideo(video)
  await expect(page.locator('.endedRecommendation')).toHaveCount(1)
  await expect(page.locator('.endedRecommendation')).toHaveAttribute('aria-label', 'Visible video')
  await watch.evaluate(component => { component.proxy.recommendedVideos = [] })
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await expect(page.locator('.endedPoster')).toBeVisible()
  await expect(page.locator('.endedPoster img:not(.retryImagePlaceholder)')).toHaveCSS('opacity', '0.35')
})

test('uses original recommendation titles only for the entire-app preference and handles late replies', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  const requests = []
  let releaseTitle
  const titleReady = new Promise(resolve => { releaseTitle = resolve })
  await page.route('https://www.youtube.com/oembed**', async route => {
    requests.push(route.request().url())
    await titleReady
    if (route.request().url().includes('video000010')) {
      await route.fulfill({ status: 404, json: {} })
      return
    }
    const title = route.request().url().includes('video000009') ? 'Another original title' : 'Original recommendation title'
    await route.fulfill({ json: { title } })
  })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.recommendedVideos = [{ videoId: 'video000008', title: 'Translated recommendation title', type: 'video' }]
  })
  await endVideo(video)
  const card = page.locator('.endedRecommendation')
  await expect(card).toHaveAttribute('title', 'Translated recommendation title')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'watch_only'))
  await expect(card).toHaveAttribute('title', 'Translated recommendation title')
  expect(requests).toHaveLength(0)
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'entire_app'))
  await expect.poll(() => requests.length).toBe(1)
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'disabled'))
  const originalResponse = page.waitForResponse('https://www.youtube.com/oembed**')
  releaseTitle()
  await (await originalResponse).finished()
  await expect(card).toHaveAttribute('title', 'Translated recommendation title')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'entire_app'))
  await expect(card).toHaveAttribute('title', 'Original recommendation title')
  await expect(card).toHaveAttribute('aria-label', 'Original recommendation title')
  await expect(card.locator('.endedRecommendationTitleText')).toHaveText('Original recommendation title')
  expect(requests).toHaveLength(1)
  await watch.evaluate(component => {
    component.proxy.recommendedVideos = [{ videoId: 'video000009', title: 'Another translated title', type: 'video' }]
  })
  await expect.poll(() => requests.length).toBe(2)
  await expect(card).toHaveAttribute('title', 'Another original title')
  // A failed title can be requested by both sidebar and end-screen cards.
  const missingTitleResponse = page.waitForResponse('https://www.youtube.com/oembed**video000010**')
  await watch.evaluate(component => {
    component.proxy.recommendedVideos = [{ videoId: 'video000010', title: 'Fallback title', type: 'video' }]
  })
  await (await missingTitleResponse).finished()
  await expect(card).toHaveAttribute('title', 'Fallback title')
})

test('hides the VR canvas behind the finished poster and restores it after seeking', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(component => { component.proxy.vrProjection = 'EQUIRECTANGULAR' })
  const canvas = page.locator('.vrCanvas')
  await expect(canvas).toBeVisible()
  await canvas.evaluate(element => {
    const context = element.getContext('2d')
    context.fillStyle = 'red'
    context.fillRect(0, 0, element.width, element.height)
  })
  await endVideo(video)
  await expect(page.locator('.endedPoster')).toBeVisible()
  await expect(canvas).toBeHidden()
  await video.evaluate(element => { element.currentTime = 1 })
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await expect(canvas).toBeVisible()
})

test('player fades respect the app motion preference over the system preference', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await video.evaluate(element => element.pause())
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateShowLightsOffToggle', true)
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.recommendedVideos = [{
      videoId: 'video000000',
      title: 'Recommended video',
      author: 'Example channel',
      authorId: 'example-channel',
      type: 'video',
      lengthSeconds: 120,
    }]
  })

  for (const [system, preference, animated] of [
    ['reduce', 'off', true],
    ['reduce', 'system', false],
    ['no-preference', 'on', false],
    ['no-preference', 'system', true],
  ]) {
    await page.emulateMedia({ reducedMotion: system })
    await watch.evaluate((component, preference) => component.proxy.$store.dispatch('updateReducedMotion', preference), preference)
    const enterDuration = await watch.evaluate(async component => {
      const player = document.querySelector('.ftVideoPlayer')
      component.proxy.$store.commit('setTabLightsOff', { tabId: player.dataset.tabId, value: true })
      await component.proxy.$nextTick()
      return getComputedStyle(document.querySelector('.lightsOffOverlay')).transitionDuration
    })
    expect(enterDuration).toBe(animated ? '0.3s' : '0s')
    await expect(page.locator('.lightsOffOverlay')).toHaveCSS('opacity', '1')
    // Finish entering before testing the separate exit transition.
    await expect(page.locator('.lightsOffOverlay')).not.toHaveClass(/lights-off-enter-active/)
    const leaveDuration = await watch.evaluate(async component => {
      const player = document.querySelector('.ftVideoPlayer')
      component.proxy.$store.commit('setTabLightsOff', { tabId: player.dataset.tabId, value: false })
      await component.proxy.$nextTick()
      const overlay = document.querySelector('.lightsOffOverlay')
      return overlay ? getComputedStyle(overlay).transitionDuration : '0s'
    })
    expect(leaveDuration).toBe(animated ? '0.2s' : '0s')
    await expect(page.locator('.lightsOffOverlay')).toHaveCount(0)

    await endVideo(video)
    await expect(page.locator('.endedRecommendations')).toHaveCSS('animation-name', animated ? /^ended-recommendations-appear(?:-|$)/ : 'none')
    await video.evaluate(element => { element.currentTime = 1 })
    await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  }
})
