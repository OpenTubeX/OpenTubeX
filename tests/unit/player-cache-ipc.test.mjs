import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerPlayerCacheIpc } from '../../src/main/playerCacheIpc.js'

async function withCache(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-player-cache-'))
  const registrations = new Map()
  registerPlayerCacheIpc({
    ipcMain: { handle: (channel, handler) => registrations.set(channel, handler) },
    directory,
    isTrustedUrl: url => url === 'app://bundle/index.html'
  })
  const event = { senderFrame: { url: 'app://bundle/index.html' } }
  try {
    await run({ directory, registrations, event })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('player cache stores keys within its directory and retrieves their data', async () => {
  await withCache(async ({ directory, registrations, event }) => {
    const key = '../player\\code.js'
    const value = new Uint8Array([1, 2, 3]).buffer
    assert.equal(await registrations.get(IpcChannels.PLAYER_CACHE_SET)(event, key, value), undefined)
    assert.deepEqual(await readdir(directory), ['______player__code__js'])
    assert.deepEqual(await readFile(path.join(directory, '______player__code__js')), Buffer.from([1, 2, 3]))
    assert.ok(await registrations.get(IpcChannels.PLAYER_CACHE_GET)(event, key) instanceof ArrayBuffer)
  })
})

test('player cache misses return undefined and untrusted frames cannot read or write', async () => {
  await withCache(async ({ directory, registrations, event }) => {
    assert.equal(await registrations.get(IpcChannels.PLAYER_CACHE_GET)(event, 'missing'), undefined)
    event.senderFrame.url = 'https://example.com'
    assert.equal(await registrations.get(IpcChannels.PLAYER_CACHE_SET)(event, 'blocked', new Uint8Array([1]).buffer), undefined)
    assert.equal(await registrations.get(IpcChannels.PLAYER_CACHE_GET)(event, 'blocked'), undefined)
    assert.deepEqual(await readdir(directory), [])
  })
})
