import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { createI18n } from 'vue-i18n'
import { SyncCollectionCache, createSyncActivity, validateDeviceRequest, watchSyncChanges } from '../../src/renderer/helpers/sync-server-live.js'
import { SYNC_SETTING_LABELS, SYNC_SETTING_VALUE_LABELS } from '../../src/renderer/helpers/sync-setting-labels.js'

test('cached collections are immutable, revision-specific and isolated between accounts and keys', () => {
  const cache = new SyncCollectionCache()
  cache.use('account-a:key-a')
  const original = [{ key: 'baseTheme', value: 'dark' }]
  cache.put('settings', 3, original)
  original[0].value = 'light'
  assert.equal(cache.get('settings', 3).data[0].value, 'dark')
  cache.get('settings', 3).data[0].value = 'light'
  assert.equal(cache.get('settings', 3).data[0].value, 'dark')
  assert.equal(cache.get('settings', 4), null)
  cache.use('account-a:key-b')
  assert.equal(cache.get('settings', 3), null)
})

test('activity describes only changed settings with stable keys and omits initial baselines and noisy collections', () => {
  const before = [{ key: 'baseTheme', value: 'dark', updatedAt: 1 }]
  assert.equal(createSyncActivity('settings', [], before, 'device', 'Laptop'), null)
  assert.equal(createSyncActivity('settings', before, [{ ...before[0], updatedAt: 2 }], 'device', 'Laptop'), null)
  assert.deepEqual(createSyncActivity('settings', before, [{ key: 'baseTheme', value: 'light' }], 'device', 'Laptop'), {
    version: 1, type: 'activity', deviceId: 'device', deviceName: 'Laptop', changes: [{ key: 'baseTheme', value: 'light' }],
  })
  assert.equal(createSyncActivity('settings', before, [{ key: 'baseTheme', value: 'x'.repeat(10000) }], 'device', 'Laptop').changes[0].value, null)
  for (const key of ['channelPlaybackSpeeds', 'channelVolumes', 'channelSubtitlesStates', 'channelVideoQualities', 'playlistReverseStates', 'sponsorBlockDraftSegmentsByVideoId']) {
    assert.equal(createSyncActivity('settings', [{ key, value: '{}' }], [{ key, value: '{"video":2}' }], 'device', 'Laptop'), null)
  }
  for (const collection of ['history', 'seenVideos', 'seenPosts', 'sessions', 'sessionsV2']) {
    assert.equal(createSyncActivity(collection, [], ['changed'], 'device', 'Laptop'), null)
  }
})

test('known setting labels resolve to existing English and German translations', async () => {
  for (const locale of ['en-US', 'de-DE']) {
    const messages = YAML.parse(await readFile(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages } })
    for (const [key, paths] of Object.entries(SYNC_SETTING_LABELS)) {
      for (const path of Array.isArray(paths) ? paths : [paths]) assert.ok(i18n.global.te(path), `${locale} ${key}: ${path}`)
    }
    for (const [key, choices] of Object.entries(SYNC_SETTING_VALUE_LABELS)) {
      for (const [value, path] of Object.entries(choices)) assert.ok(i18n.global.te(path), `${locale} ${key}=${value}: ${path}`)
    }
    assert.equal(i18n.global.t(SYNC_SETTING_VALUE_LABELS.tabCloseFocus.nextTab),
      locale === 'en-US' ? 'Next tab in tab order' : 'Nächster Tab in der Tab-Reihenfolge')
  }
})

test('caption font changes describe caption appearance rather than the unchanged edge style', () => {
  const before = [{ key: 'defaultCaptionSettings', value: { fontScale: 1, edgeStyle: 'none' } }]
  const after = [{ key: 'defaultCaptionSettings', value: { fontScale: 2, edgeStyle: 'none' } }]
  const activity = createSyncActivity('settings', before, after, 'device', 'Laptop')
  assert.equal(activity.changes.length, 1)
  assert.equal(SYNC_SETTING_LABELS[activity.changes[0].key], 'Settings.Player Settings.Caption Appearance.Caption Appearance')
})

test('device requests reject another recipient, arbitrary routes, expired messages and invalid positions', () => {
  const now = 100000
  const request = { version: 1, type: 'openVideo', recipient: 'phone', videoId: 'dQw4w9WgXcQ', title: 'Video', position: 30, expiresAt: now + 5000 }
  assert.equal(validateDeviceRequest(request, 'phone', now), true)
  assert.equal(validateDeviceRequest({ ...request, expiresAt: now + 86400000 + 60000 }, 'phone', now), true)
  for (const invalid of [{ recipient: 'other' }, { videoId: '../settings' }, { expiresAt: now }, { expiresAt: now + 90000000 }, { position: -1 }, { position: NaN }, { type: 'execute' }]) {
    assert.equal(validateDeviceRequest({ ...request, ...invalid }, 'phone', now), false)
  }
})

test('live sync retries an unprocessed cursor after failure, ignores unchanged cursors, and stops on cancellation', async () => {
  const cursors = []
  let changes = 0
  const client = {
    cancelled: false,
    async waitForSyncChanges(cursor) {
      cursors.push(cursor)
      if (cursors.length === 4) { this.cancelled = true; return { cursor: 'newer' } }
      return { cursor: 'latest' }
    },
  }
  const errors = []
  await watchSyncChanges(client, async () => {
    if (++changes === 1) throw new Error('Network lost during download')
  }, error => errors.push(error.message), { sleep: async () => {} })
  assert.deepEqual(cursors, ['', '', 'latest', 'latest'])
  assert.equal(changes, 2)
  assert.deepEqual(errors, ['Network lost during download'])
})

test('live sync stops retrying expired authentication and exponentially backs off network errors', async () => {
  const delays = []
  let attempts = 0
  await watchSyncChanges({ cancelled: false, waitForSyncChanges: async () => { throw new Error(++attempts < 5 ? 'offline' : 'expired') } },
    () => assert.fail(), error => error.message !== 'expired', { sleep: async delay => delays.push(delay) })
  assert.deepEqual(delays, [1000, 2000, 4000, 8000])
})

test('live sync retries discovery before polling and stops when unsupported or cancelled', async () => {
  const delays = []
  let attempts = 0
  let polls = 0
  const client = { cancelled: false, waitForSyncChanges: async () => { polls++; client.cancelled = true; return { cursor: 'ready' } } }
  await watchSyncChanges(client, () => assert.fail(), () => true, {
    prepare: async () => { if (++attempts < 3) throw new Error('temporary discovery failure'); return true },
    sleep: async ms => delays.push(ms),
  })
  assert.equal(attempts, 3)
  assert.equal(polls, 1)
  assert.deepEqual(delays, [1000, 2000])
  for (const supported of [false, true]) {
    const stopped = { cancelled: false, waitForSyncChanges: () => assert.fail('must not poll') }
    await watchSyncChanges(stopped, () => assert.fail(), () => true, {
      prepare: async () => { stopped.cancelled = supported; return supported },
    })
  }
})

test('history retention activity uses the setting name instead of its input hint', () => {
  assert.equal(SYNC_SETTING_LABELS.historyRetentionDays, 'Settings.Privacy Settings.Automatic History Retention')
})

test('live connection health follows successful polls, errors, recovery, and cancellation', async () => {
  const connected = []
  let polls = 0
  const client = {
    cancelled: false,
    async waitForSyncChanges() {
      if (++polls === 2) throw new Error('Disconnected')
      if (polls === 4) this.cancelled = true
      return { cursor: 'latest' }
    },
  }
  await watchSyncChanges(client, async () => {}, async () => true, {
    sleep: async () => {},
    onConnectionChange: value => connected.push(value),
  })
  assert.deepEqual(connected, [true, false, true, false])
})

test('live connection health is shared across owners and released on disconnect', async () => {
  const { locks } = await import('node:worker_threads')
  const { SyncLiveConnectionState } = await import('../../src/renderer/helpers/sync-server-live.js')
  const owner = new SyncLiveConnectionState(locks)
  const otherTab = new SyncLiveConnectionState(locks)
  try {
    assert.equal(await otherTab.isConnected(), false)
    owner.setConnected(true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await otherTab.isConnected(), true)
    owner.setConnected(false)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await otherTab.isConnected(), false)
    owner.setConnected(true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await otherTab.isConnected(), true)
  } finally {
    owner.setConnected(false)
    await new Promise(resolve => setImmediate(resolve))
  }
})

test('subscription settings activity ignores default additions and timestamps but reports actual preference changes', () => {
  const key = 'subscriptionChannelSettings'
  const defaults = { feedTypes: ['videos', 'shorts', 'live', 'posts'], showMembersOnly: false }
  const before = [{ key, value: { first: { value: defaults, updatedAt: 1 } } }]
  const after = [{ key, value: { first: { value: defaults, updatedAt: 2 }, second: { value: defaults, updatedAt: 2 } } }]
  assert.equal(createSyncActivity('settings', before, after, 'device', 'Laptop'), null)
  after[0].value.first.value = { ...defaults, dailyVideoLimit: 3 }
  assert.deepEqual(createSyncActivity('settings', before, after, 'device', 'Laptop', [{ id: 'first', name: 'First channel' }]).changes, [
    { key, detail: 'dailyVideoLimit', item: 'First channel', value: 3 },
  ])
  assert.equal(SYNC_SETTING_LABELS[key], 'Channel.Subscription settings')
})

test('removing saved subscription preferences reports the restored defaults', () => {
  const key = 'subscriptionChannelSettings'
  const before = [{ key, value: { first: { value: { feedTypes: ['videos'], dailyVideoLimit: 3, showMembersOnly: true } } } }]
  const after = [{ key, value: {} }]
  assert.deepEqual(createSyncActivity('settings', before, after, 'device', 'Laptop', [{ id: 'first', name: 'Alpha' }]).changes, [
    { key, detail: 'feedTypes', item: 'Alpha', value: 'videos,shorts,live,posts' },
    { key, detail: 'dailyVideoLimit', item: 'Alpha', value: 'global' },
    { key, detail: 'showMembersOnly', item: 'Alpha', value: false },
  ])
})

test('turning off the last subscription feed type records an empty choice', () => {
  const key = 'subscriptionChannelSettings'
  const before = [{ key, value: { first: { value: { feedTypes: ['videos'] } } } }]
  const after = [{ key, value: { first: { value: { feedTypes: [] } } } }]
  assert.deepEqual(createSyncActivity('settings', before, after, 'device', 'Laptop', [{ id: 'first', name: 'Alpha' }]).changes, [
    { key, detail: 'feedTypes', item: 'Alpha', value: '' },
  ])
})

test('subscription activity names additions and removals but ignores metadata refreshes', () => {
  const oldChannels = [{ id: 'a', name: 'Alpha', thumbnail: 'old' }, { id: 'b', name: 'Beta' }]
  const newChannels = [{ id: 'a', name: 'Alpha', thumbnail: 'new' }, { id: 'c', name: 'Gamma' }]
  assert.deepEqual(createSyncActivity('subscriptions', oldChannels, newChannels, 'device', 'Laptop').changes, [
    { collection: 'subscriptions', action: 'removed', item: 'Beta' },
    { collection: 'subscriptions', action: 'added', item: 'Gamma' },
  ])
  assert.equal(createSyncActivity('subscriptions', oldChannels, [{ ...oldChannels[0], thumbnail: 'new' }, oldChannels[1]], 'device', 'Laptop'), null)
})

test('playlist activity describes playlists, video membership and metadata changes', () => {
  const before = [
    { playlist: { id: 'one', title: 'Old name', description: '' }, videos: [{ id: 'video-a', title: 'Video A' }] },
    { playlist: { id: 'gone', title: 'Gone' }, videos: [] },
  ]
  const after = [
    { playlist: { id: 'one', title: 'New name', description: 'Updated' }, videos: [{ id: 'video-b', title: 'Video B' }] },
    { playlist: { id: 'new', title: 'New playlist' }, videos: [] },
  ]
  assert.deepEqual(createSyncActivity('playlists', before, after, 'device', 'Laptop').changes, [
    { collection: 'playlists', action: 'removed', item: 'Gone' },
    { collection: 'playlists', action: 'added', item: 'New playlist' },
    { collection: 'playlists', action: 'renamed', item: 'Old name', value: 'New name' },
    { collection: 'playlists', action: 'removed', item: 'Video A', parent: 'New name' },
    { collection: 'playlists', action: 'added', item: 'Video B', parent: 'New name' },
    { collection: 'playlists', action: 'updated', item: 'New name' },
  ])
})

test('playlist and profile reorder activity is retained', () => {
  const videos = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }]
  const playlist = { playlist: { id: 'one', title: 'Favorites' }, videos }
  assert.deepEqual(createSyncActivity('playlists', [playlist], [{ ...playlist, videos: videos.toReversed() }], 'device', 'Laptop').changes, [
    { collection: 'playlists', action: 'updated', item: 'Favorites' },
  ])
  const profile = { group: { id: 'one', title: 'News' }, channels: videos }
  assert.deepEqual(createSyncActivity('profiles', [profile], [{ ...profile, channels: videos.toReversed() }], 'device', 'Laptop').changes, [
    { collection: 'profiles', action: 'updated', item: 'News' },
  ])
})

test('profile activity describes profile and channel membership changes', () => {
  const before = [{ group: { id: 'one', title: 'News', bg_color: '#000' }, channels: [{ id: 'a', name: 'Alpha' }] }]
  const after = [
    { group: { id: 'one', title: 'Current news', bg_color: '#fff' }, channels: [{ id: 'b' }] },
    { group: { id: 'two', title: 'Music' }, channels: [] },
  ]
  assert.deepEqual(createSyncActivity('profiles', before, after, 'device', 'Laptop', [{ id: 'b', name: 'Beta' }]).changes, [
    { collection: 'profiles', action: 'added', item: 'Music' },
    { collection: 'profiles', action: 'renamed', item: 'News', value: 'Current news' },
    { collection: 'profiles', action: 'removed', item: 'Alpha', parent: 'Current news' },
    { collection: 'profiles', action: 'added', item: 'Beta', parent: 'Current news' },
    { collection: 'profiles', action: 'updated', item: 'Current news' },
  ])
})

test('saved playlist activity distinguishes bookmarks from playlist edits', () => {
  const bookmark = (id, title) => ({ playlist: { id, title } })
  assert.deepEqual(createSyncActivity('playlistBookmarks', [bookmark('a', 'Alpha')], [bookmark('b', 'Beta')], 'device', 'Laptop').changes, [
    { collection: 'playlistBookmarks', action: 'removed', item: 'Alpha' },
    { collection: 'playlistBookmarks', action: 'added', item: 'Beta' },
  ])
})

test('complex setting activity describes each channel preference and caption field', () => {
  const key = 'subscriptionChannelSettings'
  const before = [{ key, value: { a: { value: { feedTypes: ['videos'], dailyVideoLimit: 1 } } } }]
  const after = [{ key, value: { a: { value: { feedTypes: ['shorts'], dailyVideoLimit: null, showMembersOnly: true } } } }]
  assert.deepEqual(createSyncActivity('settings', before, after, 'device', 'Laptop', [{ id: 'a', name: 'Alpha' }]).changes, [
    { key, detail: 'feedTypes', item: 'Alpha', value: 'shorts' },
    { key, detail: 'dailyVideoLimit', item: 'Alpha', value: 'unlimited' },
    { key, detail: 'showMembersOnly', item: 'Alpha', value: true },
  ])
  assert.deepEqual(createSyncActivity('settings',
    [{ key: 'defaultCaptionSettings', value: { fontScale: 1, edgeStyle: 'none' } }],
    [{ key: 'defaultCaptionSettings', value: { fontScale: 1.5, edgeStyle: 'outline' } }],
    'device', 'Laptop').changes, [
    { key: 'defaultCaptionSettings', detail: 'Font Size', value: 1.5 },
    { key: 'defaultCaptionSettings', detail: 'Edge Style.Edge Style', value: 'outline' },
  ])
})

test('custom theme activity names additions, removals, renames and edits without color payloads', () => {
  const oldThemes = [
    { id: 'one', name: 'Old', colors: { primary: '#111111' } },
    { id: 'gone', name: 'Gone', colors: {} },
  ]
  const newThemes = [
    { id: 'one', name: 'New', colors: { primary: '#222222' } },
    { id: 'added', name: 'Added', colors: {} },
  ]
  assert.deepEqual(createSyncActivity('settings',
    [{ key: 'customThemes', value: oldThemes }], [{ key: 'customThemes', value: newThemes }],
    'device', 'Laptop').changes, [
    { key: 'customThemes', action: 'removed', item: 'Gone' },
    { key: 'customThemes', action: 'added', item: 'Added' },
    { key: 'customThemes', action: 'renamed', item: 'Old', value: 'New' },
    { key: 'customThemes', action: 'updated', item: 'New' },
  ])
})

test('activity bounds large imports and omits long item names', () => {
  const channels = Array.from({ length: 200 }, (_, index) => ({ id: String(index), name: `Channel ${index}` }))
  const activity = createSyncActivity('subscriptions', [], channels, 'device', 'Laptop')
  assert.equal(activity.changes.length, 64)
  assert.deepEqual(activity.changes.at(-1), { collection: 'subscriptions' })
  const long = createSyncActivity('subscriptions', [], [
    { id: 'long', name: 'a'.repeat(129) },
    { id: 'also-long', name: 'b'.repeat(129) },
  ], 'device', 'Laptop')
  assert.deepEqual(long.changes, [{ collection: 'subscriptions' }])
})
