import path from 'node:path'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

import { abortUnmockedRequest, test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage } from '../../helpers/watch.mjs'

// A 1x1 PNG, small enough to stay well inside the avatar download limit
const AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OTHER_AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
})

/**
 * The cached avatars added since `baseline`, with a digest of their contents.
 * Preview screenshots share this directory but are not avatar cache entries.
 * @param {string} userDataDir
 * @param {Set<string>} [baseline]
 * @returns {Promise<Array<{name: string, digest: string}>>}
 */
async function listCachedAvatars(userDataDir, baseline = new Set()) {
  const directory = path.join(userDataDir, 'tab-previews')
  const names = await readdir(directory).catch(() => [])
  const files = await Promise.all(names
    .filter(name => name.startsWith('avatar-') && !baseline.has(name))
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

test('does not restore a cached avatar when navigating away during decoding', async ({ page }) => {
  await page.route('https://images.test/old-avatar.png', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(AVATAR_PNG, 'base64')
  }))
  const background = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/old-avatar', makeActive: false, lazyLoad: true
  }))
  await page.evaluate(() => {
    window.$store.commit('setVideoAvatar', {
      videoId: 'old-avatar', avatar: 'https://images.test/old-avatar.png'
    })
  })
  const tab = page.locator(`.tabBar .tab[data-tab-id="${background.id}"]`)
  const avatar = tab.locator('img.tabAvatar:not(.retryImagePlaceholder)')
  await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await page.evaluate(async ({ tabId, png }) => {
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = async function () {
      await new Promise(resolve => { window.__finishAvatarDecode = resolve })
      return decode.call(this)
    }
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
    await window.ftElectron.tabs.updateAvatar(bytes.buffer, tabId, '/watch/old-avatar')
  }, { tabId: background.id, png: AVATAR_PNG })
  await expect.poll(() => page.evaluate(() => typeof window.__finishAvatarDecode)).toBe('function')
  await expect(avatar).toHaveAttribute('src', 'https://images.test/old-avatar.png')
  await expect(avatar).toBeVisible()
  await page.evaluate(tabId => {
    const route = { path: '/history', fullPath: '/history' }
    const store = window.$store
    store.commit('setTabNavigation', { tabId, route, history: [{ route }], historyIndex: 0 })
    window.ftElectron.tabs.updateRoute({ tabId, route })
  }, background.id)
  await expect(avatar).toHaveCount(0)
  await page.evaluate(() => window.__finishAvatarDecode())
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(avatar).toHaveCount(0)
  await expect(tab.locator('.tabPageIcon')).toBeVisible()
})

test('tabs of the same channel share one cached avatar file', async ({ app, page }) => {
  // Ignore any avatars already cached before this test.
  const baseline = new Set((await listCachedAvatars(app.userDataDir)).map(file => file.name))

  // Previews share the directory and can arrive after the initial snapshot.
  const previewTab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', makeActive: true }))
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    return state.presentedTabId
  }).toBe(previewTab.id)
  const preview = await page.evaluate(tabId => window.ftElectron.tabs.capturePreview(tabId), previewTab.id)
  expect(preview).toMatch(/^data:image\/jpeg/)

  const first = await createChannelTabWithAvatar(page, 'UCtestchannel', AVATAR_PNG)
  const second = await createChannelTabWithAvatar(page, 'UCtestchannel', AVATAR_PNG)
  expect(first.applied).toBe(true)
  expect(second.applied).toBe(true)

  // Byte identical avatars must be stored once, not once per tab
  await expect.poll(() => listCachedAvatars(app.userDataDir, baseline)).toHaveLength(1)
  const [sharedAvatar] = await listCachedAvatars(app.userDataDir, baseline)

  // A different channel still gets its own file
  const third = await createChannelTabWithAvatar(page, 'UCotherchannel', OTHER_AVATAR_PNG)
  expect(third.applied).toBe(true)
  await expect.poll(async () => {
    const files = await listCachedAvatars(app.userDataDir, baseline)
    return new Set(files.map(file => file.digest)).size
  }).toBe(2)

  // Closing one of the two tabs must not pull the file out from under the other
  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), first.id)
  await expect(page.locator(`.tab[data-tab-id="${first.id}"]`)).toHaveCount(0)
  await expect.poll(async () => {
    const files = await listCachedAvatars(app.userDataDir, baseline)
    return files.some(file => file.name === sharedAvatar.name)
  }).toBe(true)

  // The last tab letting go of it releases the file
  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), second.id)
  await expect(page.locator(`.tab[data-tab-id="${second.id}"]`)).toHaveCount(0)
  await expect.poll(async () => {
    const files = await listCachedAvatars(app.userDataDir, baseline)
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
