import assert from 'node:assert/strict'
import test from 'node:test'

import { DBActions, IpcChannels, PlaylistVideoAddResult, SyncEvents } from '../../src/constants.js'
import { registerDatastoreIpc, requireSettingRecord } from '../../src/main/datastoreIpc.js'

function setup (handlers = {}) {
  const registrations = new Map()
  const notifications = []
  const ipcMain = { handle: (channel, handler) => registrations.set(channel, handler) }
  const event = { senderFrame: { url: 'file:///trusted' }, sender: { id: 1 } }
  registerDatastoreIpc({
    ipcMain,
    handlers,
    isTrustedUrl: url => url === 'file:///trusted',
    syncOtherWindows: (...args) => notifications.push(args),
    getPlayingVideoIds: () => ['playing-video']
  })
  return { registrations, notifications, event }
}

test('history deletion excludes playing videos and announces the deleted IDs', async () => {
  let received
  const { registrations, notifications, event } = setup({
    history: {
      deleteOlderThan: async (...args) => {
        received = args
        return ['old-video']
      }
    }
  })

  const cutoff = Date.now() - 1000
  const result = await registrations.get(IpcChannels.DB_HISTORY)(event, {
    action: DBActions.HISTORY.DELETE_OLDER_THAN,
    data: cutoff
  })

  assert.deepEqual(received, [cutoff, ['playing-video']])
  assert.deepEqual(result, ['old-video'])
  assert.deepEqual(notifications, [[
    IpcChannels.SYNC_HISTORY,
    event,
    { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data: ['old-video'] }
  ]])
})

test('datastore IPC rejects untrusted frames before calling handlers', async () => {
  let called = false
  const { registrations, notifications, event } = setup({
    history: { find: async () => { called = true } }
  })
  event.senderFrame.url = 'https://example.com'

  assert.equal(await registrations.get(IpcChannels.DB_HISTORY)(event, {
    action: DBActions.GENERAL.FIND
  }), undefined)
  assert.equal(called, false)
  assert.deepEqual(notifications, [])
})

test('watch stats backup merge reaches the handler and broadcasts its result', async () => {
  const backup = { records: [{ date: '2026-09-26', seconds: 12 }], adjustment: null }
  const merged = { records: backup.records, adjustment: null }
  const calls = []
  const { registrations, notifications, event } = setup({
    watchStats: { mergeBackup: async data => { calls.push(data); return merged } }
  })

  assert.deepEqual(await registrations.get(IpcChannels.DB_WATCH_STATS)(event, {
    action: DBActions.WATCH_STATS.MERGE_BACKUP,
    data: backup
  }), merged)
  assert.deepEqual(calls, [backup])
  assert.deepEqual(notifications, [[
    IpcChannels.SYNC_WATCH_STATS,
    event,
    { event: SyncEvents.GENERAL.OVERWRITE, data: merged }
  ]])
})

test('datastore IPC rejects malformed request envelopes after checking the frame', async () => {
  let called = false
  const { registrations, event } = setup({
    history: { find: async () => { called = true } }
  })
  const invoke = registrations.get(IpcChannels.DB_HISTORY)
  await assert.rejects(invoke(event, null), /invalid datastore request/)
  await assert.rejects(invoke(event, { action: 'find' }), /invalid datastore request/)
  assert.equal(called, false)

  event.senderFrame.url = 'https://example.com'
  assert.equal(await invoke(event, null), undefined)
})

test('playlist video sync occurs only after a new video is added', async () => {
  let result = PlaylistVideoAddResult.ADDED
  const { registrations, notifications, event } = setup({
    playlists: { upsertVideoByPlaylistId: async () => result }
  })
  const request = {
    action: DBActions.PLAYLISTS.UPSERT_VIDEO,
    data: { _id: 'playlist', lastUpdatedAt: 1, videoData: { videoId: 'video' } }
  }

  assert.equal(await registrations.get(IpcChannels.DB_PLAYLISTS)(event, request), PlaylistVideoAddResult.ADDED)
  assert.equal(notifications.length, 1)
  assert.deepEqual(notifications[0], [
    IpcChannels.SYNC_PLAYLISTS,
    event,
    { event: SyncEvents.PLAYLISTS.UPSERT_VIDEO, data: request.data }
  ])

  result = PlaylistVideoAddResult.ALREADY_PRESENT
  await registrations.get(IpcChannels.DB_PLAYLISTS)(event, request)
  assert.equal(notifications.length, 1)
})

test('playlist unlink actions preserve their history updates and broadcasts', async () => {
  const calls = []
  const { registrations, notifications, event } = setup({
    history: {
      unsetLastViewedPlaylistForVideos: async (...args) => calls.push(['videos', ...args]),
      unsetLastViewedPlaylists: async ids => calls.push(['playlists', ids])
    }
  })
  const invoke = registrations.get(IpcChannels.DB_HISTORY)
  const videos = { videoIds: ['video'], lastViewedPlaylistId: 'playlist' }
  const playlists = ['playlist']
  await invoke(event, { action: DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, data: videos })
  await invoke(event, { action: DBActions.HISTORY.UNSET_PLAYLISTS, data: playlists })
  assert.deepEqual(calls, [['videos', ['video'], 'playlist'], ['playlists', playlists]])
  assert.deepEqual(notifications, [
    [IpcChannels.SYNC_HISTORY, event, { event: SyncEvents.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, data: videos }],
    [IpcChannels.SYNC_HISTORY, event, { event: SyncEvents.HISTORY.UNSET_PLAYLISTS, data: playlists }]
  ])
})

test('subscription cache does not broadcast rejected stale updates', async () => {
  const { registrations, notifications, event } = setup({
    subscriptionCache: { updateVideosByChannelId: async () => false }
  })

  assert.equal(await registrations.get(IpcChannels.DB_SUBSCRIPTION_CACHE)(event, {
    action: DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL,
    data: { channelId: 'channel', entries: [], timestamp: 1 }
  }), false)
  assert.deepEqual(notifications, [])
})

test('subscription cache accepts Date timestamps and post IDs from renderer feeds', async () => {
  const received = []
  const { registrations, event } = setup({
    subscriptionCache: {
      updateVideosByChannelId: async (...args) => { received.push(args); return true },
      updateCommunityPostsByChannelId: async (...args) => { received.push(args); return true },
      markEntriesAsSeen: async (...args) => { received.push(args) }
    }
  })
  const invoke = registrations.get(IpcChannels.DB_SUBSCRIPTION_CACHE)
  const timestamp = new Date('2026-09-26T00:00:00.000Z')
  await invoke(event, {
    action: DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL,
    data: { channelId: 'channel', entries: [{ videoId: 'video' }], timestamp }
  })
  await invoke(event, {
    action: DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL,
    data: { channelId: 'channel', entries: [{ postId: 'post' }], timestamp: timestamp.getTime() }
  })
  await invoke(event, {
    action: DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN,
    data: { channelId: 'channel', tab: 'posts', entries: [{ postId: 'post' }] }
  })
  assert.equal(received.length, 3)
})

test('property-based history actions reject malformed records before writing', async () => {
  let called = false
  const { registrations, event } = setup({
    history: { updateWatchProgress: async () => { called = true } }
  })
  await assert.rejects(registrations.get(IpcChannels.DB_HISTORY)(event, {
    action: DBActions.HISTORY.UPDATE_WATCH_PROGRESS,
    data: null
  }), /invalid datastore record/)
  assert.equal(called, false)
})

test('watch progress requires a video ID and finite position before writing', async () => {
  let called = false
  const { registrations, notifications, event } = setup({
    history: { updateWatchProgress: async () => { called = true } }
  })
  const invoke = registrations.get(IpcChannels.DB_HISTORY)
  for (const data of [
    { videoId: '', watchProgress: 2 },
    { videoId: 'video', watchProgress: Infinity },
    { videoId: 'video', watchProgress: '2' },
    { videoId: 'video', watchProgress: -1 }
  ]) {
    await assert.rejects(invoke(event, {
      action: DBActions.HISTORY.UPDATE_WATCH_PROGRESS, data
    }), /invalid watch progress record/)
  }
  assert.equal(called, false)
  assert.deepEqual(notifications, [])

  await invoke(event, {
    action: DBActions.HISTORY.UPDATE_WATCH_PROGRESS,
    data: { videoId: 'video', watchProgress: 0 }
  })
  assert.equal(called, true)
})

test('playlist and subscription actions reject array payloads before writing', async () => {
  let writes = 0
  const { registrations, notifications, event } = setup({
    playlists: { upsertVideoByPlaylistId: async () => { writes += 1 } },
    subscriptionCache: { updateVideosByChannelId: async () => { writes += 1 } }
  })
  await assert.rejects(registrations.get(IpcChannels.DB_PLAYLISTS)(event, {
    action: DBActions.PLAYLISTS.UPSERT_VIDEO, data: []
  }), /invalid datastore/)
  await assert.rejects(registrations.get(IpcChannels.DB_SUBSCRIPTION_CACHE)(event, {
    action: DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data: []
  }), /invalid datastore/)
  assert.equal(writes, 0)
  assert.deepEqual(notifications, [])
})

test('valid datastore action payloads still reach their handlers', async () => {
  const calls = []
  const { registrations, event } = setup({
    history: { updateSubscriptionState: async data => { calls.push(['history', data]); return { records: [] } } },
    recommendations: { record: async data => { calls.push(['recommendations', data]); return {} } },
    watchStats: { addWatchTime: async (date, seconds) => { calls.push(['watchStats', { date, seconds }]) } },
    profiles: {
      create: async data => { calls.push(['profiles.create', data]); return { _id: 'generated', ...data } },
      addChannelToProfiles: async (channel, profileIds) => { calls.push(['profiles.addChannel', { channel, profileIds }]) }
    },
    searchHistory: { upsert: async data => { calls.push(['searchHistory', data]); return data } },
    subscriptionCache: { updateVideosByChannelId: async (...args) => { calls.push(['subscriptionCache', args]); return true } }
  })
  const requests = [
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE, { records: [] }],
    [IpcChannels.DB_RECOMMENDATIONS, DBActions.GENERAL.UPSERT, { epoch: 'epoch', video: { videoId: 'video' } }],
    [IpcChannels.DB_WATCH_STATS, DBActions.WATCH_STATS.ADD_WATCH_TIME, { date: '2026-09-26', seconds: 1.5 }],
    [IpcChannels.DB_PROFILES, DBActions.GENERAL.CREATE, { name: 'Profile', subscriptions: [] }],
    [IpcChannels.DB_PROFILES, DBActions.PROFILES.ADD_CHANNEL, { channel: { id: 'channel' }, profileIds: [] }],
    [IpcChannels.DB_SEARCH_HISTORY, DBActions.GENERAL.UPSERT, { query: 'query', lastUpdatedAt: 1 }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, {
      channelId: 'channel', entries: [], timestamp: '2026-09-26T00:00:00.000Z'
    }]
  ]

  for (const [channel, action, data] of requests) {
    await registrations.get(channel)(event, { action, data })
  }
  assert.equal(calls.length, requests.length)
})

test('datastore write actions reject incomplete payloads before calling handlers', async () => {
  let writes = 0
  const rejectUnexpectedWrite = new Proxy({}, {
    get: () => () => { writes += 1 }
  })
  const { registrations, notifications, event } = setup({
    history: rejectUnexpectedWrite,
    recommendations: rejectUnexpectedWrite,
    watchStats: rejectUnexpectedWrite,
    profiles: rejectUnexpectedWrite,
    playlists: rejectUnexpectedWrite,
    searchHistory: rejectUnexpectedWrite,
    subscriptionCache: rejectUnexpectedWrite
  })
  const invalidRequests = [
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE, { records: 'invalid' }],
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE, { metadata: [null] }],
    [IpcChannels.DB_HISTORY, DBActions.GENERAL.UPSERT, undefined],
    [IpcChannels.DB_HISTORY, DBActions.GENERAL.OVERWRITE, {}],
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.APPLY_SYNC_CHANGES, { insertions: [], updates: [] }],
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UPDATE_PLAYLIST, { lastViewedPlaylistId: 'playlist' }],
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, { videoIds: 'video', lastViewedPlaylistId: 'playlist' }],
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, { videoIds: ['video'], lastViewedPlaylistId: null }],
    [IpcChannels.DB_HISTORY, DBActions.HISTORY.UNSET_PLAYLISTS, 'playlist'],
    [IpcChannels.DB_HISTORY, DBActions.GENERAL.DELETE, undefined],
    [IpcChannels.DB_RECOMMENDATIONS, DBActions.GENERAL.UPSERT, undefined],
    [IpcChannels.DB_RECOMMENDATIONS, DBActions.GENERAL.DELETE_MULTIPLE, null],
    [IpcChannels.DB_WATCH_STATS, DBActions.WATCH_STATS.MERGE_BACKUP, { records: null, adjustment: null }],
    [IpcChannels.DB_WATCH_STATS, DBActions.WATCH_STATS.ADD_WATCH_TIME, { date: '2026-09-26' }],
    [IpcChannels.DB_WATCH_STATS, DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME, {}],
    [IpcChannels.DB_PROFILES, DBActions.GENERAL.CREATE, undefined],
    [IpcChannels.DB_PROFILES, DBActions.GENERAL.UPSERT, null],
    [IpcChannels.DB_PROFILES, DBActions.PROFILES.ADD_CHANNEL, { channel: { id: 'channel' } }],
    [IpcChannels.DB_PROFILES, DBActions.PROFILES.REMOVE_CHANNEL, { channelId: 'channel' }],
    [IpcChannels.DB_PROFILES, DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS, { channel: { id: 'channel' } }],
    [IpcChannels.DB_PROFILES, DBActions.GENERAL.DELETE, undefined],
    [IpcChannels.DB_PLAYLISTS, DBActions.GENERAL.CREATE, undefined],
    [IpcChannels.DB_PLAYLISTS, DBActions.GENERAL.UPSERT, null],
    [IpcChannels.DB_PLAYLISTS, DBActions.PLAYLISTS.UPSERT_VIDEO, { _id: 'playlist', lastUpdatedAt: 1 }],
    [IpcChannels.DB_PLAYLISTS, DBActions.PLAYLISTS.UPSERT_VIDEOS, { _id: 'playlist', lastUpdatedAt: 1 }],
    [IpcChannels.DB_PLAYLISTS, DBActions.PLAYLISTS.UPSERT_VIDEOS, { _id: 'playlist', lastUpdatedAt: 1, videos: [null] }],
    [IpcChannels.DB_PLAYLISTS, DBActions.GENERAL.DELETE, undefined],
    [IpcChannels.DB_PLAYLISTS, DBActions.PLAYLISTS.DELETE_VIDEO_ID, { _id: 'playlist', lastUpdatedAt: 1 }],
    [IpcChannels.DB_PLAYLISTS, DBActions.PLAYLISTS.DELETE_VIDEO_IDS, { _id: 'playlist', lastUpdatedAt: 1 }],
    [IpcChannels.DB_PLAYLISTS, DBActions.PLAYLISTS.DELETE_ALL_VIDEOS, undefined],
    [IpcChannels.DB_PLAYLISTS, DBActions.GENERAL.DELETE_MULTIPLE, null],
    [IpcChannels.DB_SEARCH_HISTORY, DBActions.GENERAL.UPSERT, undefined],
    [IpcChannels.DB_SEARCH_HISTORY, DBActions.GENERAL.OVERWRITE, {}],
    [IpcChannels.DB_SEARCH_HISTORY, DBActions.GENERAL.DELETE, undefined],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, { channelId: 'channel' }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, {
      channelId: 'channel', entries: [null], timestamp: 1
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, {
      channelId: 'channel', entries: [{ videoId: 'video' }], timestamp: {}
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, {
      channelId: 'channel', entries: [{ videoId: 'video' }], timestamp: 'not-a-date'
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, {
      channelId: 'channel', entries: [{}], timestamp: 1
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL, {
      channelId: 'channel', entries: [{ videoId: 'video' }], timestamp: 1
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL, {
      channelId: 'channel', entries: [{}]
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN, { channelId: 'channel', entries: [] }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN, {
      channelId: 'channel', tab: 'posts', entries: [{ videoId: 'video' }]
    }],
    [IpcChannels.DB_SUBSCRIPTION_CACHE, DBActions.GENERAL.DELETE_MULTIPLE, null]
  ]

  for (const [channel, action, data] of invalidRequests) {
    await assert.rejects(registrations.get(channel)(event, { action, data }), /invalid datastore/)
  }
  assert.equal(writes, 0)
  assert.deepEqual(notifications, [])
})

test('setting records require a string key while allowing all value types', () => {
  assert.deepEqual(requireSettingRecord({ _id: 'useTrayIcon', value: false }), {
    _id: 'useTrayIcon', value: false
  })
  assert.deepEqual(requireSettingRecord({ _id: 'optionalSetting' }), { _id: 'optionalSetting' })
  assert.throws(() => requireSettingRecord(null), /invalid settings record/)
  assert.throws(() => requireSettingRecord([]), /invalid settings record/)
  assert.throws(() => requireSettingRecord({ value: true }), /invalid settings record/)
})
