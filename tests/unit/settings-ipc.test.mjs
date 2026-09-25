import assert from 'node:assert/strict'
import test from 'node:test'

import { DBActions, IpcChannels, SyncEvents } from '../../src/constants.js'
import { registerSettingsIpc } from '../../src/main/settingsIpc.js'

function setup () {
  const handlers = new Map()
  const mutations = []
  const broadcasts = []
  const effects = []
  registerSettingsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    settings: {
      mergeSeenVideos: async data => { mutations.push(['mergeSeenVideos', data]); return ['a'] },
      mergeSeenPosts: async data => { mutations.push(['mergeSeenPosts', data]); return ['b'] },
      find: async () => [],
      upsert: async (id, value) => mutations.push(['upsert', id, value]),
      delete: async id => mutations.push(['delete', id])
    },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    syncOtherWindows: (...args) => broadcasts.push(args),
    onSettingUpsert: async data => effects.push(data)
  })
  return { handler: handlers.get(IpcChannels.DB_SETTINGS), mutations, broadcasts, effects }
}

const event = { senderFrame: { url: 'app://bundle/index.html' } }

test('settings IPC rejects an untrusted sender and protected screenshot folder upsert', async () => {
  const { handler, mutations, effects } = setup()
  assert.equal(await handler({ senderFrame: { url: 'https://example.com' } }, {
    action: DBActions.GENERAL.UPSERT,
    data: { _id: 'baseTheme', value: 'dark' }
  }), undefined)
  assert.equal(await handler(event, {
    action: DBActions.GENERAL.UPSERT,
    data: { _id: 'screenshotFolderPath', value: '/tmp' }
  }), null)
  assert.deepEqual(mutations, [])
  assert.deepEqual(effects, [])
})

test('settings IPC persists and broadcasts a validated upsert before applying effects', async () => {
  const { handler, mutations, broadcasts, effects } = setup()
  const data = { _id: 'baseTheme', value: 'dark' }
  assert.equal(await handler(event, { action: DBActions.GENERAL.UPSERT, data }), null)
  assert.deepEqual(mutations, [['upsert', 'baseTheme', 'dark']])
  assert.deepEqual(broadcasts, [[IpcChannels.SYNC_SETTINGS, event, { event: SyncEvents.GENERAL.UPSERT, data }]])
  assert.deepEqual(effects, [data])
})

test('settings IPC merges seen videos and synchronizes the resulting record', async () => {
  const { handler, mutations, broadcasts } = setup()
  assert.deepEqual(await handler(event, { action: DBActions.SETTINGS.MERGE_SEEN_VIDEOS, data: ['a'] }), ['a'])
  assert.deepEqual(mutations, [['mergeSeenVideos', ['a']]])
  assert.deepEqual(broadcasts, [[IpcChannels.SYNC_SETTINGS, event, {
    event: SyncEvents.GENERAL.UPSERT,
    data: { _id: 'subscriptionSeenVideos', value: ['a'] }
  }]])
})

test('settings IPC validates the request envelope after trusting its sender', async () => {
  const { handler, mutations } = setup()
  await assert.rejects(handler(event, null), /invalid datastore request/)
  await assert.rejects(handler(event, { action: 'find' }), /invalid datastore request/)
  assert.equal(await handler({ senderFrame: { url: 'https://example.com' } }, null), undefined)
  assert.deepEqual(mutations, [])
})
