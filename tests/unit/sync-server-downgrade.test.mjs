import { toRaw } from 'vue'
import { DEFAULT_CHANNEL_AVATAR, normalizeChannelAvatar, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import { executeBackgroundJob as runBackgroundJob } from '../../src/renderer/helpers/background-job-operations.js'
import * as releasedClient from '../helpers/released-sync-sessions.mjs'
import * as sessions from '../../src/renderer/helpers/sync-sessions.js'
import { isValidSyncServerDeviceId } from '../../src/renderer/helpers/sync-server-sessions.js'
import * as bookmarks from '../../src/renderer/helpers/playlist-bookmarks.js'
import * as syncLive from '../../src/renderer/helpers/sync-server-live.js'
import { syncLiveReminders } from '../../src/renderer/helpers/sync-live-reminders.js'
import * as subscriptionSettingsSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'

import { encryptLegacyDocument } from '../helpers/encrypt-legacy-sync-document.mjs'
import { CUSTOM_THEMES_SYNC_KEY, DEFAULT_CUSTOM_THEME, normalizeCustomThemes } from '../../src/customTheme.js'
import { areSyncSettingValuesEqual, mergeSettingEntry, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as privacy from '../../src/renderer/helpers/sync-server-privacy.js'
import { dispatchRemoteSyncAction, isRecentSync, isSyncReasonEnabled } from '../../src/renderer/helpers/sync-server-scheduling.js'
import { createSyncServerRequestHeaders } from '../../src/renderer/helpers/sync-server-request.js'
import { mergeSubscriptionSeenPosts } from '../../src/subscriptionSeenPosts.js'
import { mergeSubscriptionSeenVideos } from '../../src/subscriptionSeenVideos.js'
import { syncSubscriptionSeenVideos, syncSubscriptionSeenPosts } from '../../src/renderer/helpers/subscription-seen-videos.js'

// These modules use webpack imports. Keep their actual request, merge, and store
// code while replacing platform dependencies and the network with local fixtures.
function withoutImports (source) {
  return source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, '')
}

const helperSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')

function fixture (overrides = {}, { encrypted = false, respond, connectionState = 'online', online = true, browser = false, deferLock = false, syncableSettingKeys = ['channelPlaybackSpeeds'], reminderService, connected = false, timer, locks, desktopTabs, connectionChanges, capacitor = false } = {}) {
  const connectionEvents = new EventTarget()
  const network = { state: connectionState, online }
  const requests = []
  const commits = []
  const notifications = []
  const dispatched = []
  const settings = {
    syncServerEnabled: true,
    syncServerUrl: 'https://sync.example',
    syncServerUsername: 'alice',
    syncServerToken: 'saved-token',
    syncServerPrivacyMode: 'enhanced',
    syncServerPrivacyKey: Buffer.alloc(32, 1).toString('base64'),
    syncServerPrivacySalt: Buffer.alloc(16, 2).toString('base64'),
    syncServerSnapshot: '{}',
    syncServerAutoSync: true,
    syncServerResumeAutoSync: false,
    syncServerSyncSubscriptions: true,
    ...overrides,
  }
  const storedReceipts = new Map()
  const common = {
    DEFAULT_CHANNEL_AVATAR, normalizeChannelAvatar, mergeSyncIds, syncVideoToRemote,
    runBackgroundJob,
    toRaw,
    ...syncLive,
    ...(connectionChanges ? {
      SyncLiveConnectionState: class extends syncLive.SyncLiveConnectionState {
        setConnected(value) {
          connectionChanges.push(value)
          super.setConnected(value)
        }
      },
    } : {}),
    ...(reminderService ? {
      syncLiveReminders: (client, previous) => syncLiveReminders(client, previous, reminderService),
      SyncLiveConnectionState: class { async isConnected() { return connected } setConnected() {} },
    } : {}),
    ...bookmarks,
    ...sessions,
    isValidSyncServerDeviceId,
    applySyncServerUserAgent: headers => headers,
    capacitorHttpFetch: (url, options) => common.fetch(url, options),
    ...subscriptionSettingsSync,
    ...errors,
    showToast: options => notifications.push(options),
    showToastOnAllTabs: (message, time, icon, buttonAction) => notifications.push({
      message, time, icon, buttonAction, broadcast: true,
    }),
    i18n: { global: { t: key => key } },
    ...privacy,
    syncSubscriptionSeenVideos,
    syncSubscriptionSeenPosts,
    dispatchRemoteSyncAction,
    isRecentSync,
    isSyncReasonEnabled,
    AUTO_SYNC_INTERVAL_MS: 5 * 60 * 1000,
    getConnectionState: () => network.state,
    navigator: { get onLine() { return network.online },
      ...(locks ? { locks } : deferLock ? { locks: { request: (name, options, callback) => Promise.resolve().then(() => (callback ?? options)({ name })) } } : {}) },
    connectionEvents,
    ...(browser ? { window: new EventTarget(), document: new EventTarget(), isAppHidden: () => false } : {}),
    ...(desktopTabs ? { getCapacitorTabService: () => desktopTabs, window: { ftElectron: { tabs: desktopTabs } }, localStorage: { getItem: key => storedReceipts.get(key) ?? null, setItem: (key, value) => storedReceipts.set(key, value) } } : {}),
    crypto,
    Date,
    URL,
    Headers,
    Response,
    AbortController,
    setTimeout: timer ?? setTimeout,
    clearTimeout,
    structuredClone,
    TextEncoder,
    TextDecoder,
    process: { env: { IS_ELECTRON: !capacitor && Boolean(reminderService || desktopTabs), IS_CAPACITOR: capacitor } },
    packageDetails: { version: 'test' },
    MAIN_PROFILE_ID: 'main',
    deepCopy: structuredClone,
    createSyncServerRequestHeaders,
    CUSTOM_THEMES_SYNC_KEY,
    normalizeCustomThemes,
    areSyncSettingValuesEqual,
    mergeSettingEntry,
    resolveMergedThemeEntry,
    getSyncableSettingKeys: () => syncableSettingKeys,
    isSettingSyncEnabled: (settings, key) => !settings.syncServerSettingsExcluded?.includes(key),
    fetch: async (url, options) => {
      requests.push({ url, method: options.method ?? 'GET', body: options.body })
      if (respond) {
        const response = await respond(url, options)
        if (response instanceof Response) return response
        if (response !== undefined) return new Response(JSON.stringify(response))
      }
      let result = null
      if (url.endsWith('/health')) result = encrypted ? { capabilities: { encrypted_sync: 1, live_sync: 1 } } : 'OK'
      else if (url.endsWith('/account/login') || url.endsWith('/account/register')) result = { jwt: 'new-token' }
      else if (new URL(url).pathname === '/v1/encrypted_sync/events') result = []
      else if (url.endsWith('/encrypted_sync')) result = { collections: [], legacy_data: false }
      else if (url.includes('/encrypted_sync/')) result = { revision: 0, payload: null }
      else if (url.endsWith('/subscriptions/') && !options.method) result = []
      return new Response(JSON.stringify(result))
    },
  }
  const helper = vm.createContext({ ...common })
  vm.runInContext(withoutImports(helperSource) + '\nglobalThis.exports = { SyncServerClient, syncSubscriptions, syncSettings, syncHistory, syncPlaylists, syncPlaylistBookmarks, syncSessions, normalizeSyncServerUrl };', helper)
  const store = vm.createContext({ ...common, ...helper.exports, getSavedOtherDeviceSessions: () => [] })
  vm.runInContext(withoutImports(storeSource).replace('export default { state, getters, actions, mutations }', 'globalThis.exports = { state, actions, mutations }'), store)
  const context = {
    rootState: {
      settings,
      syncServer: store.exports.state,
      history: { historyCacheSorted: [] },
      playlists: { playlists: [] },
      utils: { customThemes: [] },
      profiles: { profileList: [{ _id: 'main', subscriptions: [{ id: 'private-channel', name: 'Private subscription' }] }] },
    },
    rootGetters: {},
    state: store.exports.state,
    commit: (action, value) => {
      commits.push([action, value])
      if (action === 'setSyncServerEnabled') settings.syncServerEnabled = value
      store.exports.mutations[action]?.(store.exports.state, value)
    },
    dispatch: async (action, value) => {
      dispatched.push([action, value])
      if (action === 'replacePlaylistBookmarks') {
        settings.playlistBookmarks = value
        return true
      }
      if (action === 'updateChannelSettings') {
        const channel = context.rootState.profiles.profileList[0].subscriptions.find(channel => channel.id === value.channelId)
        Object.assign(channel, value.settings, { subscriptionSettingsUpdatedAt: value.updatedAt })
        return true
      }
      if (action === 'setSyncServerAutoSync') return store.exports.actions.setSyncServerAutoSync(context, value)
      if (action === 'applySyncServerEnabled') return store.exports.actions.applySyncServerEnabled(context, value)
      if (action === 'mergeSubscriptionSeenPosts') {
        settings.subscriptionSeenPosts = JSON.stringify(mergeSubscriptionSeenPosts(settings.subscriptionSeenPosts, value))
      }
      if (action === 'mergeSubscriptionSeenVideos') {
        settings.subscriptionSeenVideos = JSON.stringify(mergeSubscriptionSeenVideos(settings.subscriptionSeenVideos, value))
      }
      if (action.startsWith('updateSyncServer')) {
        const key = action.slice(6)
        settings[key[0].toLowerCase() + key.slice(1)] = value
      }
      if (action === 'updateChannelPlaybackSpeeds') settings.channelPlaybackSpeeds = value
      if (action === 'updateAutoplayVideos') settings.autoplayVideos = value
      if (action === 'replaceSyncServerToken') settings.syncServerToken = value
      if (action === 'initializeSyncServer') return store.exports.actions.initializeSyncServer(context, value)
      if (action === 'syncWithSyncServer') return store.exports.actions.syncWithSyncServer(context, value)
    },
  }
  return { network, connectionEvents, settings, requests, commits, notifications, dispatched, context, actions: store.exports.actions, Client: helper.exports.SyncServerClient }
}

for (const refreshAction of ['refreshSyncServerEvents', 'refreshSyncServerDevices']) {
  for (const cached of [false, true]) {
  test(`${cached ? 'cached' : 'completed'} library sync does not wait for ${refreshAction}`, async () => {
    const f = liveFixture()
    if (cached) await f.actions.syncWithSyncServer(f.context)
    let releaseRefresh
    const refreshPending = new Promise(resolve => { releaseRefresh = resolve })
    let refreshStarted
    const started = new Promise(resolve => { refreshStarted = resolve })
    const originalDispatch = f.context.dispatch
    f.context.dispatch = (action, ...args) => {
      if (action === refreshAction) {
        refreshStarted()
        return refreshPending
      }
      return originalDispatch(action, ...args)
    }
    let completed = false
    const syncing = f.actions.syncWithSyncServer(f.context, { remoteOnly: cached }).then(() => { completed = true })
    try {
      await started
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(completed, true, 'Account metadata must not hold library sync open')
      assert.equal(f.context.state.syncServerStatus, 'success')
      assert.equal(f.context.state.syncServerProgress, null)
      assert.ok(f.settings.syncServerLastSyncAt > 0)
    } finally {
      releaseRefresh()
      await syncing
    }
  })
  }
}

test('encrypted activity downloads can outlast the ordinary request timeout', async () => {
  const events = Array.from({ length: 81 }, (_, index) => ({ id: String(index), payload: 'encrypted activity' }))
  const f = fixture({}, {
    // Scale deadlines to keep the regression fast: the response takes the
    // equivalent of 50 seconds, longer than the ordinary 20-second timeout.
    timer: (callback, delay) => setTimeout(callback, delay / 1000),
    respond: (_url, options) => new Promise((resolve, reject) => {
      const response = setTimeout(() => resolve(events), 50)
      options.signal.addEventListener('abort', () => {
        clearTimeout(response)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }),
  })
  const client = new f.Client('https://sync.example', 'saved-token')
  const downloaded = await client.getSyncEvents()
  assert.equal(downloaded.length, events.length)
  assert.equal(f.requests.length, 1)
})

for (const [method, args, path, verb] of [
  ['authenticate', ['login', 'alice', 'password'], '/account/login', 'POST'],
  ['authenticate', ['register', 'alice', 'password'], '/account/register', 'POST'],
  ['deleteAccount', ['password'], '/account/delete', 'DELETE'],
  ['getAccountSessions', [], '/account/sessions', 'GET'],
  ['updateAccountSession', ['device/id', 'encrypted'], '/account/sessions/device%2Fid', 'PATCH'],
  ['revokeAccountSession', ['device/id'], '/account/sessions/device%2Fid', 'DELETE'],
  ['changePassword', ['old', 'new'], '/account/password', 'PUT'],
]) {
  test(`${verb} ${path} preserves v1 errors without trying an unversioned alias`, async () => {
    const f = fixture({}, {
      respond: () => new Response('Resource missing', { status: 404 }),
    })
    const client = new f.Client('https://sync.example', 'saved-token')
    await assert.rejects(client[method](...args), error =>
      error.status === 404 && error.message === 'Resource missing')
    assert.deepEqual(f.requests.map(({ url, method }) => [url, method]), [
      [`https://sync.example/v1${path}`, verb],
    ])
  })

  test(`${verb} ${path} stays on v1 after legacy API prefix discovery`, async () => {
    const f = fixture()
    const client = new f.Client('https://sync.example', 'saved-token')
    client.apiPrefix = ''
    await client[method](...args)
    assert.equal(f.requests[0].url, `https://sync.example/v1${path}`)
  })
}

for (const [collection, idKey, setting, capability] of [
  ['seenVideos', 'videoId', 'subscriptionSeenVideos', 'seen_videos'],
  ['seenPosts', 'postId', 'subscriptionSeenPosts', 'seen_posts'],
]) {
  test(`a live check discovers newly supported ${collection} before consuming its revision`, async () => {
    let supported = false
    const f = fixture({
      syncServerSyncSubscriptions: false,
      syncServerSyncHistory: true,
      [setting]: '[]',
    }, {
      encrypted: true,
      respond: async url => {
        if (url.endsWith('/health')) return { capabilities: {
          encrypted_sync: 1, live_sync: 1, seen_videos: 1, seen_posts: 1,
          [capability]: supported ? 1 : 0,
        } }
        if (url.endsWith('/encrypted_sync')) return {
          collections: supported ? [{ collection, revision: 1 }] : [], legacy_data: false,
        }
        if (supported && url.endsWith(`/encrypted_sync/${collection}`)) return {
          revision: 1,
          payload: await privacy.encryptSyncDocument([{ [idKey]: 'peer-entry', seenAt: 1000 }],
            f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt),
        }
      },
    })
    await f.actions.syncWithSyncServer(f.context)
    supported = true
    await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
    assert.equal(JSON.parse(f.settings[setting])[0]?.[idKey], 'peer-entry')
    assert.equal(f.requests.filter(request => request.url.endsWith('/health')).length, 2)
    await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
    assert.equal(f.requests.filter(request => request.url.endsWith('/health')).length, 2,
      'positive capabilities remain reusable after the upgrade')
  })

  for (const historyEnabled of [false, true]) {
    for (const supported of [false, true]) {
      test(`${collection} sync requires history enabled=${historyEnabled} and server support=${supported}`, async () => {
        const f = fixture({
          syncServerSyncHistory: historyEnabled,
          [setting]: JSON.stringify([{ [idKey]: 'private-seen-entry', seenAt: 1000 }]),
        }, {
          encrypted: true,
          respond: url => url.endsWith('/health')
            ? { capabilities: { encrypted_sync: 1, live_sync: 1, [capability]: supported ? 1 : 0 } }
            : undefined,
        })
        await f.actions.syncWithSyncServer(f.context)
        assert.equal(f.context.state.syncServerStatus, 'success')
        const seenRequests = f.requests.filter(request => request.url.endsWith(`/encrypted_sync/${collection}`))
        assert.equal(seenRequests.length, historyEnabled && supported ? 2 : 0)
        if (seenRequests.length > 0) {
          const upload = seenRequests.find(request => request.method === 'PUT')
          assert.ok(!upload.body.includes('private-seen-entry'))
          const entries = await privacy.decryptSyncDocument(JSON.parse(upload.body).payload, f.settings.syncServerPrivacyKey)
          assert.equal(entries[0][idKey], 'private-seen-entry')
        }
      })
    }
  }

  test(`${collection} upload conflicts retain marks added by both devices`, async () => {
    const key = Buffer.alloc(32, 1).toString('base64')
    const salt = Buffer.alloc(16, 2).toString('base64')
    const remote = await privacy.encryptSyncDocument([{ [idKey]: 'other-device', seenAt: 2000 }], key, salt)
    let uploads = 0
    const f = fixture({
      syncServerSyncHistory: true,
      [setting]: JSON.stringify([{ [idKey]: 'local-device', seenAt: 1000 }]),
    }, {
      encrypted: true,
      respond(url, options) {
        if (url.endsWith('/health')) return { capabilities: { encrypted_sync: 1, live_sync: 1, [capability]: 1 } }
        if (!url.endsWith(`/encrypted_sync/${collection}`)) return
        if (options.method === 'PUT' && ++uploads === 1) return new Response('{}', { status: 409 })
        if (!options.method && uploads > 0) return { revision: 1, payload: remote }
      },
    })
    await f.actions.syncWithSyncServer(f.context)
    assert.equal(f.context.state.syncServerStatus, 'success')
    const upload = f.requests.filter(request => request.method === 'PUT' && request.url.endsWith(`/${collection}`)).at(-1)
    const entries = await privacy.decryptSyncDocument(JSON.parse(upload.body).payload, key)
    assert.deepEqual(entries.map(entry => entry[idKey]), ['local-device', 'other-device'])
    assert.equal(uploads, 2)
  })
}

for (const overrides of [
  {},
  { syncServerPrivacyKey: '' },
  { syncServerPrivacyMode: 'legacy' },
]) {
  test(`startup refuses a capability downgrade with ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(overrides)
    const saved = { ...f.settings }
    await f.actions.initializeSyncServer(f.context)
    assert.deepEqual(f.settings, saved)
    assert.equal(f.requests.length, 1)
    assert.ok(f.context.state.syncServerError.includes('encrypted sync'))
  })
}

test('legacy clients still upload subscriptions to legacy servers', async () => {
  const f = fixture({ syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '' })
  await f.actions.initializeSyncServer(f.context)
  assert.equal(f.settings.syncServerPrivacyMode, 'legacy')
  assert.ok(f.requests.some(request => request.method === 'PUT' && request.url.endsWith('/subscriptions/') && request.body.includes('Private subscription')))
})

test('encrypted accounts still sync when the server supports encryption', async () => {
  const f = fixture({}, { encrypted: true })
  await f.actions.initializeSyncServer(f.context)
  assert.equal(f.settings.syncServerPrivacyMode, 'enhanced')
  const uploads = f.requests.filter(request => request.method === 'PUT')
  assert.equal(uploads.length, 1)
  assert.ok(uploads[0].url.endsWith('/encrypted_sync/subscriptions'))
  const document = await privacy.decryptSyncDocument(
    JSON.parse(uploads[0].body).payload,
    f.settings.syncServerPrivacyKey
  )
  assert.equal(document[0].name, 'Private subscription')
})

test('encrypted servers without live sync stop before authentication or data transfer', async () => {
  const f = fixture({}, {
    encrypted: true,
    respond: url => url.endsWith('/health') ? { capabilities: { encrypted_sync: 1 } } : undefined,
  })
  await f.actions.initializeSyncServer(f.context)
  assert.equal(f.context.state.syncServerError, errors.SYNC_SERVER_UPDATE_REQUIRED_MESSAGE)
  await assert.rejects(f.actions.syncWithSyncServer(f.context), errors.SyncServerUnsupportedError)
  await assert.rejects(f.actions.authenticateSyncServer(f.context, credentials), errors.SyncServerUnsupportedError)
  assert.ok(f.requests.every(request => request.url.endsWith('/health')))
  assert.equal(f.settings.syncServerPrivacyMode, 'enhanced')
  assert.ok(f.settings.syncServerPrivacyKey)
})

test('saved legacy accounts cannot bypass the encrypted live requirement with manual sync', async () => {
  const f = fixture({ syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '' }, {
    respond: url => url.endsWith('/health') ? { capabilities: { encrypted_sync: 1 } } : undefined,
  })
  await assert.rejects(f.actions.syncWithSyncServer(f.context), errors.SyncServerUnsupportedError)
  assert.ok(f.requests.every(request => request.url.endsWith('/health')))
})

test('manual sync uses encryption when a saved key survives an earlier downgrade', async () => {
  const f = fixture({ syncServerPrivacyMode: 'legacy' }, { encrypted: true })
  await f.actions.syncWithSyncServer(f.context)
  const uploads = f.requests.filter(request => request.method === 'PUT')
  assert.equal(uploads.length, 1)
  assert.ok(uploads[0].url.endsWith('/encrypted_sync/subscriptions'))
  assert.ok(!uploads[0].body.includes('Private subscription'))
})

const credentials = {
  mode: 'login',
  serverUrl: 'https://sync.example',
  username: 'alice',
  password: 'account-password',
  deviceId: 'device',
  deviceName: 'Laptop',
  deviceSystemInfo: { platform: 'linux' },
}

test('reauthentication cannot downgrade the same encrypted account', async () => {
  const f = fixture()
  const saved = { ...f.settings }
  await assert.rejects(f.actions.authenticateSyncServer(f.context, credentials), /encrypted sync/)
  assert.deepEqual(f.settings, saved)
  assert.ok(!f.requests.some(request => request.url.endsWith('/account/login')))
})

test('a supplied privacy passphrase cannot silently select plaintext login', async () => {
  const f = fixture({ syncServerPrivacyMode: 'unknown', syncServerPrivacyKey: '' })
  await assert.rejects(f.actions.authenticateSyncServer(f.context, {
    ...credentials, privacyPassphrase: 'privacy-passphrase',
  }), /encrypted sync/)
  assert.ok(!f.requests.some(request => request.url.endsWith('/account/login')))
})

test('connecting a different legacy account does not inherit the previous account encryption requirement', async () => {
  const f = fixture()
  await f.actions.authenticateSyncServer(f.context, { ...credentials, username: 'bob' })
  assert.equal(f.settings.syncServerPrivacyMode, 'legacy')
  assert.equal(f.settings.syncServerPrivacyKey, '')
  assert.equal(f.settings.syncServerUsername, 'bob')
  assert.ok(f.requests.some(request => request.url.endsWith('/account/login')))
})

for (const source of ['plaintext', 'single document', 'collection']) {
  test(`migrates ${source} playback speeds into settings without recreating the deleted collection`, async () => {
    const collections = new Map()
    const speeds = [{ channel_id: 'legacy-channel', playback_speed: 1.5 }]
    // Retain the legacy migration flag on subsequent runs, as an older server
    // does when playbackSpeeds is missing or plaintext data remains.
    const f = fixture({
      syncServerSyncSettings: true,
      channelPlaybackSpeeds: JSON.stringify({ 'local-channel': 2 }),
    }, {
      encrypted: true,
      respond: (url, options) => {
        const path = new URL(url).pathname
        if (path === '/v1/encrypted_sync') {
          return {
            collections: [...collections].map(([collection, entry]) => ({ collection, revision: entry.revision })),
            legacy_data: source === 'plaintext',
            legacy_encrypted_data: source === 'single document',
          }
        }
        if (path === '/v1/encrypted_sync/legacy') return { revision: 1, payload: legacyPayload }
        if (path.startsWith('/v1/encrypted_sync/')) {
          const collection = path.split('/').at(-1)
          if (options.method === 'PUT') {
            const entry = JSON.parse(options.body)
            assert.equal(entry.revision, collections.get(collection)?.revision ?? 0)
            collections.set(collection, { revision: entry.revision + 1, payload: entry.payload })
          }
          return collections.get(collection) ?? { revision: 0, payload: null }
        }
        if (path === '/v1/channel_playback_speeds/') return speeds
        if (path.startsWith('/v1/')) return []
      },
    })
    const legacyPayload = await encryptLegacyDocument({
      ...privacy.createEmptySyncDocument(), playbackSpeeds: speeds,
    }, { key: f.settings.syncServerPrivacyKey, salt: f.settings.syncServerPrivacySalt })
    if (source === 'collection') {
      collections.set('playbackSpeeds', {
        revision: 1,
        payload: await privacy.encryptSyncDocument(speeds, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt),
      })
    }

    const expected = { 'legacy-channel': 1.5, 'local-channel': 2 }
    for (let run = 0; run < 2; run++) {
      await f.actions.syncWithSyncServer(f.context)
      const manifests = f.requests.filter(request => new URL(request.url).pathname === '/v1/encrypted_sync')
      assert.equal(new URL(manifests.at(-1).url).searchParams.get('playback_speeds_in_settings'), run === 1 ? 'true' : null)
      assert.equal(f.context.state.syncServerError, '')
      assert.equal(f.requests.some(request => request.method === 'PUT' &&
        request.url.endsWith('/encrypted_sync/playbackSpeeds')), false)
      const settings = await privacy.decryptSyncDocument(
        collections.get('settings').payload, f.settings.syncServerPrivacyKey
      )
      assert.deepEqual(JSON.parse(settings.find(entry => entry.key === 'channelPlaybackSpeeds').value), expected)
      assert.deepEqual(JSON.parse(f.settings.channelPlaybackSpeeds), expected)
      if (run === 0) collections.delete('playbackSpeeds')
    }
    assert.equal(collections.has('playbackSpeeds'), false)
    assert.equal(f.requests.some(request => request.method === 'GET' &&
      request.url.endsWith('/encrypted_sync/playbackSpeeds')), source === 'collection')
  })
}

for (const overrides of [
  { syncServerSyncSettings: false },
  { syncServerSyncSettings: true, syncServerSettingsExcluded: ['channelPlaybackSpeeds'] },
]) {
  test(`does not acknowledge playback-speed migration with disabled sync: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture({
      ...overrides,
      channelPlaybackSpeeds: '{}',
      syncServerSnapshot: JSON.stringify({ settings: { channelPlaybackSpeeds: { value: '{}', updatedAt: 1 } } }),
    }, { encrypted: true })
    await f.actions.syncWithSyncServer(f.context)
    assert.equal(f.context.state.syncServerError, '')
    assert.ok(f.requests.some(request => request.url.endsWith('/v1/encrypted_sync')))
    assert.equal(f.requests.some(request => request.url.includes('playback_speeds_in_settings')), false)
  })
}


test('blocked background sync notifies the user and links to sync settings', async () => {
  const f = fixture({
    syncServerPrivacyMode: 'legacy',
    syncServerPrivacyKey: '',
    syncServerSnapshot: JSON.stringify({ subscriptions: ['private-channel'] }),
  })

  await assert.rejects(f.actions.syncWithSyncServer(f.context), errors.SyncServerDataLossError)

  assert.equal(f.settings.syncServerAutoSync, false)
  assert.equal(f.notifications.length, 1)
  const notification = f.notifications[0]
  assert.equal(notification.message, 'Settings.Sync Settings.Destructive Sync Blocked')
  assert.equal(notification.broadcast, true)
  assert.equal(notification.buttonAction, 'open-sync-settings')
  assert.equal(f.requests.some(({ method }) => method === 'DELETE'), false)
})


test('manual sync can present its confirmation without a duplicate notification', async () => {
  const f = fixture({
    syncServerPrivacyMode: 'legacy',
    syncServerPrivacyKey: '',
    syncServerSnapshot: JSON.stringify({ subscriptions: ['private-channel'] }),
  })
  await assert.rejects(f.actions.syncWithSyncServer(f.context, { notifyDataLoss: false }), errors.SyncServerDataLossError)
  assert.equal(f.settings.syncServerAutoSync, false)
  assert.equal(f.notifications.length, 0)
})


for (const previouslyEnabled of [true, false]) {
  test(`successful confirmation restores automatic sync only when previously enabled: ${previouslyEnabled}`, async () => {
    const f = fixture({
      syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '',
      syncServerAutoSync: previouslyEnabled,
      syncServerSnapshot: JSON.stringify({ subscriptions: ['private-channel'] }),
    })
    // Cancel and retry must not overwrite the remembered preference with false.
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.actions.syncWithSyncServer(f.context), errors.SyncServerDataLossError)
      assert.equal(f.settings.syncServerAutoSync, false)
    }
    await f.actions.syncWithSyncServer(f.context, { allowDataLoss: true })
    assert.equal(f.settings.syncServerAutoSync, previouslyEnabled)
    assert.equal(f.settings.syncServerResumeAutoSync, false)
  })
}

test('remembers paused automatic sync across restart and resumes only after success', async () => {
  const f = fixture({
    syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '',
    syncServerSnapshot: JSON.stringify({ subscriptions: ['private-channel'] }),
  })
  await assert.rejects(f.actions.syncWithSyncServer(f.context), errors.SyncServerDataLossError)
  let fail = true
  const restarted = fixture(structuredClone(f.settings), {
    respond: () => fail ? new Response('Offline', { status: 503 }) : undefined,
  })
  await assert.rejects(restarted.actions.syncWithSyncServer(restarted.context, { allowDataLoss: true }))
  assert.equal(restarted.settings.syncServerAutoSync, false)
  fail = false
  await restarted.actions.syncWithSyncServer(restarted.context, { allowDataLoss: true })
  assert.equal(restarted.settings.syncServerAutoSync, true)
  assert.equal(restarted.settings.syncServerResumeAutoSync, false)
})

test('an explicit automatic-sync choice clears a pending resume', async () => {
  const f = fixture({
    syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '',
    syncServerAutoSync: false, syncServerResumeAutoSync: true,
  })
  await f.actions.setSyncServerAutoSync(f.context, false)
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(f.settings.syncServerAutoSync, false)
  assert.equal(f.settings.syncServerResumeAutoSync, false)
})

test('disabling sync clears recovery before a later manual sync succeeds', async () => {
  const f = fixture({
    syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '',
    syncServerSnapshot: JSON.stringify({ subscriptions: ['private-channel'] }),
  })
  await assert.rejects(f.actions.syncWithSyncServer(f.context), errors.SyncServerDataLossError)
  assert.equal(f.settings.syncServerResumeAutoSync, true)
  await f.actions.setSyncServerEnabled(f.context, false)
  assert.equal(f.settings.syncServerEnabled, false)
  assert.equal(f.settings.syncServerResumeAutoSync, false)
  await f.actions.setSyncServerEnabled(f.context, true)
  await f.actions.syncWithSyncServer(f.context, { allowDataLoss: true })
  assert.equal(f.settings.syncServerAutoSync, false)
})

for (const offline of [{ connectionState: 'offline' }, { online: false }]) {
  test(`sync skips requests while offline: ${JSON.stringify(offline)}`, async () => {
    const f = fixture({}, { encrypted: true, ...offline })
    await f.actions.initializeSyncServer(f.context)
    assert.equal(f.requests.length, 0, 'startup must not contact the server offline')
    await f.actions.syncWithSyncServer(f.context)
    assert.equal(f.requests.length, 0)
    assert.equal(f.commits.some(([name]) => name === 'setSyncServerError'), false)
    f.network.state = 'online'
    f.network.online = true
    await f.actions.initializeSyncServer(f.context)
    assert.ok(f.requests.length > 0, 'sync can resume once connectivity returns')
  })
}

test('offline startup registers recovery and reconnect initializes sync', async () => {
  const f = fixture({}, { encrypted: true, connectionState: 'offline', browser: true })
  await f.actions.initializeSyncServer(f.context)
  assert.equal(f.requests.length, 0)
  f.network.state = 'restored'
  f.connectionEvents.dispatchEvent(new CustomEvent('change', { detail: 'restored' }))
  await Promise.resolve()
  assert.ok(f.dispatched.some(([action]) => action === 'initializeSyncServer'))
  for (let i = 0; i < 100 && !f.requests.length; i++) await Promise.resolve()
  assert.ok(f.requests.length > 0)
})

test('a queued sync rechecks connectivity after acquiring its lock', async () => {
  const f = fixture({}, { encrypted: true, deferLock: true })
  const syncing = f.actions.syncWithSyncServer(f.context)
  f.network.state = 'offline'
  await syncing
  assert.equal(f.requests.length, 0)
})

for (const settings of [{ syncServerSyncSubscriptions: false }, { syncServerAutoSync: false }]) {
  test(`reconnect respects automatic sync preferences: ${JSON.stringify(settings)}`, async () => {
    const f = fixture(settings, { encrypted: true, connectionState: 'offline', browser: true })
    await f.actions.initializeSyncServer(f.context)
    f.network.state = 'restored'
    f.connectionEvents.dispatchEvent(new CustomEvent('change', { detail: 'restored' }))
    await Promise.resolve()
    assert.equal(f.dispatched.some(([action]) => action === 'initializeSyncServer'), false)
    assert.equal(f.requests.length, 0)
  })
}

test('startup without an account still registers reconnect handling for a later connection', async () => {
  const f = fixture({ syncServerToken: '' }, { encrypted: true, connectionState: 'offline', browser: true })
  await f.actions.initializeSyncServer(f.context)
  f.settings.syncServerToken = 'connected-token'
  f.network.state = 'restored'
  f.connectionEvents.dispatchEvent(new CustomEvent('change', { detail: 'restored' }))
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.ok(f.dispatched.some(([action]) => action === 'initializeSyncServer'))
})

test('reconnect sync includes offline changes even when the last sync was recent', async () => {
  const f = fixture({ syncServerLastSyncAt: Date.now() }, { encrypted: true, connectionState: 'offline', browser: true })
  await f.actions.initializeSyncServer(f.context)
  let options
  const dispatch = f.context.dispatch
  f.context.dispatch = async (action, value) => {
    if (action === 'syncWithSyncServer') { options = value; return null }
    return dispatch(action, value)
  }
  f.network.state = 'restored'
  f.connectionEvents.dispatchEvent(new CustomEvent('change', { detail: 'restored' }))
  for (let i = 0; i < 100 && !options; i++) await Promise.resolve()
  assert.equal(options?.skipIfRecent, false)
})

test('disconnect cancels an active sync and reconnect waits for it to settle', async () => {
  let releaseRequest
  let signal
  let started
  const requestStarted = new Promise(resolve => { started = resolve })
  const f = fixture({}, { encrypted: true, connectionState: 'offline', browser: true,
    respond: (url, options) => {
      if (signal) return
      signal = options.signal
      return new Promise((resolve, reject) => {
        releaseRequest = () => reject(new DOMException('Aborted', 'AbortError'))
        started()
      })
    },
  })
  await f.actions.initializeSyncServer(f.context)
  f.network.state = 'online'
  const syncing = f.actions.syncWithSyncServer(f.context)
  await requestStarted
  try {
    f.network.state = 'offline'
    f.connectionEvents.dispatchEvent(new CustomEvent('change', { detail: 'offline' }))
    assert.equal(signal.aborted, true)
    f.network.state = 'restored'
    f.connectionEvents.dispatchEvent(new CustomEvent('change', { detail: 'restored' }))
    for (let i = 0; i < 20; i++) await Promise.resolve()
    assert.equal(f.requests.length, 1, 'reconnect must wait for the cancelled sync to settle')
  } finally {
    releaseRequest()
    await syncing
  }
  for (let i = 0; i < 100 && f.requests.length === 1; i++) await Promise.resolve()
  assert.ok(f.requests.length > 1, 'a fresh sync starts after cancellation settles')
})

test('unchanged collection revisions skip downloads and uploads; remote changes download only their collection', async () => {
  const collections = new Map()
  const f = fixture({ syncServerSyncSettings: true, channelPlaybackSpeeds: '{}' }, {
    encrypted: true,
    respond: (url, options) => {
      const path = new URL(url).pathname
      if (path === '/v1/encrypted_sync') return {
        collections: [...collections].map(([collection, entry]) => ({ collection, revision: entry.revision })),
        legacy_data: false,
      }
      if (path.startsWith('/v1/encrypted_sync/')) {
        const collection = path.split('/').at(-1)
        if (options.method === 'PUT') {
          const body = JSON.parse(options.body)
          assert.equal(body.revision, collections.get(collection)?.revision ?? 0)
          collections.set(collection, { revision: body.revision + 1, payload: body.payload })
        }
        return collections.get(collection) ?? { revision: 0, payload: null }
      }
    },
  })
  await f.actions.syncWithSyncServer(f.context)
  f.requests.length = 0
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(f.requests.some(request => request.url.includes('/encrypted_sync/')), false)
  const remote = await privacy.decryptSyncDocument(collections.get('settings').payload, f.settings.syncServerPrivacyKey)
  const entry = remote.find(entry => entry.key === 'channelPlaybackSpeeds')
  entry.value = JSON.stringify({ channel: 1.5 })
  entry.updatedAt = Date.now() + 1000
  collections.set('settings', {
    revision: collections.get('settings').revision + 1,
    payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt),
  })
  f.requests.length = 0
  await f.actions.syncWithSyncServer(f.context)
  assert.deepEqual(f.requests.filter(request => request.url.includes('/encrypted_sync/')).map(request => [request.method, new URL(request.url).pathname]), [
    ['GET', '/v1/encrypted_sync/settings'],
  ])
  assert.deepEqual(JSON.parse(f.settings.channelPlaybackSpeeds), { channel: 1.5 })
})

test('a sign-out received from another window stops sync and clears account activity', async () => {
  const f = fixture({ syncServerToken: '' })
  f.context.state.syncServerActivity = [{ id: 'old-account-event' }]
  f.context.state.syncServerLiveSupported = true
  await f.actions.applySyncServerToken(f.context)
  assert.equal(f.dispatched[0][0], 'stopSyncServerAutoSync')
  assert.equal(f.context.state.syncServerActivity.length, 0)
  assert.equal(f.context.state.syncServerLiveSupported, false)
  assert.equal(f.dispatched.some(([action]) => action === 'initializeSyncServer'), false)
})

test('failed capability discovery can be retried on the same client', async () => {
  let attempts = 0
  const f = fixture({}, { respond: () => ++attempts === 1
    ? new Response('temporarily unavailable', { status: 503 })
    : { capabilities: { encrypted_sync: 1, live_sync: 1 } } })
  const client = new f.Client(f.settings.syncServerUrl, f.settings.syncServerToken)
  await assert.rejects(client.getCapabilities(), { status: 503 })
  assert.equal((await client.getCapabilities()).live_sync, 1)
  assert.equal(attempts, 2)
})

test('encrypted uploads with activity use the full transfer deadline', async () => {
  const f = fixture()
  const client = new f.Client(f.settings.syncServerUrl)
  client.request = async (_path, options) => options
  const response = await client.putEncryptedSyncCollection('settings', 0, 'x'.repeat(1024 * 1024), 'a'.repeat(256 * 1024))
  assert.equal(response.timeoutMs, 300000)
})

test('unreadable and expired broadcast events advance the activity cursor', async () => {
  const now = Date.now()
  const events = [
    { id: '001', recipient: '', payload: 'unreadable', expires_at: now + 60000 },
    { id: '002', recipient: '', payload: 'expired', expires_at: now - 1000 },
  ]
  const cursors = []
  const f = fixture({}, { respond: url => {
    const since = new URL(url).searchParams.get('since')
    cursors.push(since)
    return events.filter(event => event.id > since)
  } })
  await f.actions.refreshSyncServerEvents(f.context)
  await f.actions.refreshSyncServerEvents(f.context)
  assert.deepEqual(cursors, ['', '002'])
  assert.equal(f.context.state.syncServerActivity.length, 0)
})

test('cross-window token refresh logs a rejected initialization', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const start = source.indexOf('window.ftElectron.handleSyncSettings(')
  const end = source.indexOf('window.ftElectron.handleSyncHistory(', start)
  let listener
  const logged = []
  const failure = new Error('temporary remote sync failure')
  vm.runInNewContext(source.slice(start, end), {
    window: { ftElectron: { handleSyncSettings: callback => { listener = callback } } },
    SyncEvents: { GENERAL: { UPSERT: 'upsert' } },
    settingsWithSideEffects: [],
    defaultMutationId: key => key,
    commit: () => {},
    dispatch: async () => { throw failure },
    console: { error: (...args) => logged.push(args) },
  })
  listener('upsert', { _id: 'syncServerToken', value: 'replacement-token' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(logged.length, 1)
  assert.equal(logged[0][1], failure)
})

function liveFixture(settings = {}) {
  const collections = new Map()
  let polls = 0
  const f = fixture(settings, {
    encrypted: true,
    syncableSettingKeys: ['autoplayVideos'],
    respond: (url, options) => {
      const path = new URL(url).pathname
      if (path === '/health') return { capabilities: { encrypted_sync: 1, live_sync: 1 } }
      if (path === '/v1/encrypted_sync/changes') {
        const cursor = String(collections.get('subscriptions')?.revision ?? 0)
        if (++polls === 3) queueMicrotask(() => f.actions.stopSyncServerLive())
        return { cursor }
      }
      if (path === '/v1/encrypted_sync') return {
        collections: [...collections].map(([collection, entry]) => ({ collection, revision: entry.revision })),
        legacy_data: false,
      }
      if (path.startsWith('/v1/encrypted_sync/')) {
        const collection = path.split('/').at(-1)
        if (options.method === 'PUT') {
          const body = JSON.parse(options.body)
          collections.set(collection, { revision: body.revision + 1, payload: body.payload })
        }
        return collections.get(collection) ?? { revision: 0, payload: null }
      }
    },
  })
  return { ...f, collections }
}

test('startup and its own live notifications produce only one visible sync', async () => {
  const f = liveFixture()
  await Promise.all([
    f.actions.syncWithSyncServer(f.context),
    f.actions.startSyncServerLive(f.context),
  ])
  assert.equal(f.commits.filter(([action, value]) => action === 'setSyncServerStatus' && value === 'syncing').length, 1)
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1)
  assert.equal(f.dispatched.filter(([action]) => action === 'updateSyncServerSnapshot').length, 1)
  assert.equal(f.requests.filter(request => request.url.endsWith('/health')).length, 2,
    'discover support once for the full sync and once for the live listener')
})

test('a failed pending local sync does not back off or skip the live change check', async () => {
  let releaseFailure
  let reachedSync
  let reachedPoll
  let polls = 0
  let manifests = 0
  const connectionChanges = []
  const syncReached = new Promise(resolve => { reachedSync = resolve })
  const pollReached = new Promise(resolve => { reachedPoll = resolve })
  const f = fixture({ syncServerSyncSubscriptions: false }, {
    encrypted: true,
    connectionChanges,
    respond: url => {
      const path = new URL(url).pathname
      if (path === '/v1/encrypted_sync' && ++manifests === 1) {
        reachedSync()
        return new Promise(resolve => { releaseFailure = resolve })
      }
      if (path === '/v1/encrypted_sync/changes') {
        reachedPoll()
        if (++polls === 3) queueMicrotask(() => f.actions.stopSyncServerLive())
        return { cursor: 'peer-change' }
      }
    },
  })
  const syncing = f.actions.syncWithSyncServer(f.context)
  const failed = assert.rejects(syncing, /Local sync unavailable/)
  await syncReached
  const listening = f.actions.startSyncServerLive(f.context)
  try {
    await pollReached
    // Let the listener capture the still-pending local sync before it fails.
    await new Promise(resolve => setImmediate(resolve))
    releaseFailure(new Response('Local sync unavailable', { status: 503 }))
    await failed
    await listening
    assert.deepEqual(connectionChanges, [true, false], 'the live poll disconnects only when stopped')
    assert.equal(manifests, 2, 'the peer change is checked immediately after the local failure')
    assert.equal(f.dispatched.filter(([action, options]) =>
      action === 'syncWithSyncServer' && options?.remoteOnly).length, 1)
  } finally {
    f.actions.stopSyncServerLive()
    releaseFailure(new Response('Local sync unavailable', { status: 503 }))
    await failed
    await listening
  }
})

test('a full sync refreshes capabilities reused by subsequent live checks', async () => {
  let upgraded = false
  let releasePoll
  let reachedPoll
  const pollReached = new Promise(resolve => { reachedPoll = resolve })
  const f = fixture({ syncServerSyncSubscriptions: false }, {
    encrypted: true,
    respond: (url) => {
      if (url.endsWith('/health')) return { capabilities: {
        encrypted_sync: 1, live_sync: 1, watch_stats: upgraded ? 1 : 0, live_reminders: upgraded ? 1 : 0,
      } }
      if (new URL(url).pathname === '/v1/encrypted_sync/changes') {
        reachedPoll()
        return new Promise(resolve => { releasePoll = resolve })
      }
    },
  })
  const listening = f.actions.startSyncServerLive(f.context)
  try {
    await pollReached
    upgraded = true
    await f.actions.syncWithSyncServer(f.context)
    assert.equal(f.context.state.syncServerWatchStatsSupported, true)
    assert.equal(f.context.state.syncServerLiveRemindersSupported, true)
    await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
    assert.equal(f.context.state.syncServerWatchStatsSupported, true)
    assert.equal(f.context.state.syncServerLiveRemindersSupported, true)
    assert.equal(f.requests.filter(request => request.url.endsWith('/health')).length, 2)
  } finally {
    f.actions.stopSyncServerLive()
    releasePoll({ cursor: 'latest' })
    await listening
  }
})

test('remote capability discovery expires and remains isolated by server and token', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 })
  const f = fixture({ syncServerSyncSubscriptions: false }, { encrypted: true })
  const check = () => f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  const discoveries = () => f.requests.filter(request => request.url.endsWith('/health')).length
  await check()
  await check()
  assert.equal(discoveries(), 1)
  t.mock.timers.tick(5 * 60 * 1000)
  await check()
  assert.equal(discoveries(), 2)
  f.settings.syncServerToken = 'another-token'
  await check()
  assert.equal(discoveries(), 3)
  f.settings.syncServerUrl = 'https://another-sync.example'
  await check()
  assert.equal(discoveries(), 4)
})

test('an older live discovery cannot overwrite a newer full-sync capability result', async () => {
  let discoveries = 0
  let releaseDiscovery
  let reachedDiscovery
  let releasePoll
  let reachedPoll
  const discoveryReached = new Promise(resolve => { reachedDiscovery = resolve })
  const pollReached = new Promise(resolve => { reachedPoll = resolve })
  const f = fixture({ syncServerSyncSubscriptions: false }, {
    encrypted: true,
    respond: url => {
      if (url.endsWith('/health')) {
        if (++discoveries === 1) {
          reachedDiscovery()
          return new Promise(resolve => { releaseDiscovery = resolve })
        }
        return { capabilities: { encrypted_sync: 1, live_sync: 1, watch_stats: 1, live_reminders: 1 } }
      }
      if (new URL(url).pathname === '/v1/encrypted_sync/changes') {
        reachedPoll()
        return new Promise(resolve => { releasePoll = resolve })
      }
    },
  })
  const listening = f.actions.startSyncServerLive(f.context)
  try {
    await discoveryReached
    await f.actions.syncWithSyncServer(f.context)
    releaseDiscovery({ capabilities: { encrypted_sync: 1, live_sync: 1 } })
    await pollReached
    await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
    assert.equal(f.context.state.syncServerWatchStatsSupported, true)
    assert.equal(f.context.state.syncServerLiveRemindersSupported, true)
    assert.equal(discoveries, 2)
  } finally {
    f.actions.stopSyncServerLive()
    releasePoll?.({ cursor: 'latest' })
    await listening
  }
})

test('an automatic check with no net local change neither uploads nor displays a sync cycle', async () => {
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  await f.actions.syncWithSyncServer(f.context)
  f.commits.length = 0
  f.requests.length = 0
  // A setting toggled twice during debounce retains its value, despite a new edit timestamp.
  f.settings.autoplayVideos = false
  f.settings.autoplayVideos = true
  f.settings.syncServerSettingUpdatedAt = { autoplayVideos: Date.now() + 1000 }
  await f.actions.syncWithSyncServer(f.context, { automatic: true })
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 0)
  assert.equal(f.commits.filter(([action, value]) => action === 'setSyncServerStatus' && value === 'syncing').length, 0)
})


test('automatic sync still uploads a real setting change and reports progress', async () => {
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  await f.actions.syncWithSyncServer(f.context)
  f.commits.length = 0
  f.requests.length = 0
  f.settings.autoplayVideos = false
  await f.actions.syncWithSyncServer(f.context, { automatic: true })
  assert.deepEqual(f.requests.filter(request => request.method === 'PUT').map(request => new URL(request.url).pathname), ['/v1/encrypted_sync/settings'])
  assert.equal(f.commits.filter(([action, value]) => action === 'setSyncServerStatus' && value === 'syncing').length, 1)
})

test('remote-only checks process changed revisions and keep message delivery on unchanged revisions', async () => {
  const f = liveFixture()
  await f.actions.syncWithSyncServer(f.context)
  const remote = [{ id: 'private-channel', name: 'Private subscription' }, { id: 'remote-channel', name: 'Remote channel' }]
  f.collections.set('subscriptions', { revision: 2, payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) })
  f.requests.length = 0
  f.dispatched.length = 0
  await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  assert.ok(f.requests.some(request => request.method === 'GET' && request.url.endsWith('/encrypted_sync/subscriptions')))
  assert.ok(f.dispatched.some(([action]) => action === 'updateSyncServerSnapshot'))
  f.dispatched.length = 0
  f.requests.length = 0
  await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  assert.equal(f.requests.some(request => request.url.endsWith('/encrypted_sync/subscriptions')), false)
  assert.equal(f.dispatched.some(([action]) => action === 'updateSyncServerSnapshot'), false)
  assert.ok(f.dispatched.some(([action]) => action === 'refreshSyncServerEvents'))
})

test('live retries a downloaded revision when applying its snapshot failed', async () => {
  const f = liveFixture()
  const dispatch = f.context.dispatch
  let attempts = 0
  f.context.dispatch = (action, value) => {
    if (action === 'updateSyncServerSnapshot' && ++attempts === 1) throw new Error('Snapshot write failed')
    return dispatch(action, value)
  }
  await assert.rejects(f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true }), /Snapshot write failed/)
  await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  assert.equal(attempts, 2)
})

test('a local sync requested during a remote-only check still uploads local changes', async () => {
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  await f.actions.syncWithSyncServer(f.context)
  f.settings.autoplayVideos = false
  f.requests.length = 0
  await Promise.all([
    f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true }),
    f.actions.syncWithSyncServer(f.context, { automatic: true }),
  ])
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1)
})

test('successful silent remote checks clear a transient error without showing sync progress', async () => {
  const f = liveFixture()
  await f.actions.syncWithSyncServer(f.context)
  const manifest = f.Client.prototype.getEncryptedSyncManifest
  f.Client.prototype.getEncryptedSyncManifest = () => { throw new Error('Temporary network failure') }
  await assert.rejects(f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true }), /Temporary network failure/)
  f.Client.prototype.getEncryptedSyncManifest = manifest
  f.commits.length = 0
  await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  assert.equal(f.context.state.syncServerStatus, 'success')
  assert.equal(f.context.state.syncServerError, '')
  assert.equal(f.commits.some(([action, value]) => action === 'setSyncServerStatus' && value === 'syncing'), false)
})

test('a failed remote-only check does not consume a queued local setting upload', async () => {
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  await f.actions.syncWithSyncServer(f.context)
  f.settings.autoplayVideos = false
  f.requests.length = 0
  const manifest = f.Client.prototype.getEncryptedSyncManifest
  f.Client.prototype.getEncryptedSyncManifest = () => {
    f.Client.prototype.getEncryptedSyncManifest = manifest
    throw new Error('Temporary network failure')
  }
  const results = await Promise.allSettled([
    f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true }),
    f.actions.syncWithSyncServer(f.context, { automatic: true }),
  ])
  assert.equal(results[0].status, 'rejected')
  assert.equal(results[1].status, 'fulfilled')
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1)
})

test('bookmark upload conflicts persist the merged baseline and local bookmarks', async () => {
  const local = bookmarks.createPlaylistBookmark({ id: 'local', title: 'Local', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 123 })
  const remote = bookmarks.createPlaylistBookmark({ id: 'remote', title: 'Remote', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 456 })
  let uploads = 0
  let uploaded
  const f = fixture({ syncServerSyncSubscriptions: false, syncServerSyncPlaylists: true, playlistBookmarks: [local] }, {
    encrypted: true,
    respond: async (url, options) => {
      if (!url.endsWith('/encrypted_sync/playlistBookmarks')) return undefined
      if (options.method === 'PUT') {
        if (++uploads === 1) return new Response('{}', { status: 409 })
        uploaded = await privacy.decryptSyncDocument(JSON.parse(options.body).payload, f.settings.syncServerPrivacyKey)
        return { revision: 2 }
      }
      if (!uploads) return { revision: 0, payload: null }
      return { revision: 1, payload: await privacy.encryptSyncDocument([bookmarks.playlistBookmarkForSync(remote)], f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) }
    },
  })
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(uploads, 2)
  assert.deepEqual(uploaded.map(item => item.playlist.id).sort(), ['local', 'remote'])
  assert.deepEqual(JSON.parse(f.settings.syncServerSnapshot).playlistBookmarks.sort(), ['local', 'remote'])
  assert.deepEqual(Array.from(f.settings.playlistBookmarks, item => item.playlist.id).sort(), ['local', 'remote'])
})

test('automatic sync retries reminders after notification permission becomes available', async () => {
  const reminder = {
    videoId: 'abcdefghijk',
    startTimestamp: Date.now() + 60_000,
    notificationTitle: 'Starting soon',
    notificationBody: 'Open stream',
  }
  const local = []
  let permissionGranted = false
  let attempts = 0
  let tick
  const reminderService = {
    list: async () => local,
    schedule: async record => {
      attempts++
      if (!permissionGranted) return false
      local.push(record)
      return true
    },
    cancel: async () => {},
  }
  const f = fixture({ syncServerSyncSubscriptions: false, syncServerSyncLiveReminders: true }, {
    encrypted: true,
    reminderService,
    connected: true,
    timer: callback => { tick = callback },
    respond: async (url) => {
      if (url.endsWith('/health')) return { capabilities: { encrypted_sync: 1, live_sync: 1, live_reminders: 1 } }
      if (url.endsWith('/encrypted_sync')) return { collections: [{ collection: 'liveReminders', revision: 1 }], legacy_data: false }
      if (url.endsWith('/encrypted_sync/liveReminders')) return {
        revision: 1,
        payload: await privacy.encryptSyncDocument([reminder], f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt),
      }
    },
  })
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(f.context.state.syncServerStatus, 'success')
  assert.equal(f.context.state.syncServerLiveRemindersPending, true)
  assert.equal(attempts, 1)
  f.actions.startSyncServerAutoSync(f.context)
  permissionGranted = true
  await tick()
  assert.equal(attempts, 2)
  assert.equal(f.context.state.syncServerLiveRemindersPending, false)
  assert.deepEqual(JSON.parse(f.settings.syncServerSnapshot).liveReminders, [reminder])
})

test('a skipped reminder merge after a 409 keeps the prior snapshot and does not retry upload', async () => {
  const localReminder = {
    videoId: 'abcdefghijk',
    startTimestamp: Date.now() + 60_000,
    notificationTitle: 'Local stream',
    notificationBody: 'Open local stream',
  }
  const remoteReminder = { ...localReminder, videoId: 'lmnopqrstuv', notificationTitle: 'Remote stream' }
  let uploads = 0
  let permissionGranted = false
  let uploaded
  const local = [localReminder]
  const reminderService = {
    list: async () => local,
    schedule: async record => {
      if (!permissionGranted) return false
      local.push(record)
      return true
    },
    cancel: async () => {},
  }
  const f = fixture({
    syncServerSyncSubscriptions: false,
    syncServerSyncLiveReminders: true,
    syncServerSnapshot: JSON.stringify({ liveReminders: [] }),
  }, {
    encrypted: true,
    reminderService,
    respond: async (url, options) => {
      if (url.endsWith('/health')) return { capabilities: { encrypted_sync: 1, live_sync: 1, live_reminders: 1 } }
      if (url.endsWith('/encrypted_sync')) return {
        collections: uploads > 0 ? [{ collection: 'liveReminders', revision: 1 }] : [],
        legacy_data: false,
      }
      if (url.endsWith('/encrypted_sync/liveReminders')) {
        if (options.method === 'PUT') {
          uploads++
          if (uploads > 1) uploaded = await privacy.decryptSyncDocument(JSON.parse(options.body).payload, f.settings.syncServerPrivacyKey)
          return uploads === 1 ? new Response('{}', { status: 409 }) : { revision: 2 }
        }
        return uploads === 0 ? { revision: 0, payload: null } : {
          revision: 1,
          payload: await privacy.encryptSyncDocument([remoteReminder], f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt),
        }
      }
    },
  })
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(uploads, 1)
  assert.equal(f.context.state.syncServerLiveRemindersPending, true)
  assert.deepEqual(JSON.parse(f.settings.syncServerSnapshot).liveReminders, [])
  permissionGranted = true
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(uploads, 2)
  assert.equal(f.context.state.syncServerLiveRemindersPending, false)
  assert.deepEqual(uploaded.map(record => record.videoId), [localReminder.videoId, remoteReminder.videoId])
  assert.deepEqual(JSON.parse(f.settings.syncServerSnapshot).liveReminders.map(record => record.videoId),
    [localReminder.videoId, remoteReminder.videoId])
})

test('live checks retry failed local uploads before clearing the sync error', async () => {
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  await f.actions.syncWithSyncServer(f.context)
  f.settings.autoplayVideos = false
  const put = f.Client.prototype.putEncryptedSyncCollection
  f.Client.prototype.putEncryptedSyncCollection = async () => { throw new Error('Upload unavailable') }
  await assert.rejects(f.actions.syncWithSyncServer(f.context), /Upload unavailable/)
  await assert.rejects(f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true }), /Upload unavailable/)
  assert.equal(f.context.state.syncServerStatus, 'error')
  f.Client.prototype.putEncryptedSyncCollection = put
  f.requests.length = 0
  await f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  assert.ok(f.requests.some(request => request.method === 'PUT' && request.url.endsWith('/encrypted_sync/settings')))
  assert.equal(f.context.state.syncServerStatus, 'success')
  assert.equal(f.context.state.syncServerError, '')
  assert.equal(JSON.parse(f.settings.syncServerSnapshot).settings.autoplayVideos.value, false)
})

for (const [scenario, desktopKeys, phoneKeys] of [
  ['different setting orders', ['autoplayVideos', 'baseTheme'], ['baseTheme', 'autoplayVideos']],
  ['different enabled settings', ['baseTheme', 'autoplayVideos'], ['autoplayVideos']],
  ['different theme defaults and orders', ['autoplayVideos'], ['autoplayVideos']],
]) {
  test(`two devices with ${scenario} settle after live notifications`, async () => {
    const collections = new Map()
    const writes = []
    const documents = []
    const respond = async (url, options) => {
      const path = new URL(url).pathname
      if (path === '/health') return { capabilities: { encrypted_sync: 1, live_sync: 1 } }
      if (path === '/v1/encrypted_sync') return {
        collections: [...collections].map(([collection, entry]) => ({ collection, revision: entry.revision })),
        legacy_data: false,
      }
      if (path === '/v1/encrypted_sync/events') return []
      if (path.startsWith('/v1/encrypted_sync/')) {
        const collection = path.split('/').at(-1)
        if (options.method === 'PUT') {
          const body = JSON.parse(options.body)
          writes.push(collection)
          documents.push(await privacy.decryptSyncDocument(body.payload, Buffer.alloc(32, 1).toString('base64')))
          collections.set(collection, { revision: body.revision + 1, payload: body.payload })
        }
        return collections.get(collection) ?? { revision: 0, payload: null }
      }
    }
    const settings = { syncServerSyncSubscriptions: false, syncServerSyncSettings: true, autoplayVideos: true, baseTheme: 'dark' }
    const a = fixture({ ...settings, syncServerDeviceId: 'desktop' }, { encrypted: true, respond, syncableSettingKeys: desktopKeys })
    const b = fixture({ ...settings, syncServerDeviceId: 'phone' }, { encrypted: true, respond, syncableSettingKeys: phoneKeys })
    if (scenario === 'different theme defaults and orders') {
      const themes = normalizeCustomThemes([
        { ...DEFAULT_CUSTOM_THEME, id: 'youtube', name: 'YouTube Web Dark' },
        { ...DEFAULT_CUSTOM_THEME, id: 'd3sox', name: 'D3SOX' },
      ])
      const phoneThemes = structuredClone(themes)
      for (const theme of phoneThemes) delete theme.colors.watchedThumbnailOverlay
      const received = { key: CUSTOM_THEMES_SYNC_KEY, value: phoneThemes, updatedAt: 10 }
      collections.set('settings', {
        revision: 1,
        payload: await privacy.encryptSyncDocument([received], a.settings.syncServerPrivacyKey, a.settings.syncServerPrivacySalt),
      })
      for (const f of [a, b]) {
        f.settings.syncServerSnapshot = JSON.stringify({ settings: { [CUSTOM_THEMES_SYNC_KEY]: received } })
        f.settings.syncServerSettingUpdatedAt = { [CUSTOM_THEMES_SYNC_KEY]: 20 }
      }
      // Existing devices can have equivalent snapshots serialized differently
      // at the same edit time. Neither snapshot should overwrite the server.
      b.settings.syncServerSnapshot = JSON.stringify({
        settings: { [CUSTOM_THEMES_SYNC_KEY]: { ...received, value: themes } },
      })
      a.context.rootState.utils.customThemes = [...themes].reverse()
      b.context.rootState.utils.customThemes = phoneThemes
    }
    await a.actions.syncWithSyncServer(a.context)
    await b.actions.syncWithSyncServer(b.context)
    // A peer can serialize the same entries in another order. Do not echo it.
    const saved = collections.get('settings')
    const reordered = (await privacy.decryptSyncDocument(saved.payload, a.settings.syncServerPrivacyKey)).reverse()
    collections.set('settings', {
      revision: saved.revision + 1,
      payload: await privacy.encryptSyncDocument(reordered, a.settings.syncServerPrivacyKey, a.settings.syncServerPrivacySalt),
    })
    writes.length = 0
    for (let notification = 0; notification < 4; notification++) {
      // Force periodic merges too: cached live notifications alone skip local comparison.
      await a.actions.syncWithSyncServer(a.context, { automatic: true })
      await b.actions.syncWithSyncServer(b.context, { automatic: true })
    }
    const sorted = document => [...document].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    for (const document of documents) assert.deepEqual(sorted(document), sorted(documents[0]))
    assert.deepEqual(writes, [])
    a.settings.autoplayVideos = false
    a.settings.syncServerSettingUpdatedAt = { autoplayVideos: Date.now() + 1000 }
    await a.actions.syncWithSyncServer(a.context, { automatic: true })
    await b.actions.syncWithSyncServer(b.context, { automatic: true, remoteOnly: true })
    await a.actions.syncWithSyncServer(a.context, { automatic: true, remoteOnly: true })
    await b.actions.syncWithSyncServer(b.context, { automatic: true, remoteOnly: true })
    assert.equal(b.settings.autoplayVideos, false)
    assert.deepEqual(writes, ['settings'])
  })
}

test('a user edit during remote collection application schedules a follow-up upload', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  f.context.rootState.syncServer = f.context.state
  await f.actions.syncWithSyncServer(f.context)
  const remote = await privacy.decryptSyncDocument(f.collections.get('settings').payload, f.settings.syncServerPrivacyKey)
  const entry = remote.find(entry => entry.key === 'autoplayVideos')
  entry.value = false
  entry.updatedAt = Date.now() + 1000
  f.collections.set('settings', { revision: 2, payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) })
  let releaseRemote
  let reachedRemote
  const blocked = new Promise(resolve => { releaseRemote = resolve })
  const reached = new Promise(resolve => { reachedRemote = resolve })
  const dispatch = f.context.dispatch
  f.context.dispatch = async (...args) => {
    const result = await dispatch(...args)
    if (args[0] === 'updateAutoplayVideos') {
      reachedRemote()
      await blocked
    }
    return result
  }
  const syncing = f.actions.syncWithSyncServer(f.context, { automatic: true, remoteOnly: true })
  await reached
  try {
    f.settings.autoplayVideos = true
    f.settings.syncServerSettingUpdatedAt = { autoplayVideos: entry.updatedAt + 1000 }
    f.actions.scheduleSyncServer(f.context, 'settings')
  } finally {
    releaseRemote()
    await syncing
  }
  f.requests.length = 0
  t.mock.timers.tick(1500)
  assert.ok(f.dispatched.some(([action, options]) => action === 'syncWithSyncServer' && options.automatic && !options.remoteOnly))
  await f.actions.syncWithSyncServer(f.context, { automatic: true })
  assert.ok(f.requests.some(request => request.method === 'PUT' && request.url.endsWith('/encrypted_sync/settings')))
  const saved = await privacy.decryptSyncDocument(f.collections.get('settings').payload, f.settings.syncServerPrivacyKey)
  assert.equal(saved.find(entry => entry.key === 'autoplayVideos').value, true)
})

test('a non-sync operation does not leave a stale follow-up sync request', async () => {
  const f = liveFixture({ syncServerSyncSettings: true, autoplayVideos: true })
  f.context.rootState.syncServer = f.context.state
  f.context.commit('setSyncServerStatus', 'syncing')
  f.actions.scheduleSyncServer(f.context, 'settings')
  f.context.commit('setSyncServerStatus', 'idle')
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(f.dispatched.some(([action]) => action === 'scheduleSyncServer'), false)
})

for (const syncServerPrivacyMode of ['enhanced', 'legacy']) {
  test(`manual sync rejects an encryption downgrade with a saved key in ${syncServerPrivacyMode} mode`, async () => {
    const f = fixture({ syncServerPrivacyMode })
    await assert.rejects(f.actions.syncWithSyncServer(f.context), /server no longer supports it/)
    assert.ok(f.requests.every(request => request.url.endsWith('/health')))
  })
}


test('activity refresh shares an in-flight download and retries after failure', async () => {
  let fail = true
  let release
  let pending = new Promise(resolve => { release = resolve })
  const f = fixture({}, { encrypted: true, respond: async url => {
    if (new URL(url).pathname !== '/v1/encrypted_sync/events') return
    await pending
    if (fail) throw new Error('Activity unavailable')
    return []
  } })
  const first = f.actions.refreshSyncServerEvents(f.context)
  const second = f.actions.refreshSyncServerEvents(f.context)
  const settled = Promise.allSettled([first, second])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests.length, 1)
  release()
  assert.ok((await settled).every(result => result.status === 'rejected'))
  fail = false
  pending = Promise.resolve()
  await f.actions.refreshSyncServerEvents(f.context)
  assert.equal(f.requests.length, 2)
})

for (const [syncServerUrl, syncServerUsername, syncServerDeviceId] of [
  ['https://sync.example', 'alice', 'laptop'],
  ['http://127.0.0.1:8080', 'bob', 'tablet'],
  ['http://localhost:8080', 'alice.name', 'laptop.1'],
  ['http://localhost:8080', 'alice\\u002ename', 'laptop'],
]) {
  test(`activity cutoffs persist in NeDB for ${syncServerUrl} and ${syncServerUsername}`, async () => {
    const database = new Datastore()
    const f = fixture({ syncServerUrl, syncServerUsername, syncServerDeviceId })
    const dispatch = f.context.dispatch
    f.context.dispatch = async (action, value) => {
      if (action === 'updateSyncServerActivityClearedThrough') {
        const _id = 'syncServerActivityClearedThrough'
        await database.updateAsync({ _id }, { _id, value }, { upsert: true })
      }
      return dispatch(action, value)
    }
    f.context.commit('setSyncServerActivity', [{ id: '0001:0', createdAt: Date.now() }])
    await f.actions.clearSyncServerActivity(f.context)
    const saved = await database.findOneAsync({ _id: 'syncServerActivityClearedThrough' })
    const [accountKey] = Object.keys(saved.value)
    assert.equal(saved.value[accountKey], '0001')
    assert.deepEqual(JSON.parse(accountKey), [syncServerUrl, syncServerUsername, syncServerDeviceId])
    assert.equal(f.context.state.syncServerActivity.length, 0)
  })
}

test('cleared activity stays hidden after reauthentication while newer activity remains visible', async () => {
  let events = []
  const f = fixture({ syncServerDeviceId: 'laptop' }, { encrypted: true, respond: url => {
    if (new URL(url).pathname === '/v1/encrypted_sync/events') return events
  } })
  const payload = await privacy.encryptSyncDocument({
    version: 1, type: 'activity', deviceName: 'Laptop', changes: [{ key: 'autoplayVideos', value: true }],
  }, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt)
  const event = id => ({ id, recipient: '', payload, created_at: Date.now(), expires_at: Date.now() + 60000 })
  events = [event('0001'), event('0002')]
  await f.actions.refreshSyncServerEvents(f.context)
  await f.actions.clearSyncServerActivity(f.context)
  assert.equal(f.context.state.syncServerActivity.length, 0)
  assert.ok(f.dispatched.some(([action]) => action === 'updateSyncServerActivityClearedThrough'))
  assert.equal(f.requests.some(request => request.method !== 'GET'), false)
  const dispatch = f.context.dispatch
  f.context.dispatch = (action, value) => action === 'initializeSyncServer'
    ? Promise.resolve()
    : dispatch(action, value)
  await f.actions.applySyncServerToken(f.context)
  events.push(event('0003'))
  await f.actions.refreshSyncServerEvents(f.context)
  assert.deepEqual(Array.from(f.context.state.syncServerActivity, entry => entry.id), ['0003:0'])

  f.settings.syncServerUsername = 'bob'
  await f.actions.applySyncServerToken(f.context)
  await f.actions.refreshSyncServerEvents(f.context)
  assert.equal(f.context.state.syncServerActivity.length, 3, 'Another account keeps its activity')
})

test('a download already in flight cannot restore cleared activity', async () => {
  let release
  let events
  const pending = new Promise(resolve => { release = resolve })
  const f = fixture({}, { respond: async url => {
    if (new URL(url).pathname === '/v1/encrypted_sync/events') {
      await pending
      return events
    }
  } })
  const payload = await privacy.encryptSyncDocument({
    version: 1, type: 'activity', deviceName: 'Laptop', changes: [{ key: 'autoplayVideos', value: true }],
  }, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt)
  events = ['0001', '0002'].map(id => ({
    id, recipient: '', payload, created_at: Date.now(), expires_at: Date.now() + 60000,
  }))
  f.context.commit('setSyncServerActivity', [{ id: '0001:0', createdAt: Date.now() }])
  const refreshing = f.actions.refreshSyncServerEvents(f.context)
  await f.actions.clearSyncServerActivity(f.context)
  release()
  await refreshing
  assert.deepEqual(Array.from(f.context.state.syncServerActivity, entry => entry.id), ['0002:0'])
})

test('an in-flight activity refresh cannot commit after the username changes before the token', async () => {
  let release
  let downloadStarted
  const pending = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { downloadStarted = resolve })
  const f = fixture({ syncServerDeviceId: 'laptop' }, { respond: async url => {
    if (new URL(url).pathname === '/v1/encrypted_sync/events') {
      downloadStarted()
      await pending
      return events
    }
  } })
  const payload = await privacy.encryptSyncDocument({
    version: 1, type: 'activity', deviceName: 'Laptop', changes: [{ key: 'autoplayVideos', value: true }],
  }, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt)
  const events = [{ id: '0001', recipient: '', payload, created_at: Date.now(), expires_at: Date.now() + 60000 }]
  const accountKey = JSON.stringify([f.settings.syncServerUrl, 'alice', 'laptop']).replaceAll('.', '\\u002e')
  f.settings.syncServerActivityClearedThrough = { [accountKey]: '0001' }

  const refreshing = f.actions.refreshSyncServerEvents(f.context)
  await started
  await f.context.dispatch('updateSyncServerUsername', 'bob')
  release()
  await refreshing
  assert.equal(f.settings.syncServerToken, 'saved-token')
  assert.equal(f.commits.some(([action]) => action === 'setSyncServerActivity'), false)
  assert.equal(f.context.state.syncServerActivity.length, 0)
})

test('failed persistence leaves activity available to retry clearing', async () => {
  const f = fixture()
  f.context.commit('setSyncServerActivity', [{ id: '0001:0', createdAt: Date.now() }])
  f.context.dispatch = async () => { throw new Error('Disk full') }
  await assert.rejects(f.actions.clearSyncServerActivity(f.context), /Disk full/)
  assert.equal(f.context.state.syncServerActivity.length, 1)
})

for (const refreshAction of ['refreshSyncServerEvents', 'refreshSyncServerDevices']) {
  test(`failure of ${refreshAction} cannot turn a saved library sync into an error`, async () => {
    const f = liveFixture()
    const originalDispatch = f.context.dispatch
    f.context.dispatch = (action, ...args) => action === refreshAction
      ? Promise.reject(new Error('Account metadata unavailable'))
      : originalDispatch(action, ...args)
    await f.actions.syncWithSyncServer(f.context)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.context.state.syncServerStatus, 'success')
    assert.equal(f.context.state.syncServerError, '')
    assert.ok(f.settings.syncServerLastSyncAt > 0)
  })
}


test('background activity skips another renderer download while explicit refresh waits for the lock', async () => {
  const lockOptions = []
  const f = fixture({}, { encrypted: true, locks: {
    request(name, options, callback) {
      lockOptions.push(options)
      return Promise.resolve(callback(options.ifAvailable ? null : { name }))
    },
  } })
  await f.actions.refreshSyncServerEvents(f.context, { background: true })
  assert.equal(f.requests.length, 0)
  await f.actions.refreshSyncServerEvents(f.context)
  assert.equal(f.requests.length, 1)
  assert.equal(lockOptions[0].ifAvailable, true)
  assert.equal(lockOptions[1].ifAvailable, false)
})


test('the live listener retries failed message refresh independently of completed library sync', async () => {
  const f = liveFixture()
  const dispatch = f.context.dispatch
  let refreshes = 0
  f.context.dispatch = (action, value) => {
    if (action === 'refreshSyncServerEvents' && !value?.background) {
      refreshes++
      if (refreshes === 1) return Promise.reject(new Error('Messages unavailable'))
      f.actions.stopSyncServerLive(f.context)
      return Promise.resolve()
    }
    return dispatch(action, value)
  }
  await f.actions.startSyncServerLive(f.context)
  assert.equal(refreshes, 2)
  assert.equal(f.context.state.syncServerStatus, 'success')
  assert.equal(f.context.state.syncServerError, '')
})


test('an explicit activity refresh still downloads when a concurrent background refresh skipped a busy renderer', async () => {
  const f = fixture({}, { encrypted: true, locks: {
    async request(name, options, callback) {
      await new Promise(resolve => setImmediate(resolve))
      return callback(options.ifAvailable ? null : { name })
    },
  } })
  await Promise.all([
    f.actions.refreshSyncServerEvents(f.context, { background: true }),
    f.actions.refreshSyncServerEvents(f.context),
  ])
  assert.equal(f.requests.length, 1)
})


test('a new live device message is delivered after an older activity response finishes', async () => {
  const recipient = 'test-device'
  let releaseOldResponse
  const oldResponse = new Promise(resolve => { releaseOldResponse = resolve })
  let firstStarted
  const started = new Promise(resolve => { firstStarted = resolve })
  let notified
  const notification = new Promise(resolve => { notified = resolve })
  let downloads = 0
  const opened = []
  const f = fixture({ syncServerDeviceId: recipient }, {
    encrypted: true,
    desktopTabs: { async create(route) {
      opened.push(route.route)
      f.actions.stopSyncServerLive(f.context)
      return true
    } },
    respond: async url => {
      const path = new URL(url).pathname
      if (path === '/v1/encrypted_sync/changes') {
        await new Promise(resolve => setImmediate(resolve))
        notified()
        return { cursor: 'new-message-cursor' }
      }
      if (path !== '/v1/encrypted_sync/events') return
      if (++downloads === 1) {
        firstStarted()
        await oldResponse
        return [] // Snapshotted before the newer device message existed.
      }
      // Delivery can take longer than a short fixed assertion delay.
      await new Promise(resolve => setTimeout(resolve, 150))
      return [{ id: 'new-message', recipient, payload, created_at: Date.now(), expires_at: Date.now() + 60000 }]
    },
  })
  const payload = await privacy.encryptSyncDocument({
    version: 1, type: 'openVideo', recipient, videoId: 'jNQXAC9IVRw', title: 'Local fixture', position: 12,
    expiresAt: Date.now() + 60000,
  }, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt)
  const dispatch = f.context.dispatch
  f.context.dispatch = (action, value) => action === 'refreshSyncServerEvents'
    ? f.actions.refreshSyncServerEvents(f.context, value)
    : dispatch(action, value)
  const refreshing = f.actions.refreshSyncServerEvents(f.context)
  await started
  const listening = f.actions.startSyncServerLive(f.context)
  try {
    await notification
    const deadline = Date.now() + 1000
    while (f.context.state.syncServerStatus !== 'success' && Date.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(f.context.state.syncServerStatus, 'success')
    releaseOldResponse()
    await refreshing
    const deliveryDeadline = Date.now() + 5000
    while (opened.length === 0 && Date.now() < deliveryDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.deepEqual(opened, ['/watch/jNQXAC9IVRw?t=12'])
    assert.equal(downloads, 2)
  } finally {
    releaseOldResponse()
    f.actions.stopSyncServerLive(f.context)
    await listening
  }
})

for (const conflict of [false, true]) {
  test(`phone reclamation survives ${conflict ? 'a conflicting upload' : 'an upload failure and retry'} and is consumed after success`, async () => {
    const deviceId = Buffer.alloc(16, 7).toString('base64url')
    const local = [{ sessionId: 'mobile', updatedAt: 2, activeTabId: 'tab', tabs: [{ id: 'tab', url: '/subscriptions' }] }]
    const previous = sessions.normalizeSyncSessionsDocument({ devices: {
      [deviceId]: { platform: 'mobile', sessions: local },
      laptop: { platform: 'desktop', sessions: [{ ...local[0], sessionId: 'laptop' }] },
    } })
    let remote = sessions.removeSyncSession(previous, deviceId, 'mobile', { revokedAccountSessionId: 'old-login' })
    let revision = 1
    let puts = 0
    const f = fixture({
      syncServerDeviceId: deviceId, syncServerSyncSubscriptions: false, syncServerSyncSessions: true,
      syncServerSnapshot: JSON.stringify({ sessionsV2: previous }),
    }, { encrypted: true, desktopTabs: { getSyncSessions: () => local, applySyncSessions: () => true }, respond: async (url, options) => {
      if (url.endsWith('/v1/account/sessions')) return { sessions: [{ id: 'new-login', device_id: deviceId, current: true }] }
      if (url.endsWith('/v1/encrypted_sync')) return { collections: [{ collection: 'sessionsV2', revision }] }
      if (!url.endsWith('/v1/encrypted_sync/sessionsV2')) return undefined
      if (options.method === 'PUT') {
        puts++
        if (puts === 1) {
          if (conflict) {
            remote.devices.laptop.sessions.push({ ...local[0], sessionId: 'new-laptop' })
            remote.devices[deviceId] = { platform: 'desktop', sessions: [{ ...local[0], sessionId: 'new-window', updatedAt: 3 }] }
            revision++
          }
          return new Response('Retry', { status: conflict ? 409 : 503 })
        }
        remote = await privacy.decryptSyncDocument(JSON.parse(options.body).payload, f.settings.syncServerPrivacyKey)
        revision++
      }
      return { revision, payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) }
    } })
    if (!conflict) {
      await assert.rejects(f.actions.syncWithSyncServer(f.context), /Retry/)
      assert.deepEqual(remote.deletedSessions[`revoked-login:${deviceId}`], ['old-login'])
    }
    await f.actions.syncWithSyncServer(f.context)
    assert.deepEqual(remote.devices[deviceId].sessions.filter(session => session.sessionId === 'mobile'), local)
    if (conflict) assert.equal(remote.devices[deviceId].sessions.length, 2)
    assert.equal(remote.deletedSessions[deviceId], undefined)
    if (conflict) assert.equal(remote.devices.laptop.sessions.length, 2)
    remote = sessions.removeSyncSession(remote, deviceId, 'mobile')
    revision++
    await f.actions.syncWithSyncServer(f.context)
    assert.ok(remote.devices[deviceId].sessions.every(session => session.sessionId !== 'mobile'))
    assert.deepEqual(remote.deletedSessions[deviceId], ['mobile'])
  })
}

for (const platform of ['mobile', 'desktop']) for (const login of ['old-login', 'new-login', 'ambiguous', 'missing', 'wrong-device']) {
  test(`upgraded ${platform} client verifies ${login} before reclaiming without local authentication intent`, async () => {
    const deviceId = Buffer.alloc(16, 8).toString('base64url')
    const local = [{ sessionId: 'mobile', updatedAt: 2, tabs: [{ id: 'tab', url: '/subscriptions' }] }]
    let remote = releasedClient.mergeSyncSessions({ deviceId, platform, localSessions: local,
      remoteValue: { version: 1, mode: 'separate', shared: [], devices: {}, deletedSessions: {
        [deviceId]: ['mobile'], [`revoked:${deviceId}`]: ['mobile'], [`revoked-login:${deviceId}`]: ['old-login'],
      } } }).document
    let revision = 1
    let reads = 0
    let puts = 0
    const f = fixture({ syncServerDeviceId: deviceId, syncServerSyncSubscriptions: false,
      syncServerSyncSessions: true, syncServerSnapshot: JSON.stringify({ sessionsV2: remote }),
    }, { encrypted: true, capacitor: platform === 'mobile',
      desktopTabs: { getSyncSessions: () => local, applySyncSessions: () => true }, respond: async (url, options) => {
        if (url.endsWith('/v1/account/sessions')) {
          reads++
          const current = { id: login, device_id: deviceId, current: true }
          return { sessions: login === 'ambiguous' ? [current, { ...current, id: 'second-login' }]
            : login === 'missing' ? [] : login === 'wrong-device' ? [{ ...current, device_id: 'another-device' }] : [current] }
        }
        if (url.endsWith('/v1/encrypted_sync')) return { collections: [{ collection: 'sessionsV2', revision }] }
        if (!url.endsWith('/v1/encrypted_sync/sessionsV2')) return undefined
        if (options.method === 'PUT') {
          puts++
          remote = await privacy.decryptSyncDocument(JSON.parse(options.body).payload, f.settings.syncServerPrivacyKey)
          revision++
        }
        return { revision, payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) }
      } })
    if (['ambiguous', 'missing', 'wrong-device'].includes(login)) {
      await assert.rejects(f.actions.syncWithSyncServer(f.context), /Account Management Failed/)
      assert.equal(puts, 0)
    } else {
      if (login === 'old-login') {
        await assert.rejects(f.actions.syncWithSyncServer(f.context), /Tab Sync Revocation Pending/)
        assert.equal(puts, 0)
      } else await f.actions.syncWithSyncServer(f.context)
      assert.deepEqual(remote.devices[deviceId].sessions, login === 'new-login' ? local : [])
      assert.deepEqual(remote.deletedSessions[deviceId], login === 'new-login' ? undefined : ['mobile'])
    }
    assert.equal(reads, 1)
  })
}

test('a reclamation conflict rechecks login identity against refreshed revocation metadata', async () => {
  const deviceId = Buffer.alloc(16, 10).toString('base64url')
  const local = [{ sessionId: 'mobile', tabs: [{ id: 'tab', url: '/subscriptions' }] }]
  let remote = sessions.removeSyncSession({}, deviceId, 'mobile', { revokedAccountSessionId: 'old-login' })
  let revision = 1
  let puts = 0
  let reads = 0
  const baseline = structuredClone(remote)
  const f = fixture({ syncServerDeviceId: deviceId, syncServerSyncSubscriptions: false,
    syncServerSyncSessions: true, syncServerSnapshot: JSON.stringify({ sessionsV2: baseline }) }, {
    encrypted: true, desktopTabs: { getSyncSessions: () => local, applySyncSessions: () => true },
    respond: async (url, options) => {
      if (url.endsWith('/v1/account/sessions')) {
        reads++
        return { sessions: [{ id: 'new-login', device_id: deviceId, current: true }] }
      }
      if (url.endsWith('/v1/encrypted_sync')) return { collections: [{ collection: 'sessionsV2', revision }] }
      if (!url.endsWith('/v1/encrypted_sync/sessionsV2')) return undefined
      if (options.method === 'PUT') {
        if (++puts === 1) {
          remote.deletedSessions[`revoked-login:${deviceId}`] = ['new-login']
          revision++
          return new Response('Conflict', { status: 409 })
        }
        remote = await privacy.decryptSyncDocument(JSON.parse(options.body).payload, f.settings.syncServerPrivacyKey)
        revision++
      }
      return { revision, payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) }
    },
  })
  await assert.rejects(f.actions.syncWithSyncServer(f.context), /Tab Sync Revocation Pending/)
  assert.equal(reads, 2)
  assert.equal(remote.devices[deviceId], undefined)
  assert.deepEqual(remote.deletedSessions[deviceId], ['mobile'])
  assert.deepEqual(remote.deletedSessions[`revoked-login:${deviceId}`], ['new-login'])
  assert.deepEqual(JSON.parse(f.settings.syncServerSnapshot).sessionsV2, baseline)
  assert.equal(f.context.state.syncServerLastResult.sessions, undefined)
})

for (const initiallyEmpty of [false, true]) {
  test(`pending revocation blocks new windows ${initiallyEmpty ? 'without existing tab sets' : 'after cleanup'} and survives another login reconnecting`, async () => {
    const deviceId = Buffer.alloc(16, 11).toString('base64url')
    const original = { sessionId: 'original', tabs: [{ id: 'original-tab', url: '/subscriptions' }] }
    const newlyOpened = { sessionId: 'new-window', tabs: [{ id: 'new-tab', url: '/history' }] }
    let remote = sessions.removeSyncDeviceSessions(initiallyEmpty ? {} : {
      devices: { [deviceId]: { platform: 'desktop', sessions: [original] } },
    }, deviceId, 'target-login')
    let currentLogin = 'target-login'
    let targetActive = true
    let revision = 1
    let puts = 0
    const local = [original, newlyOpened]
    const f = fixture({ syncServerDeviceId: deviceId, syncServerSyncSubscriptions: true,
      syncServerSyncSessions: true }, { encrypted: true,
      desktopTabs: { getSyncSessions: () => local, applySyncSessions: () => true }, respond: async (url, options) => {
        if (url.endsWith('/v1/account/sessions')) return { sessions: [
          { id: currentLogin, device_id: deviceId, current: true },
          ...(targetActive && currentLogin !== 'target-login'
            ? [{ id: 'target-login', device_id: deviceId, current: false }] : []),
        ] }
        if (url.endsWith('/v1/encrypted_sync')) return { collections: [{ collection: 'sessionsV2', revision }] }
        if (!url.endsWith('/v1/encrypted_sync/sessionsV2')) return undefined
        if (options.method === 'PUT') {
          puts++
          remote = await privacy.decryptSyncDocument(JSON.parse(options.body).payload, f.settings.syncServerPrivacyKey)
          revision++
        }
        return { revision, payload: await privacy.encryptSyncDocument(remote, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt) }
      } })
    const cleaned = structuredClone(remote)
    await assert.rejects(f.actions.syncWithSyncServer(f.context), /Tab Sync Revocation Pending/)
    assert.ok(f.commits.some(([name, value]) => name === 'setSyncServerStatus' && value === 'error'))
    assert.ok(f.commits.some(([name, value]) => name === 'setSyncServerError' && value === 'Settings.Sync Settings.Tab Sync Revocation Pending'))
    const subscriptionUpload = f.requests.find(request => request.method === 'PUT' && request.url.endsWith('/v1/encrypted_sync/subscriptions'))
    assert.ok(subscriptionUpload)
    const subscriptions = await privacy.decryptSyncDocument(JSON.parse(subscriptionUpload.body).payload, f.settings.syncServerPrivacyKey)
    assert.equal(subscriptions[0].id, 'private-channel')
    assert.equal(puts, 0)
    assert.deepEqual(remote, cleaned)
    currentLogin = 'reconnected-login'
    await f.actions.syncWithSyncServer(f.context)
    assert.deepEqual(remote.devices[deviceId].sessions, local)
    assert.deepEqual(remote.deletedSessions[`revoked-login:${deviceId}`], ['target-login'])
    const reconnected = structuredClone(remote)
    currentLogin = 'target-login'
    local.push({ sessionId: 'another-window', tabs: [{ id: 'another-tab', url: '/' }] })
    const previousPuts = puts
    await assert.rejects(f.actions.syncWithSyncServer(f.context), /Tab Sync Revocation Pending/)
    assert.equal(puts, previousPuts)
    assert.deepEqual(remote, reconnected)
    currentLogin = 'reconnected-login'
    targetActive = false
    await f.actions.syncWithSyncServer(f.context)
    assert.equal(remote.deletedSessions[`revoked-login:${deviceId}`], undefined)
  })
}
