import path from 'node:path'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

// A 1x1 PNG, small enough to stay well inside the avatar download limit
const AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OTHER_AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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

  test('caches an unloaded tab icon without activating the tab', async ({ page }) => {
    await page.route('https://invidious.test/api/v1/channels/UCmissing?*', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authorThumbnails: [{ url: 'https://images.test/avatar.png' }],
        tabs: []
      })
    }))
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
    await page.route('https://invidious.test/api/v1/channels/UCmissing?*', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ authorThumbnails: [], tabs: [] })
    }))

    await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/channel/UCmissing',
      makeActive: false,
      lazyLoad: true
    }))

    const themeSection = await goToSettingsSection(page, 'theme')
    await themeSection.getByRole('button', { name: 'Load Missing Tab Icons' }).click()

    const toast = page.locator('.toast', { hasText: 'Loaded 0 tab icons; 1 could not be loaded' })
    await expect(toast).toBeVisible()
    await expect(toast.locator('.icon[data-prefix="fas"][data-icon="circle-exclamation"]')).toBeVisible()
  })
})

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
