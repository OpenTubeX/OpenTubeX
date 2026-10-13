import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  launchArgs: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      fetchSubscriptionsAutomatically: false,
      useSponsorBlock: false,
      playNextVideo: false,
      keepPlayingOnNavigation: false,
      hideSideBarOnWatchPages: false,
      reducedMotion: 'on'
    }
  }
})

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`caption resources in ${usePlayerMenuGrid ? 'grid' : 'list'} menus`, () => {
    test.use({ seed: { settings: { usePlayerMenuGrid } } })

    test('collects replaced caption and translation choices during playback', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      const video = await openMockedVideo(page)
      await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().length)).toBeGreaterThan(0)
      await video.evaluate(element => element.pause())
      const watch = await page.evaluateHandle(findWatchComponent)
      const session = await page.context().newCDPSession(page)
      try {
        await page.evaluate(() => { window.__replacedCaptionChoices = [] })
        for (let index = 0; index < 40; index++) {
          await watch.evaluate(async (component, index) => {
            const host = document.querySelector('.ftVideoPlayer')
            const controls = host.ui.getControls()
            const player = controls.getPlayer()
            const oldOff = host.querySelector('.shaka-turn-captions-off-button')
            window.__replacedCaptionChoices.push(new WeakRef(oldOff))
            // Track refreshes rebuild Shaka's caption choices even when the
            // selected track is unchanged (for example, manifest updates).
            player.dispatchEvent({ type: 'trackschanged' })
            for (const button of host.querySelectorAll('.ft-caption-translation-options button')) {
              window.__replacedCaptionChoices.push(new WeakRef(button))
            }
            component.proxy.captionTranslations = component.proxy.captionTranslations.map(choice => ({
              ...choice, url: `${choice.url.split('&resource=')[0]}&resource=${index}`
            }))
            await component.proxy.$nextTick()
            controls.dispatchEvent({ type: 'submenuopen' })
            controls.dispatchEvent({ type: 'submenuclose' })
            await new Promise(resolve => requestAnimationFrame(resolve))
          }, index)
        }
        await expect.poll(async () => {
          await session.send('HeapProfiler.collectGarbage')
          return page.evaluate(() => window.__replacedCaptionChoices.filter(reference => reference.deref()).length)
        }).toBe(0)
        // The currently rendered choices must retain their working handlers.
        await video.evaluate(element => {
          const player = element.ui.getControls().getPlayer()
          player.selectTextTrack(player.getTextTracks()[0])
        })
        await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().some(track => track.active))).toBe(true)
        await page.locator('.shaka-turn-captions-off-button').evaluate(element => element.click())
        await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().some(track => track.active))).toBe(false)
      } finally {
        await watch.dispose()
        await session.detach()
      }
    })

    test('collects old menu trees after player controls are rebuilt', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      await expect(page.locator('.ft-caption-appearance-menu')).toHaveCount(1)
      await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().length)).toBeGreaterThan(0)
      const session = await page.context().newCDPSession(page)
      try {
        const rebuild = () => page.locator('.ftVideoPlayer').evaluate(async element => {
          // The same rebuild occurs when responsive layout changes call
          // configureUI; keep the config fixed to isolate its lifecycle.
          const controls = element.ui.getControls()
          controls.configure(controls.getConfig())
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        })
        const sample = async () => {
          // Collect both JavaScript bindings and the native DOM trees they held.
          for (let index = 0; index < 3; index++) {
            await session.send('HeapProfiler.collectGarbage')
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          }
          return session.send('Memory.getDOMCounters')
        }
        // Measure the fully customized layout rather than first-load controls.
        await rebuild()
        await rebuild()
        const baseline = await sample()
        for (const scale of [1, 1.25]) {
          await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
          for (let index = 0; index < 20; index++) {
            await rebuild()
          }
          const current = await sample()
          expect(current.nodes - baseline.nodes).toBeLessThan(500)
          expect(current.jsEventListeners - baseline.jsEventListeners).toBeLessThan(100)
        }
        // New controls remain interactive after releasing the previous layout.
        await page.locator('.shaka-overflow-menu-button').evaluate(element => element.click())
        await expect(page.locator('.shaka-overflow-menu')).toBeVisible()
        await page.locator('.shaka-caption-button').evaluate(element => element.click())
        await expect(page.locator('.shaka-text-languages')).toBeVisible()
        await page.locator('.ft-caption-options-button').evaluate(element => element.click())
        await expect(page.locator('.ft-caption-appearance-menu')).toBeVisible()
      } finally {
        await session.detach()
      }
    })
  })
}

async function navigateAway(page) {
  await page.locator('.sideNav').getByRole('button', { name: 'Playlists', exact: true }).click()
  await expect(page).toHaveURL(/#\/userplaylists/)
  await expect(page.locator('video')).toHaveCount(0)
}

async function rememberVideo(page) {
  await page.locator('.tabContent[aria-hidden="false"] video').evaluate(element => {
    window.__resourceProfileVideos ??= []
    window.__resourceProfileVideos.push(new WeakRef(element))
  })
}

async function sampleResources(app, page, session, label) {
  await page.waitForTimeout(300)
  for (let index = 0; index < 3; index++) {
    await session.send('HeapProfiler.collectGarbage')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  const dom = await session.send('Memory.getDOMCounters')
  const metrics = Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
  const main = await app.electronApp.evaluate(() => {
    globalThis.gc?.()
    return process.memoryUsage()
  })
  const retainedVideos = await page.evaluate(() => window.__resourceProfileVideos.filter(reference => reference.deref()).length)
  const sample = { label, heapMiB: metrics.JSHeapUsedSize / 1024 ** 2, ...dom, retainedVideos, mainHeapMiB: main.heapUsed / 1024 ** 2 }
  console.log('Resource profile:', sample)
  return sample
}

test('releases playback resources after repeated videos and tab unloading', async ({ app, page }, testInfo) => {
  test.setTimeout(180_000)
  await mockPlayableWatchPage(app, page)
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const samples = []
  try {
    for (let index = 0; index < 3; index++) {
      await openMockedVideo(page)
      await rememberVideo(page)
      await navigateAway(page)
    }
    const baseline = await sampleResources(app, page, session, 'warmed up')
    samples.push(baseline)
    for (let index = 0; index < 12; index++) {
      await openMockedVideo(page, `profile-${String(index).padStart(3, '0')}`)
      await rememberVideo(page)
      if ((index + 1) % 4 === 0) {
        await navigateAway(page)
        samples.push(await sampleResources(app, page, session, `after ${index + 1} videos`))
      }
    }

    const tabIds = []
    for (let index = 0; index < 8; index++) {
      const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/userplaylists', makeActive: true }))
      tabIds.push(tab.id)
      const video = await openMockedVideo(page)
      await rememberVideo(page)
      await video.evaluate(element => element.pause())
    }
    samples.push(await sampleResources(app, page, session, '8 loaded watch tabs'))
    await page.evaluate(async ids => {
      const state = await window.ftElectron.tabs.getState()
      window.ftElectron.tabs.activate(state.tabs.find(tab => !ids.includes(tab.id)).id)
      for (const id of ids) await window.ftElectron.tabs.runOrganizerAction('unload', [id])
    }, tabIds)
    await expect(page.locator('video')).toHaveCount(0)
    samples.push(await sampleResources(app, page, session, '8 unloaded watch tabs'))
    await page.evaluate(async ids => {
      for (const id of ids) await window.ftElectron.tabs.close(id)
    }, tabIds)
    // Avatar downloads have a five-second deadline. Let those bounded requests
    // settle before checking whether disposed video elements can be collected.
    await expect.poll(async () => {
      await session.send('HeapProfiler.collectGarbage')
      return page.evaluate(() => window.__resourceProfileVideos.filter(reference => reference.deref()).length)
    }, { timeout: 10_000 }).toBe(0)
    const final = await sampleResources(app, page, session, 'tabs closed')
    samples.push(final)
    await testInfo.attach('resource-profile', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
    expect.soft(final.retainedVideos).toBe(0)
    expect.soft(final.jsEventListeners - baseline.jsEventListeners).toBeLessThan(100)
    expect.soft(final.nodes - baseline.nodes).toBeLessThan(1000)
    expect.soft(final.heapMiB - baseline.heapMiB).toBeLessThan(8)
  } finally {
    await session.detach()
  }
})

test('collects removed scrollbar images and updates overflow when surviving images load', async ({ page }) => {
  const session = await page.context().newCDPSession(page)
  try {
    for (const zoomFactor of [1, 1.25]) {
      await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoomFactor)
      await page.evaluate(() => {
        const viewport = document.createElement('div')
        viewport.dataset.resourceImageScroller = ''
        Object.assign(viewport.style, {
          position: 'fixed',
          top: '100px',
          left: '100px',
          width: '200px',
          height: '100.5px',
          overflowY: 'auto',
          zIndex: '9999'
        })
        for (const height of [300, 40]) {
          const image = document.createElement('img')
          image.style.display = 'block'
          image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height}"/>`)}`
          viewport.append(image)
        }
        document.body.append(viewport)
        document.querySelector('#app').__vue_app__._context.directives['overlay-scrollbars'].mounted(viewport, { value: true })
        window.__removedScrollbarImage = new WeakRef(viewport.querySelector('img'))
      })
      const viewport = page.locator('[data-resource-image-scroller]')
      const scrollbar = viewport.locator(':scope > .os-scrollbar-vertical')
      await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(200)
      await viewport.evaluate(element => {
        element.scrollTop = element.scrollHeight
        element.querySelector('img').remove()
      })
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
      await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
      await expect.poll(async () => {
        await session.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.__removedScrollbarImage.deref() == null)
      }).toBe(true)

      for (const height of [600, 40]) {
        await viewport.evaluate((element, height) => {
          element.scrollTop = element.scrollHeight
          element.querySelector('img').src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height}"/>`)}`
        }, height)
        if (height === 600) {
          await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
          await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(490)
        } else {
          await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
          await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
          await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
        }
      }
      await viewport.evaluate(element => {
        document.querySelector('#app').__vue_app__._context.directives['overlay-scrollbars'].unmounted(element)
        element.remove()
      })
    }
  } finally {
    await session.detach()
  }
})

test('keeps many unloaded tabs lightweight after repeated player reloads', async ({ app, page }, testInfo) => {
  test.setTimeout(180_000)
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await rememberVideo(page)
  await navigateAway(page)
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  try {
    await expect.poll(async () => {
      await session.send('HeapProfiler.collectGarbage')
      return page.evaluate(() => window.__resourceProfileVideos.every(reference => reference.deref() == null))
    }, { timeout: 10_000 }).toBe(true)
    const baseline = await sampleResources(app, page, session, 'before unloaded tabs')
    const { originalTabId, tabIds } = await page.evaluate(async () => {
      const originalTabId = (await window.ftElectron.tabs.getState()).activeTabId
      const tabIds = []
      for (let index = 0; index < 40; index++) {
        const tab = await window.ftElectron.tabs.create({
          route: '/watch/jNQXAC9IVRw', makeActive: false, lazyLoad: true
        })
        tabIds.push(tab.id)
      }
      return { originalTabId, tabIds }
    })
    await expect.poll(() => page.evaluate(async ids => {
      const state = await window.ftElectron.tabs.getState()
      return state.tabs.filter(tab => ids.includes(tab.id) && tab.isUnloaded).length
    }, tabIds)).toBe(40)
    await expect(page.locator('video')).toHaveCount(0)
    const unloaded = await sampleResources(app, page, session, '40 unloaded watch tabs')
    expect(unloaded.retainedVideos).toBe(0)
    expect(unloaded.heapMiB - baseline.heapMiB).toBeLessThan(8)

    const reloadSamples = []
    for (let index = 0; index < 24; index++) {
      const id = tabIds[index % 2]
      await page.evaluate(id => window.ftElectron.tabs.activate(id), id)
      await waitForPlayback(page)
      await rememberVideo(page)
      await page.evaluate(async ({ originalTabId, id }) => {
        await window.ftElectron.tabs.activate(originalTabId)
        await window.ftElectron.tabs.runOrganizerAction('unload', [id])
      }, { originalTabId, id })
      await expect(page.locator('video')).toHaveCount(0)
      if ((index + 1) % 6 === 0) {
        reloadSamples.push(await sampleResources(app, page, session, `after ${index + 1} player reloads`))
      }
    }
    await expect.poll(async () => {
      await session.send('HeapProfiler.collectGarbage')
      return page.evaluate(() => window.__resourceProfileVideos.every(reference => reference.deref() == null))
    }, { timeout: 10_000 }).toBe(true)
    const reloaded = await sampleResources(app, page, session, '40 unloaded tabs after 24 player reloads')
    expect(reloaded.heapMiB - unloaded.heapMiB).toBeLessThan(8)
    expect(reloaded.nodes - unloaded.nodes).toBeLessThan(1000)
    expect(reloaded.jsEventListeners - unloaded.jsEventListeners).toBeLessThan(100)
    await testInfo.attach('unloaded-tab-profile', {
      body: JSON.stringify([baseline, unloaded, ...reloadSamples, reloaded], null, 2), contentType: 'application/json'
    })
  } finally {
    await session.detach()
  }
})
