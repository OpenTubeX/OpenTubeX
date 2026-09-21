import * as bookmarks from '../../src/renderer/helpers/playlist-bookmarks.js'
import * as syncLive from '../../src/renderer/helpers/sync-server-live.js'
import * as subscriptionSettingsSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { encryptLegacyDocument } from '../helpers/encrypt-legacy-sync-document.mjs'
import { CUSTOM_THEMES_SYNC_KEY, normalizeCustomThemes } from '../../src/customTheme.js'
import { mergeSettingEntry, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as privacy from '../../src/renderer/helpers/sync-server-privacy.js'
import { dispatchRemoteSyncAction, isRecentSync, isSyncReasonEnabled } from '../../src/renderer/helpers/sync-server-scheduling.js'
import { createSyncServerRequestHeaders } from '../../src/renderer/helpers/sync-server-request.js'
import { mergeSubscriptionSeenVideos } from '../../src/subscriptionSeenVideos.js'
import { syncSubscriptionSeenVideos } from '../../src/renderer/helpers/subscription-seen-videos.js'

// These modules use webpack imports. Keep their actual request, merge, and store
// code while replacing platform dependencies and the network with local fixtures.
function withoutImports (source) {
  return source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, '')
}

const helperSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')

function fixture (overrides = {}, { encrypted = false, respond, connectionState = 'online', online = true, browser = false, deferLock = false, syncableSettingKeys = ['channelPlaybackSpeeds'] } = {}) {
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
  const common = {
    ...syncLive,
    ...bookmarks,
    ...subscriptionSettingsSync,
    ...errors,
    showToast: options => notifications.push(options),
    showToastOnAllTabs: (message, time, icon, buttonAction) => notifications.push({
      message, time, icon, buttonAction, broadcast: true,
    }),
    i18n: { global: { t: key => key } },
    ...privacy,
    syncSubscriptionSeenVideos,
    dispatchRemoteSyncAction,
    isRecentSync,
    isSyncReasonEnabled,
    getConnectionState: () => network.state,
    navigator: { get onLine() { return network.online },
      ...(deferLock ? { locks: { request: (name, callback) => Promise.resolve().then(callback) } } : {}) },
    connectionEvents,
    ...(browser ? { window: new EventTarget(), document: new EventTarget(), isAppHidden: () => false } : {}),
    crypto,
    URL,
    Headers,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    structuredClone,
    TextEncoder,
    TextDecoder,
    process: { env: {} },
    packageDetails: { version: 'test' },
    MAIN_PROFILE_ID: 'main',
    deepCopy: structuredClone,
    createSyncServerRequestHeaders,
    CUSTOM_THEMES_SYNC_KEY,
    normalizeCustomThemes,
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
  vm.runInContext(withoutImports(helperSource) + '\nglobalThis.exports = { SyncServerClient, syncSubscriptions, syncSettings, syncHistory, syncPlaylists, syncPlaylistBookmarks, normalizeSyncServerUrl };', helper)
  const store = vm.createContext({ ...common, ...helper.exports, getSavedOtherDeviceSessions: () => [] })
  vm.runInContext(withoutImports(storeSource).replace('export default { state, getters, actions, mutations }', 'globalThis.exports = { state, actions, mutations }'), store)
  const context = {
    rootState: {
      settings,
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

for (const historyEnabled of [false, true]) {
  for (const supported of [false, true]) {
    test(`seen videos sync requires history enabled=${historyEnabled} and server support=${supported}`, async () => {
      const f = fixture({
        syncServerSyncHistory: historyEnabled,
        subscriptionSeenVideos: JSON.stringify([{ videoId: 'private-seen-video', seenAt: 1000 }]),
      }, {
        encrypted: true,
        respond: url => url.endsWith('/health')
          ? { capabilities: { encrypted_sync: 1, live_sync: 1, seen_videos: supported ? 1 : 0 } }
          : undefined,
      })
      await f.actions.syncWithSyncServer(f.context)
      assert.equal(f.context.state.syncServerStatus, 'success')
      const seenRequests = f.requests.filter(request => request.url.endsWith('/encrypted_sync/seenVideos'))
      assert.equal(seenRequests.length, historyEnabled && supported ? 2 : 0)
      if (seenRequests.length > 0) {
        const upload = seenRequests.find(request => request.method === 'PUT')
        assert.ok(!upload.body.includes('private-seen-video'))
        const entries = await privacy.decryptSyncDocument(JSON.parse(upload.body).payload, f.settings.syncServerPrivacyKey)
        assert.equal(entries[0].videoId, 'private-seen-video')
      }
    })
  }
}

test('seen-video upload conflicts retain marks added by both devices', async () => {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const remote = await privacy.encryptSyncDocument([{ videoId: 'other-device', seenAt: 2000 }], key, salt)
  let uploads = 0
  const f = fixture({
    syncServerSyncHistory: true,
    subscriptionSeenVideos: JSON.stringify([{ videoId: 'local-device', seenAt: 1000 }]),
  }, {
    encrypted: true,
    respond(url, options) {
      if (url.endsWith('/health')) return { capabilities: { encrypted_sync: 1, live_sync: 1, seen_videos: 1 } }
      if (!url.endsWith('/encrypted_sync/seenVideos')) return
      if (options.method === 'PUT' && ++uploads === 1) return new Response('{}', { status: 409 })
      if (!options.method && uploads > 0) return { revision: 1, payload: remote }
    },
  })
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(f.context.state.syncServerStatus, 'success')
  const upload = f.requests.filter(request => request.method === 'PUT' && request.url.endsWith('/seenVideos')).at(-1)
  const entries = await privacy.decryptSyncDocument(JSON.parse(upload.body).payload, key)
  assert.deepEqual(entries.map(entry => entry.videoId), ['local-device', 'other-device'])
  assert.equal(uploads, 2)
})

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

test('encrypted upload deadlines include activity ciphertext', async () => {
  const f = fixture()
  const client = new f.Client(f.settings.syncServerUrl)
  client.request = async (_path, options) => options
  const response = await client.putEncryptedSyncCollection('settings', 0, 'x'.repeat(1024 * 1024), 'a'.repeat(256 * 1024))
  assert.equal(response.timeoutMs, 25000)
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
      await a.actions.syncWithSyncServer(a.context, { automatic: true, remoteOnly: true })
      await b.actions.syncWithSyncServer(b.context, { automatic: true, remoteOnly: true })
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

test('a user edit during remote collection application schedules a follow-up upload', async () => {
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
  assert.ok(f.dispatched.some(([action, reason]) => action === 'scheduleSyncServer' && reason === 'data'))
  f.requests.length = 0
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
