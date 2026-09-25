import assert from 'node:assert/strict'
import test from 'node:test'

import { DBActions, IpcChannels, PlaylistVideoAddResult, SyncEvents } from '../../src/constants.js'
import { registerDatastoreIpc, requireSettingRecord } from '../../src/main/datastoreIpc.js'

function setup(handlers = {}) {
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

test('playlist and subscription actions reject array payloads before writing', async () => {
  let writes = 0
  const { registrations, notifications, event } = setup({
    playlists: { upsertVideoByPlaylistId: async () => { writes += 1 } },
    subscriptionCache: { updateVideosByChannelId: async () => { writes += 1 } }
  })
  await assert.rejects(registrations.get(IpcChannels.DB_PLAYLISTS)(event, {
    action: DBActions.PLAYLISTS.UPSERT_VIDEO, data: []
  }), /invalid datastore record/)
  await assert.rejects(registrations.get(IpcChannels.DB_SUBSCRIPTION_CACHE)(event, {
    action: DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data: []
  }), /invalid datastore record/)
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
