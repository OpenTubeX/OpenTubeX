import path from 'node:path'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'

import { abortUnmockedRequest, test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage } from '../../helpers/watch.mjs'

// A 1x1 PNG, small enough to stay well inside the avatar download limit
const AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OTHER_AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test.beforeEach(async ({ page }) => {
  // Keep the startup test's local server reachable; mock every remote service.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, abortUnmockedRequest)
})

/**
 * The cached files added since `baseline`, with a digest of their contents so
 * the assertions do not depend on how the cache names its entries.
 * @param {string} userDataDir
 * @param {Set<string>} [baseline]
 * @returns {Promise<Array<{name: string, digest: string}>>}
 */
async function listCachedFiles(userDataDir, baseline = new Set()) {
  const directory = path.join(userDataDir, 'tab-previews')
  const names = await readdir(directory).catch(() => [])
  const files = await Promise.all(names
    .filter(name => !baseline.has(name))
    .map(async name => ({
      name,
      digest: createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex')
    })))
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} channelId
 * @param {string} avatarBase64
 */
async function createChannelTabWithAvatar(page, channelId, avatarBase64) {
  return await page.evaluate(async ({ channelId, avatarBase64 }) => {
    const route = `/channel/${channelId}`
    const tab = await window.ftElectron.tabs.create({ route, makeActive: false, lazyLoad: true })
    const bytes = Uint8Array.from(atob(avatarBase64), character => character.charCodeAt(0))
    const applied = await window.ftElectron.tabs.updateAvatar(bytes.buffer, tab.id, route)
    return { id: tab.id, applied }
  }, { channelId, avatarBase64 })
}

for (const indicator of ['loading', 'playing']) {
  test(`loads and retains a watch avatar with the ${indicator} indicator`, async ({ page }) => {
    let avatarRequest
    await page.route('https://images.test/watch-avatar.png', route => {
      avatarRequest = route
    })
    const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/watch/cached-avatar',
      makeActive: false,
      lazyLoad: true
    }))
    const tab = page.locator(`.tab[data-tab-id="${watchTab.id}"]`)
    const setIndicator = enabled => page.evaluate(({ tabId, indicator, enabled }) => {
      if (indicator === 'loading') {
        window.ftElectron.tabs.setLoading(enabled, tabId)
      } else {
        window.ftElectron.tabs.setPlaybackState(enabled ? 'playing' : 'paused', tabId)
      }
    }, { tabId: watchTab.id, indicator, enabled })
    const statusIcon = tab.locator(indicator === 'loading' ? '.tabLoadingLine' : '.playingIcon')
    await setIndicator(true)
    await expect(statusIcon).toBeVisible()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setVideoAvatar', { videoId: 'cached-avatar', avatar: 'https://images.test/watch-avatar.png' })
    })
    await expect.poll(() => avatarRequest != null, { timeout: 2000 }).toBe(true)
    await avatarRequest.fulfill({ contentType: 'image/png', body: Buffer.from(AVATAR_PNG, 'base64') })
    const avatar = tab.locator('img.tabAvatar:not(.retryImagePlaceholder)')
    await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect(avatar).toBeVisible()
    const originalImage = await avatar.elementHandle()

    for (let transition = 0; transition < 2; transition++) {
      await setIndicator(false)
      await expect(statusIcon).toHaveCount(0)
      const firstFrame = await tab.evaluate(element => new Promise(resolve => requestAnimationFrame(() => {
        const image = element.querySelector('img.tabAvatar:not(.retryImagePlaceholder)')
        resolve({
          visible: image?.checkVisibility({ visibilityProperty: true }) === true,
          placeholder: [...element.querySelectorAll('.retryImagePlaceholder')].some(icon => icon.checkVisibility({ visibilityProperty: true }))
        })
      })))
      expect(firstFrame).toEqual({ visible: true, placeholder: false })
      expect(await avatar.evaluate((image, original) => image === original, originalImage)).toBe(true)
      await setIndicator(true)
      await expect(statusIcon).toBeVisible()
      await expect(avatar).toBeVisible()
    }
  })
}

test('tabs of the same channel share one cached avatar file', async ({ app, page }) => {
  // Previews of the tab that is already open are not part of this
  const baseline = new Set((await listCachedFiles(app.userDataDir)).map(file => file.name))

  const first = await createChannelTabWithAvatar(page, 'UCtestchannel', AVATAR_PNG)
  const second = await createChannelTabWithAvatar(page, 'UCtestchannel', AVATAR_PNG)
  expect(first.applied).toBe(true)
  expect(second.applied).toBe(true)

  // Byte identical avatars must be stored once, not once per tab
  await expect.poll(() => listCachedFiles(app.userDataDir, baseline)).toHaveLength(1)
  const [sharedAvatar] = await listCachedFiles(app.userDataDir, baseline)

  // A different channel still gets its own file
  const third = await createChannelTabWithAvatar(page, 'UCotherchannel', OTHER_AVATAR_PNG)
  expect(third.applied).toBe(true)
  await expect.poll(async () => {
    const files = await listCachedFiles(app.userDataDir, baseline)
    return new Set(files.map(file => file.digest)).size
  }).toBe(2)

  // Closing one of the two tabs must not pull the file out from under the other
  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), first.id)
  await expect(page.locator(`.tab[data-tab-id="${first.id}"]`)).toHaveCount(0)
  await expect.poll(async () => {
    const files = await listCachedFiles(app.userDataDir, baseline)
    return files.some(file => file.name === sharedAvatar.name)
  }).toBe(true)

  // The last tab letting go of it releases the file
  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), second.id)
  await expect(page.locator(`.tab[data-tab-id="${second.id}"]`)).toHaveCount(0)
  await expect.poll(async () => {
    const files = await listCachedFiles(app.userDataDir, baseline)
    return files.some(file => file.name === sharedAvatar.name)
  }).toBe(false)
})

test.describe('loading missing tab icons', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        defaultInvidiousInstance: 'https://invidious.test',
        backendFallback: false
      }
    }
  })

  test('manually retries an unloaded tab icon after automatic loading fails', async ({ page }) => {
    let metadataRequests = 0
    await page.route('https://invidious.test/api/v1/channels/UCmissing?*', route => {
      metadataRequests++
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          authorThumbnails: metadataRequests === 1 ? [] : [{ url: 'https://images.test/avatar.png' }],
          tabs: []
        })
      })
    })
    await page.route('https://images.test/avatar.png', route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(AVATAR_PNG, 'base64')
    }))

    const { tabId, activeTabId } = await page.evaluate(async () => {
      const activeTabId = (await window.ftElectron.tabs.getState()).activeTabId
      const tab = await window.ftElectron.tabs.create({
        route: '/channel/UCmissing',
        makeActive: false,
        lazyLoad: true
      })
      return { tabId: tab.id, activeTabId }
    })
    await expect.poll(() => metadataRequests).toBe(1)

    const themeSection = await goToSettingsSection(page, 'theme')
    const loadButton = themeSection.getByRole('button', { name: 'Load Missing Tab Icons' })
    await loadButton.click()
    const toast = page.locator('.toast', { hasText: 'Missing tab icon loaded: 1' })
    await expect(toast).toBeVisible()
    await expect(toast.locator('.icon[data-prefix="fas"][data-icon="check"]')).toBeVisible()
    await expect(loadButton).toBeDisabled()

    await expect.poll(() => page.evaluate(tabId => {
      return window.ftElectron.tabs.getState().then(state => {
        const tab = state.tabs.find(candidate => candidate.id === tabId)
        return {
          activeTabId: state.activeTabId,
          avatarLoaded: tab?.avatarUrl?.startsWith('data:image/jpeg;base64,') === true,
          isUnloaded: tab?.isUnloaded
        }
      })
    }, tabId)).toEqual({
      activeTabId,
      avatarLoaded: true,
      isUnloaded: true
    })
  })

  test('shows an error icon when an icon cannot be loaded', async ({ page }) => {
    let metadataRequests = 0
    await page.route('https://invidious.test/api/v1/channels/UCmissing?*', route => {
      metadataRequests++
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ authorThumbnails: [], tabs: [] })
      })
    })

    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/channel/UCmissing',
      makeActive: false,
      lazyLoad: true
    }))
    await expect.poll(() => metadataRequests).toBe(1)

    // Updating unrelated tab metadata must not keep retrying a failed icon.
    await page.evaluate(tabId => window.ftElectron.tabs.updateTitle('Missing channel', tabId), tab.id)
    await expect(page.locator(`.tab[data-tab-id="${tab.id}"] .tabTitleText`)).toHaveText('Missing channel')
    expect(metadataRequests).toBe(1)

    const themeSection = await goToSettingsSection(page, 'theme')
    await themeSection.getByRole('button', { name: 'Load Missing Tab Icons' }).click()

    const toast = page.locator('.toast', { hasText: 'Loaded 0 tab icons; 1 could not be loaded' })
    await expect(toast).toBeVisible()
    await expect(toast.locator('.icon[data-prefix="fas"][data-icon="circle-exclamation"]')).toBeVisible()
    expect(metadataRequests).toBe(2)
  })

  for (const [path, endpoint] of [
    ['/watch/background-video', '/videos/background-video'],
    ['/channel/UCbackground', '/channels/UCbackground']
  ]) {
    test(`automatically caches a newly opened unloaded ${path.startsWith('/watch/') ? 'video' : 'channel'} tab icon`, async ({ page }) => {
      let metadataRequests = 0
      let avatarRequest
      await page.route(`https://invidious.test/api/v1${endpoint}*`, route => {
        metadataRequests++
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            authorThumbnails: [{ url: 'https://images.test/background-avatar.png' }],
            tabs: []
          })
        })
      })
      await page.route('https://images.test/background-avatar.png', route => {
        avatarRequest = route
      })

      const { tabId, activeTabId } = await page.evaluate(async path => {
        const activeTabId = (await window.ftElectron.tabs.getState()).activeTabId
        const tab = await window.ftElectron.tabs.create({ route: path, makeActive: false, lazyLoad: true })
        return { tabId: tab.id, activeTabId }
      }, path)
      await expect.poll(() => avatarRequest != null).toBe(true)

      // A pending download must survive tab state changes without restarting.
      for (const isLoading of [true, false]) {
        await page.evaluate(({ tabId, isLoading }) => {
          window.ftElectron.tabs.setLoading(isLoading, tabId)
        }, { tabId, isLoading })
        await expect.poll(() => page.evaluate(async tabId => {
          return (await window.ftElectron.tabs.getState()).tabs.find(tab => tab.id === tabId)?.isLoading
        }, tabId)).toBe(isLoading)
      }
      await avatarRequest.fulfill({ contentType: 'image/png', body: Buffer.from(AVATAR_PNG, 'base64') })

      await expect.poll(() => page.evaluate(async tabId => {
        const state = await window.ftElectron.tabs.getState()
        const tab = state.tabs.find(candidate => candidate.id === tabId)
        return {
          activeTabId: state.activeTabId,
          avatarLoaded: tab?.avatarUrl?.startsWith('data:image/jpeg;base64,') === true,
          isUnloaded: tab?.isUnloaded
        }
      }, tabId), { timeout: 5000 }).toEqual({ activeTabId, avatarLoaded: true, isUnloaded: true })

      const avatar = page.locator(`.tab[data-tab-id="${tabId}"] img.tabAvatar:not(.retryImagePlaceholder)`)
      await expect(avatar).toBeVisible()
      await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
      expect(metadataRequests).toBe(1)
    })
  }

  test('limits avatar downloads across separately opened background tabs', async ({ page }) => {
    let metadataRequests = 0
    let activeDownloads = 0
    let maximumDownloads = 0
    const downloads = []
    await page.route('https://invidious.test/api/v1/channels/UCburst*', route => {
      metadataRequests++
      const channelId = new URL(route.request().url()).pathname.split('/').at(-1)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ authorThumbnails: [{ url: `https://images.test/${channelId}.png` }], tabs: [] })
      })
    })
    await page.route('https://images.test/UCburst*.png', route => {
      activeDownloads++
      maximumDownloads = Math.max(maximumDownloads, activeDownloads)
      downloads.push(route)
    })
    const activeTabId = await page.evaluate(async () => (await window.ftElectron.tabs.getState()).activeTabId)
    const tabIds = []
    for (let index = 0; index < 6; index++) {
      const tab = await page.evaluate(index => window.ftElectron.tabs.create({
        route: `/channel/UCburst${index}`, makeActive: false, lazyLoad: true
      }), index)
      tabIds.push(tab.id)
      await expect(page.locator(`.tab[data-tab-id="${tab.id}"]`)).toBeVisible()
      if (index < 4) await expect.poll(() => downloads.length).toBe(index + 1)
    }
    expect(metadataRequests).toBe(4)

    for (let index = 0; index < 6; index++) {
      await expect.poll(() => downloads.length).toBeGreaterThan(index)
      activeDownloads--
      await downloads[index].fulfill({ contentType: 'image/png', body: Buffer.from(AVATAR_PNG, 'base64') })
    }
    await expect.poll(() => page.evaluate(async tabIds => {
      const state = await window.ftElectron.tabs.getState()
      return {
        activeTabId: state.activeTabId,
        avatarsLoaded: tabIds.every(id => state.tabs.some(tab => tab.id === id && tab.avatarUrl && tab.isUnloaded))
      }
    }, tabIds)).toEqual({ activeTabId, avatarsLoaded: true })
    expect(metadataRequests).toBe(6)
    expect(maximumDownloads).toBe(4)
  })

  test('leaves foreground avatar loading to the channel page', async ({ page }) => {
    let metadataRequests = 0
    await page.route('https://invidious.test/api/v1/channels/UCforeground?*', route => {
      metadataRequests++
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          author: 'Foreground channel',
          authorId: 'UCforeground',
          authorThumbnails: [{ url: 'https://images.test/foreground-avatar.png' }],
          authorBanners: [],
          description: '',
          subCount: 0,
          totalViews: 0,
          joined: 0,
          tabs: [],
          latestVideos: [],
          relatedChannels: []
        })
      })
    })
    await page.route('https://images.test/foreground-avatar.png', route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(AVATAR_PNG, 'base64')
    }))
    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/channel/UCforeground',
      makeActive: true
    }))
    await expect.poll(() => page.evaluate(async tabId => {
      const state = await window.ftElectron.tabs.getState()
      const tab = state.tabs.find(candidate => candidate.id === tabId)
      return { activeTabId: state.activeTabId, avatarLoaded: Boolean(tab?.avatarUrl), isUnloaded: tab?.isUnloaded }
    }, tab.id)).toEqual({ activeTabId: tab.id, avatarLoaded: true, isUnloaded: false })
    expect(metadataRequests).toBe(1)
  })
})

for (const routePath of ['/watch/jNQXAC9IVRw', '/channel/UCn_FAXem2-e3HQvmK-mOH4g']) {
  test(`automatically caches an unloaded ${routePath.startsWith('/watch/') ? 'video' : 'channel'} avatar with the Local backend`, async ({ app, page }) => {
    await mockUnplayableWatchPage(app, page)
    if (routePath.startsWith('/channel/')) {
      const response = gunzipSync(await readFile(new URL('../../fixtures/innertube/channel/loads-the-glitch-channel-home-and-playlists-tabs/browse-4f0ffb6cfdfa.0.json.gz', import.meta.url)))
      await page.route('**/youtubei/v1/browse*', route => route.fulfill({ contentType: 'application/json', body: response }))
    }
    await page.route(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\//, route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(AVATAR_PNG, 'base64')
    }))
    const { tabId, activeTabId } = await page.evaluate(async routePath => {
      const activeTabId = (await window.ftElectron.tabs.getState()).activeTabId
      const tab = await window.ftElectron.tabs.create({ route: routePath, makeActive: false, lazyLoad: true })
      return { tabId: tab.id, activeTabId }
    }, routePath)
    await expect.poll(() => page.evaluate(async tabId => {
      const state = await window.ftElectron.tabs.getState()
      const tab = state.tabs.find(candidate => candidate.id === tabId)
      return { activeTabId: state.activeTabId, avatarLoaded: Boolean(tab?.avatarUrl), isUnloaded: tab?.isUnloaded }
    }, tabId)).toEqual({ activeTabId, avatarLoaded: true, isUnloaded: true })
    const avatar = page.locator(`.tab[data-tab-id="${tabId}"] img.tabAvatar:not(.retryImagePlaceholder)`)
    await expect(avatar).toBeVisible()
    await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  })
}

test.describe('automatic missing tab icons', () => {
  const server = createServer()
  const seed = {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: '',
      startupBehavior: 'restoreTabLoadState'
    },
    tabSessions: [{
      _id: 'avatar-startup-session',
      value: {
        tabs: [{
          id: 'active-tab',
          url: 'app://bundle/index.html#/history',
          title: 'History',
          isUnloaded: false
        }, {
          id: 'missing-avatar-tab',
          url: 'app://bundle/index.html#/channel/UCstartup',
          title: 'Unloaded channel',
          isUnloaded: true
        }],
        activeTabId: 'active-tab',
        bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
      }
    }]
  }

  test.use({ seed })

  test.beforeAll(async () => {
    server.on('request', (request, response) => {
      if (request.url?.startsWith('/api/v1/channels/UCstartup')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          authorThumbnails: [{ url: `${seed.settings.defaultInvidiousInstance}/avatar.png` }],
          tabs: []
        }))
      } else if (request.url === '/avatar.png') {
        response.setHeader('content-type', 'image/png')
        response.end(Buffer.from(AVATAR_PNG, 'base64'))
      } else {
        response.statusCode = 404
        response.end()
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    seed.settings.defaultInvidiousInstance = `http://127.0.0.1:${address.port}`
  })

  test.afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  test('loads restored icons on startup and disables the completed action', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => {
      return window.ftElectron.tabs.getState().then(state => {
        const tab = state.tabs.find(candidate => candidate.id === 'missing-avatar-tab')
        return {
          activeTabId: state.activeTabId,
          avatarLoaded: tab?.avatarUrl?.startsWith('data:image/jpeg;base64,') === true,
          isUnloaded: tab?.isUnloaded
        }
      })
    })).toEqual({
      activeTabId: 'active-tab',
      avatarLoaded: true,
      isUnloaded: true
    })

    const themeSection = await goToSettingsSection(page, 'theme')
    await expect(themeSection.getByRole('button', { name: 'Load Missing Tab Icons' })).toBeDisabled()
  })
})
