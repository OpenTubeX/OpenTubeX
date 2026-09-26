import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerStorageIpc } from '../../src/main/storageIpc.js'

function setup() {
  const registrations = new Map()
  const calls = []
  registerStorageIpc({
    ipcMain: { handle: (channel, handler) => registrations.set(channel, handler) },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    getStorageUsage: async () => { calls.push('usage'); return { profileTotal: 10 } },
    clearStorage: async category => { calls.push(['clear', category]); return true },
    compactStorageDatabases: async () => { calls.push('compact'); return true }
  })
  const event = {
    senderFrame: { url: 'app://bundle/index.html' },
    sender: { isFocused: () => true }
  }
  return { registrations, calls, event }
}

test('storage IPC exposes usage and compaction to trusted frames', async () => {
  const { registrations, calls, event } = setup()
  assert.deepEqual(await registrations.get(IpcChannels.STORAGE_GET_USAGE)(event), { profileTotal: 10 })
  assert.equal(await registrations.get(IpcChannels.STORAGE_COMPACT_DATABASES)(event), true)
  assert.deepEqual(calls, ['usage', 'compact'])
})

test('storage clearing also requires a focused sender', async () => {
  const { registrations, calls, event } = setup()
  event.sender.isFocused = () => false
  assert.equal(await registrations.get(IpcChannels.STORAGE_CLEAR)(event, 'http-cache'), false)
  assert.deepEqual(calls, [])
  event.sender.isFocused = () => true
  assert.equal(await registrations.get(IpcChannels.STORAGE_CLEAR)(event, 'http-cache'), true)
  assert.deepEqual(calls, [['clear', 'http-cache']])
})

test('storage IPC rejects untrusted frames with existing fallback values', async () => {
  const { registrations, calls, event } = setup()
  event.senderFrame.url = 'https://example.com'
  assert.deepEqual(await registrations.get(IpcChannels.STORAGE_GET_USAGE)(event), {})
  assert.equal(await registrations.get(IpcChannels.STORAGE_CLEAR)(event, 'http-cache'), false)
  assert.equal(await registrations.get(IpcChannels.STORAGE_COMPACT_DATABASES)(event), false)
  assert.deepEqual(calls, [])
})
