import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import { DEFAULT_CUSTOM_THEME } from '../../../src/customTheme.js'

const syncServerUrl = process.env.OPENTUBEX_SYNC_SERVER_URL
const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw'
const secondChannelId = 'UC-lHJZR3Gqxm24_Vd_AJ5Yw'
const remoteChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'

async function getSyncCapabilities() {
  const response = await fetch(`${syncServerUrl}/health`)
  if (!response.ok) return {}
  const health = await response.json()
  return health.capabilities ?? {}
}

function rateLimitClient(testInfo) {
  const title = `${testInfo.file}\0${testInfo.titlePath.join('\0')}`
  let hash = 2166136261
  for (const character of title) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `10.${hash & 0xff}.${(hash >>> 8) & 0xff}.${(hash >>> 16) & 0xff}`
}

test.describe('OpenTubeX sync server', () => {
  test.skip(!syncServerUrl, 'Set OPENTUBEX_SYNC_SERVER_URL to run the local sync-server test')

  test.beforeEach(async ({ page }, testInfo) => {
    await page.route('**/account/**', route => route.continue({
      headers: {
        ...route.request().headers(),
        'X-Forwarded-For': rateLimitClient(testInfo)
      }
    }))
  })

  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        syncServerEnabled: true,
        channelPlaybackSpeeds: JSON.stringify({ [channelId]: 1.5 })
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: channelId,
          name: 'Rick Astley',
          thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
        }, {
          id: secondChannelId,
          name: 'PewDiePie',
          thumbnail: 'https://yt3.googleusercontent.com/ytc/default'
        }]
      }, {
        _id: 'music-profile',
        name: 'Music',
        bgColor: '#123456',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: channelId,
          name: 'Rick Astley',
          thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
        }]
      }, {
        _id: 'creators-profile',
        name: 'Creators',
        bgColor: '#654321',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: secondChannelId,
          name: 'PewDiePie',
          thumbnail: 'https://yt3.googleusercontent.com/ytc/default'
        }]
      }],
      playlists: [{
        _id: 'sync-playlist',
        playlistName: 'Synced playlist',
        description: 'Created in OpenTubeX',
        protected: false,
        videos: [],
        createdAt: Date.now(),
        lastUpdatedAt: Date.now()
      }],
      history: [{
        _id: 'dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
        author: 'Rick Astley',
        authorId: channelId,
        published: Date.now() - 60000,
        description: '',
        lengthSeconds: 213,
        watchProgress: 45,
        isWatched: false,
        timeWatched: Date.now(),
        isLive: false,
        type: 'video'
      }]
    }
  })

  test('pushes local data from multiple profiles and pulls remote changes', async ({ app, page }) => {
    const username = `opentubex-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const enhancedPrivacy = (await getSyncCapabilities()).encrypted_sync === 1
    const bulkRequests = []
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname
      if (pathname.endsWith('/bulk')) bulkRequests.push(pathname)
    })

    const syncSection = await goToSettingsSection(page, 'sync')
    const serverUrlInput = syncSection.getByLabel('Server URL')
    await serverUrlInput.fill(syncServerUrl)
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill('local-test-password')
    if (enhancedPrivacy) {
      await syncSection.getByLabel(/Privacy passphrase/).fill('local-test-privacy-passphrase')
    }
    await syncSection.getByRole('button', { name: 'Register' }).click()
    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
    if (enhancedPrivacy) {
      await expect(syncSection.getByText(/Enhanced privacy is enabled/)).toBeVisible()
      await expect(syncSection.getByLabel('Open tabs and session')).toBeVisible()
      expect(bulkRequests).toEqual([])
    } else {
      await expect(syncSection.getByText(/does not support enhanced privacy/)).toBeVisible()
      expect(bulkRequests).toEqual(expect.arrayContaining([
        '/v1/subscriptions/bulk',
        '/v1/watch_history/bulk'
      ]))
    }
    await expect(serverUrlInput).toHaveValue(syncServerUrl.replace(/\/$/, ''))

    const settingsPath = path.join(app.userDataDir, 'settings.db')
    await expect.poll(async () => {
      const settings = latestSettings(await readFile(settingsPath, 'utf8'))
      return settings.syncServerToken
    }).not.toBe('')

    const settings = latestSettings(await readFile(settingsPath, 'utf8'))
    expect(settings.syncServerUrl).toBe(syncServerUrl.replace(/\/$/, ''))
    expect(settings.syncServerPrivacyMode).toBe(enhancedPrivacy ? 'enhanced' : 'legacy')
    expect(Boolean(settings.syncServerPrivacyKey)).toBe(enhancedPrivacy)
    const headers = {
      Authorization: settings.syncServerToken,
      'Content-Type': 'application/json'
    }
    const versionedSubscriptionsResponse = await fetch(`${syncServerUrl}/v1/subscriptions/`, { headers })
    const apiPrefix = versionedSubscriptionsResponse.status === 404 ? '' : '/v1'
    if (enhancedPrivacy) {
      expect(versionedSubscriptionsResponse.status).toBe(409)
      const encryptedResponse = await fetch(`${syncServerUrl}/v1/encrypted_sync`, { headers })
      const encryptedManifest = await encryptedResponse.json()
      expect(encryptedManifest.collections.map(entry => entry.collection)).toEqual(
        expect.arrayContaining([
          'subscriptions',
          'playlists',
          'history',
          'playbackSpeeds',
          'profiles',
          'sessions',
          'settings'
        ])
      )
      for (const { collection, revision } of encryptedManifest.collections) {
        expect(revision).toBeGreaterThan(0)
        const collectionResponse = await fetch(
          `${syncServerUrl}/v1/encrypted_sync/${collection}`,
          { headers }
        )
        const encryptedCollection = await collectionResponse.json()
        expect(encryptedCollection.payload).not.toContain(channelId)
        expect(encryptedCollection.payload).not.toContain('Synced playlist')
        expect(encryptedCollection.payload).not.toContain('dQw4w9WgXcQ')
        expect(encryptedCollection.payload).not.toContain('Music')
        expect(encryptedCollection.payload).not.toContain('Creators')
        expect(encryptedCollection.payload).not.toContain('dark')
        expect(encryptedCollection.payload).not.toContain('app://')
      }
    } else {
      const subscriptionsResponse = apiPrefix
        ? versionedSubscriptionsResponse
        : await fetch(`${syncServerUrl}/subscriptions/`, { headers })
      const subscriptions = await subscriptionsResponse.json()
      expect(subscriptions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: channelId }),
        expect.objectContaining({ id: secondChannelId })
      ]))

      const playlistsResponse = await fetch(`${syncServerUrl}${apiPrefix}/playlists/`, { headers })
      expect(await playlistsResponse.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'Synced playlist' })
      ]))

      const historyResponse = await fetch(`${syncServerUrl}${apiPrefix}/watch_history/?page=1`, { headers })
      expect(historyResponse.ok).toBe(true)
      expect(await historyResponse.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          video: expect.objectContaining({
            id: 'dQw4w9WgXcQ',
            uploader: expect.objectContaining({
              avatar: 'https://yt3.googleusercontent.com/ytc/default'
            })
          })
        })
      ]))

      const playbackSpeedsResponse = await fetch(
        `${syncServerUrl}${apiPrefix}/channel_playback_speeds/`,
        { headers }
      )
      expect(playbackSpeedsResponse.ok).toBe(true)
      expect(await playbackSpeedsResponse.json()).toEqual(expect.arrayContaining([
        { channel_id: channelId, playback_speed: 1.5 }
      ]))

      const profilesResponse = await fetch(
        `${syncServerUrl}${apiPrefix}/subscriptions/groups/`,
        { headers }
      )
      expect(profilesResponse.ok).toBe(true)
      expect(await profilesResponse.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          group: expect.objectContaining({ title: 'Music' }),
          channels: expect.arrayContaining([expect.objectContaining({ id: channelId })])
        }),
        expect.objectContaining({
          group: expect.objectContaining({ title: 'Creators' }),
          channels: expect.arrayContaining([expect.objectContaining({ id: secondChannelId })])
        })
      ]))

      const putPlaybackSpeedResponse = await fetch(
        `${syncServerUrl}${apiPrefix}/channel_playback_speeds/`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ channel_id: remoteChannelId, playback_speed: 2 })
        }
      )
      expect(putPlaybackSpeedResponse.ok).toBe(true)

      const addRemoteResponse = await fetch(`${syncServerUrl}${apiPrefix}/subscriptions/`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          id: remoteChannelId,
          name: 'Google for Developers',
          avatar: 'https://i.ytimg.com/vi/7V-fIGMDsmE/hqdefault.jpg',
          verified: false
        })
      })
      expect(addRemoteResponse.ok).toBe(true)
    }

    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    if (!enhancedPrivacy) {
      await expect.poll(async () => {
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
        return records
          .filter(record => record._id === 'allChannels' && !record.$$deleted)
          .at(-1)
          ?.subscriptions
          .find(channel => channel.id === remoteChannelId)
      }).toEqual(expect.objectContaining({
        id: remoteChannelId,
        thumbnail: null
      }))
      await expect.poll(async () => {
        const syncedSettings = latestSettings(await readFile(settingsPath, 'utf8'))
        return JSON.parse(syncedSettings.channelPlaybackSpeeds || '{}')
      }).toEqual({
        [channelId]: 1.5,
        [remoteChannelId]: 2
      })
    }

    await syncSection.getByRole('button', { name: 'Delete sync account' }).click()
    const deleteAccountPrompt = page.getByRole('dialog', { name: 'Delete sync account?' })
    const deleteAccountPassword = deleteAccountPrompt.getByLabel('Password')
    await deleteAccountPassword.fill('wrong-password')
    await deleteAccountPrompt.getByRole('button', { name: 'Delete account' }).click()
    await expect(deleteAccountPrompt.getByRole('alert')).toBeVisible()
    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()

    await deleteAccountPassword.fill('local-test-password')
    await deleteAccountPrompt.getByRole('button', { name: 'Delete account' }).click()
    await expect(deleteAccountPrompt).toBeHidden()
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeVisible()

    const deletedAccountLoginResponse = await fetch(`${syncServerUrl}${apiPrefix}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: username, password: 'local-test-password' })
    })
    expect(deletedAccountLoginResponse.ok).toBe(false)

    expect(await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')).toContain(channelId)
    expect(await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')).toContain('sync-playlist')
    expect(await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')).toContain('dQw4w9WgXcQ')
  })

  test('syncs custom themes and their deletion', async ({ app, page }) => {
    const enhancedPrivacy = (await getSyncCapabilities()).encrypted_sync === 1
    test.skip(!enhancedPrivacy, 'Enhanced privacy server required')

    const username = `opentubex-themes-${randomUUID()}`
    const theme = {
      ...structuredClone(DEFAULT_CUSTOM_THEME),
      id: 'synced-theme',
      name: 'Synced Theme',
      colors: {
        ...DEFAULT_CUSTOM_THEME.colors,
        background: '#123456',
      },
    }
    const themePath = path.join(app.userDataDir, 'themes', `${theme.id}.json`)
    const settingsPath = path.join(app.userDataDir, 'settings.db')

    await page.evaluate(async customTheme => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const themes = await window.ftElectron.saveCustomTheme(customTheme)
      store.commit('setCustomThemes', themes)
    }, theme)

    const syncSection = await goToSettingsSection(page, 'sync')
    await syncSection.getByLabel('Server URL').fill(syncServerUrl)
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill('local-test-password')
    await syncSection.getByLabel(/Privacy passphrase/).fill('local-test-privacy-passphrase')
    await syncSection.getByRole('button', { name: 'Register' }).click()
    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
    await expect.poll(async () => {
      const settings = latestSettings(await readFile(settingsPath, 'utf8'))
      return JSON.parse(settings.syncServerSnapshot).settings.customThemes.value
    }).toEqual([theme])

    async function syncNow() {
      const previousSyncAt = latestSettings(await readFile(settingsPath, 'utf8')).syncServerLastSyncAt
      await syncSection.getByRole('button', { name: 'Sync now' }).click()
      await expect.poll(async () => (
        latestSettings(await readFile(settingsPath, 'utf8')).syncServerLastSyncAt
      )).not.toBe(previousSyncAt)
    }

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('setSyncServerAutoSync', false)
      const themes = await window.ftElectron.replaceCustomThemes([])
      store.commit('setCustomThemes', themes)
      await store.dispatch('updateSyncServerSnapshot', '')
    })
    await syncNow()
    await expect.poll(async () => {
      const settings = latestSettings(await readFile(settingsPath, 'utf8'))
      return JSON.parse(settings.syncServerSnapshot).settings.customThemes.value
    }).toEqual([theme])
    await expect.poll(async () => JSON.parse(await readFile(themePath, 'utf8'))).toMatchObject({
      id: theme.id,
      name: theme.name,
      colors: { background: '#123456' },
    })

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const themes = await window.ftElectron.replaceCustomThemes([])
      await store.dispatch('updateCustomThemes', themes)
    })
    await syncNow()

    await page.evaluate(async customTheme => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const themes = await window.ftElectron.replaceCustomThemes([customTheme])
      store.commit('setCustomThemes', themes)
      await store.dispatch('updateSyncServerSnapshot', '')
    }, theme)
    await syncNow()
    await expect.poll(async () => readFile(themePath, 'utf8').then(
      () => true,
      error => error.code !== 'ENOENT'
    )).toBe(false)
  })

  test('migrates existing plaintext data before locking the account', async ({ app, page }, testInfo) => {
    const enhancedPrivacy = (await getSyncCapabilities()).encrypted_sync === 1
    test.skip(!enhancedPrivacy, 'Enhanced privacy server required')

    const username = `opentubex-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const password = 'local-test-password'
    const registerResponse = await fetch(`${syncServerUrl}/v1/account/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': rateLimitClient(testInfo)
      },
      body: JSON.stringify({ name: username, password })
    })
    expect(registerResponse.ok).toBe(true)
    const { jwt } = await registerResponse.json()
    const headers = {
      Authorization: jwt,
      'Content-Type': 'application/json'
    }
    const legacySubscriptionResponse = await fetch(`${syncServerUrl}/v1/subscriptions/`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: remoteChannelId,
        name: 'Google for Developers',
        avatar: 'https://yt3.googleusercontent.com/ytc/default',
        verified: false
      })
    })
    expect(legacySubscriptionResponse.ok).toBe(true)

    let legacyHistoryDownloads = 0
    const encryptedUploadResponses = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.pathname.endsWith('/watch_history/')) {
        legacyHistoryDownloads++
      }
    })
    page.on('response', response => {
      const request = response.request()
      const url = new URL(request.url())
      if (request.method() === 'PUT' && url.pathname.startsWith('/v1/encrypted_sync/')) {
        encryptedUploadResponses.push(response)
      }
    })

    const syncSection = await goToSettingsSection(page, 'sync')
    await syncSection.getByLabel('Server URL').fill(syncServerUrl)
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill(password)
    await syncSection.getByLabel(/Privacy passphrase/).fill('migration-privacy-passphrase')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()
    await expect(syncSection.getByText(/Enhanced privacy is enabled/)).toBeVisible()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      return records
        .filter(record => record._id === 'allChannels' && !record.$$deleted)
        .at(-1)
        ?.subscriptions
        .some(channel => channel.id === remoteChannelId)
    }).toBe(true)
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
    await expect(syncSection.locator('.syncProgress')).toBeHidden()

    const settings = latestSettings(
      await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
    )
    const migratedHeaders = { Authorization: settings.syncServerToken }
    const encryptedResponse = await fetch(`${syncServerUrl}/v1/encrypted_sync`, {
      headers: migratedHeaders
    })
    const encryptedManifest = await encryptedResponse.json()
    expect(encryptedManifest.legacy_data).toBe(false)
    const subscriptionsResponse = await fetch(
      `${syncServerUrl}/v1/encrypted_sync/subscriptions`,
      { headers: migratedHeaders }
    )
    const encryptedSubscriptions = await subscriptionsResponse.json()
    expect(encryptedSubscriptions.payload).not.toContain(remoteChannelId)
    const envelope = JSON.parse(encryptedSubscriptions.payload)
    expect(envelope.compression).toEqual({ name: 'gzip' })
    expect(envelope).not.toHaveProperty('payload_length')
    expect(legacyHistoryDownloads).toBe(1)
    expect(encryptedUploadResponses).toHaveLength(8)
    const encryptedUploadBodies = await Promise.all(
      encryptedUploadResponses.map(response => response.json())
    )
    expect(encryptedUploadBodies).toEqual(expect.arrayContaining([
      { collection: 'subscriptions', revision: 1, payload: null },
      { collection: 'profiles', revision: 1, payload: null },
      { collection: 'settings', revision: 1, payload: null }
    ]))

    const plaintextResponse = await fetch(`${syncServerUrl}/v1/subscriptions/`, {
      headers: migratedHeaders
    })
    expect(plaintextResponse.status).toBe(409)
  })

  test('uses advertised history optimizations without rewriting unchanged local data', async ({ app, page }) => {
    const username = `opentubex-fast-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const bulkRequests = []
    const historyPageSizes = []

    await page.route('**/health', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        capabilities: { encrypted_sync: 0, bulk_sync: 1, history_page_size: 1000 }
      })
    }))
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/bulk')) bulkRequests.push(url.pathname)
      if (url.pathname.endsWith('/watch_history/')) {
        historyPageSizes.push(url.searchParams.get('page_size'))
      }
    })

    const syncSection = await goToSettingsSection(page, 'sync')
    await syncSection.getByLabel('Server URL').fill(syncServerUrl)
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill('local-test-password')
    await syncSection.getByRole('button', { name: 'Register' }).click()

    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
    await expect(syncSection.locator('.syncProgress')).toBeHidden()
    expect(bulkRequests).toEqual(expect.arrayContaining([
      '/v1/subscriptions/bulk',
      '/v1/watch_history/bulk'
    ]))
    expect(historyPageSizes).toContain('1000')

    const historyPath = path.join(app.userDataDir, 'history.db')
    const settingsPath = path.join(app.userDataDir, 'settings.db')
    const historyLinesAfterFirstSync = (await readFile(historyPath, 'utf8')).trim().split('\n').length
    const firstSyncAt = latestSettings(await readFile(settingsPath, 'utf8')).syncServerLastSyncAt
    bulkRequests.length = 0

    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(async () => {
      return latestSettings(await readFile(settingsPath, 'utf8')).syncServerLastSyncAt
    }).toBeGreaterThan(firstSyncAt)

    expect(bulkRequests).not.toContain('/v1/watch_history/bulk')
    expect((await readFile(historyPath, 'utf8')).trim().split('\n')).toHaveLength(
      historyLinesAfterFirstSync
    )

    const settings = latestSettings(await readFile(settingsPath, 'utf8'))
    const cleanupResponse = await fetch(`${syncServerUrl}/v1/account/delete`, {
      method: 'DELETE',
      headers: {
        Authorization: settings.syncServerToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: 'local-test-password' })
    })
    expect(cleanupResponse.ok).toBe(true)
  })

  test('requires confirmation before an empty remote deletes local data', async ({ app, page }) => {
    const username = `opentubex-reset-guard-${Date.now()}-${Math.random().toString(16).slice(2)}`

    await page.route('**/health', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        capabilities: { encrypted_sync: 0, bulk_sync: 1, history_page_size: 1000 }
      })
    }))
    await page.route('**/v1/subscriptions/', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ contentType: 'application/json', body: '[]' })
      }
      return route.continue()
    })

    const syncSection = await goToSettingsSection(page, 'sync')
    await syncSection.getByLabel('Server URL').fill(syncServerUrl)
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill('local-test-password')
    await syncSection.getByRole('button', { name: 'Register' }).click()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()

    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    const warning = page.getByRole('dialog', { name: 'Confirm destructive sync?' })
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('2 of 2 previously synced subscriptions')

    const profiles = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    expect(profiles).toContain(channelId)
    expect(profiles).toContain(secondChannelId)
    await warning.getByRole('button', { name: 'Cancel' }).click()

    await expect.poll(async () => {
      const currentSettings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return currentSettings.syncServerAutoSync
    }).toBe(false)

    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(warning).toBeVisible()
    await warning.getByRole('button', { name: 'Delete and continue' }).click()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      return records
        .filter(record => record._id === 'allChannels' && !record.$$deleted)
        .at(-1)
        ?.subscriptions.length
    }).toBe(0)

    const settings = latestSettings(
      await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
    )
    const cleanupResponse = await fetch(`${syncServerUrl}/v1/account/delete`, {
      method: 'DELETE',
      headers: {
        Authorization: settings.syncServerToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: 'local-test-password' })
    })
    expect(cleanupResponse.ok).toBe(true)
  })

  test('supports legacy servers without a capabilities endpoint', async ({ app, page }) => {
    const username = `opentubex-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`
    let activeSubscriptionWrites = 0
    let maxConcurrentSubscriptionWrites = 0
    const bulkRequests = []
    const historyPageSizes = []

    await page.route('**/health', route => route.fulfill({
      contentType: 'text/plain',
      body: 'OK'
    }))
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/bulk')) bulkRequests.push(url.pathname)
      if (url.pathname.endsWith('/watch_history/')) {
        historyPageSizes.push(url.searchParams.get('page_size'))
      }
    })
    await page.route('**/v1/subscriptions/', async route => {
      if (route.request().method() === 'PUT') {
        activeSubscriptionWrites++
        maxConcurrentSubscriptionWrites = Math.max(
          maxConcurrentSubscriptionWrites,
          activeSubscriptionWrites
        )
        await new Promise(resolve => setTimeout(resolve, 150))
        activeSubscriptionWrites--
      }
      await route.continue()
    })

    const syncSection = await goToSettingsSection(page, 'sync')
    const serverUrlInput = syncSection.getByLabel('Server URL')
    await page.route('https://not-a-sync-server.invalid/**', route => route.abort())
    await serverUrlInput.fill('https://not-a-sync-server.invalid')
    await serverUrlInput.press('Tab')
    await expect(syncSection.getByText(/Unable to connect to this sync server/)).toBeVisible()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    await expect(syncSection.getByLabel('Password')).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Register' })).toBeDisabled()

    await serverUrlInput.fill(`${syncServerUrl}/`)
    await serverUrlInput.press('Tab')
    await expect(serverUrlInput).toHaveValue(syncServerUrl)
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      return latestSettings(contents).syncServerUrl
    }).toBe(syncServerUrl)
    await expect(syncSection.getByLabel(/Privacy passphrase/)).toBeHidden()
    await expect(syncSection.getByText(/does not support enhanced privacy/)).toBeVisible()
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill('local-test-password')
    await syncSection.getByRole('button', { name: 'Register' }).click()

    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()
    await expect(syncSection.getByLabel('Settings')).toBeVisible()
    await expect(syncSection.getByLabel('Settings')).toBeDisabled()
    await expect(syncSection.getByText(/does not support settings syncing/)).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
    expect(maxConcurrentSubscriptionWrites).toBeGreaterThan(1)
    expect(bulkRequests).toEqual([])
    expect(historyPageSizes).toContain(null)
  })
})
