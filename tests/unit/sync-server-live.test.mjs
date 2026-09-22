import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { createI18n } from 'vue-i18n'
import { SyncCollectionCache, createSyncActivity, validateDeviceRequest, watchSyncChanges } from '../../src/renderer/helpers/sync-server-live.js'
import { SYNC_SETTING_LABELS } from '../../src/renderer/helpers/sync-setting-labels.js'

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
  assert.deepEqual(createSyncActivity('settings', before, after, 'device', 'Laptop').changes, [{ key, value: null }])
  assert.equal(SYNC_SETTING_LABELS[key], 'Channel.Subscription settings')
})
