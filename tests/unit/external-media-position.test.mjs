import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import {
  clearExternalMediaPositions,
  getExternalMediaPosition,
  getExternalMediaProgress,
  removeExternalMediaPositionsBefore,
  saveExternalMediaPosition,
  syncExternalMediaPositions,
} from '../../src/renderer/helpers/externalMediaPosition.js'

const url = 'https://videos.example.test/episode/1'
let storage
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeEach(() => {
  storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return storage.size },
    key: index => [...storage.keys()][index] ?? null,
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  } })
})
afterEach(() => {
  mock.restoreAll()
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else delete globalThis.localStorage
})

test('persists independent external positions using normalized URLs', () => {
  saveExternalMediaPosition(url, 12, 30)
  saveExternalMediaPosition(`${url}?other=1`, 18, 30)
  assert.equal(getExternalMediaPosition(url, 30), 12)
  assert.equal(getExternalMediaPosition(`${url}?other=1`, 30), 18)
  saveExternalMediaPosition('HTTPS://VIDEOS.EXAMPLE.TEST:443/episode/1', 15, 30)
  assert.equal(getExternalMediaPosition(url, 30), 15)
  assert.equal(getExternalMediaPosition(url, null), 15)
})

test('interleaved saves from separate windows preserve both media positions', () => {
  const otherUrl = `${url}?other=1`
  const setItem = localStorage.setItem
  let interleaved = false
  mock.method(localStorage, 'setItem', (key, value) => {
    if (!interleaved) {
      interleaved = true
      saveExternalMediaPosition(otherUrl, 18, 30)
    }
    setItem(key, value)
  })
  saveExternalMediaPosition(url, 12, 30)
  assert.equal(getExternalMediaPosition(url, 30), 12)
  assert.equal(getExternalMediaPosition(otherUrl, 30), 18)
})

test('restarts completed media and media sought back to the beginning', () => {
  saveExternalMediaPosition(url, 12, 30)
  assert.equal(getExternalMediaPosition(url, 13), null)
  for (const seconds of [28, 30, 0]) {
    storage.clear()
    saveExternalMediaPosition(url, 12, 30)
    saveExternalMediaPosition(url, seconds, 30)
    assert.equal(getExternalMediaPosition(url, 30), null)
    assert.deepEqual(getExternalMediaProgress(url), seconds === 0 ? null : { watched: true, progress: 1 })
    assert.equal(storage.size, seconds === 0 ? 0 : 1)
  }
})

test('keeps finished media watched while it is replayed', () => {
  saveExternalMediaPosition(url, 30, 30)
  saveExternalMediaPosition(url, 12, 30)
  assert.equal(getExternalMediaPosition(url, 30), 12)
  assert.deepEqual(getExternalMediaProgress(url), { watched: true, progress: 1 })
  saveExternalMediaPosition(url, 0, 30)
  assert.equal(getExternalMediaPosition(url, 30), null)
  assert.deepEqual(getExternalMediaProgress(url), { watched: true, progress: 1 })
})

test('reports the progress of partly watched media', () => {
  saveExternalMediaPosition(url, 12, 30)
  assert.deepEqual(getExternalMediaProgress(url), { watched: false, progress: 0.4 })
  // Live streams and positions saved before durations were stored have no progress
  saveExternalMediaPosition(url, 12, Infinity)
  assert.equal(getExternalMediaProgress(url), null)
  assert.equal(getExternalMediaPosition(url, null), 12)
  storage.set(`externalMediaPosition:${url}`, '{"seconds":12,"updatedAt":1000}')
  assert.equal(getExternalMediaProgress(url), null)
  assert.equal(getExternalMediaProgress('invalid'), null)
})

test('ignores invalid positions and unsupported URLs', () => {
  for (const seconds of [-1, Infinity, NaN, '12']) saveExternalMediaPosition(url, seconds, 30)
  for (const badUrl of ['invalid', 'file:///video.mp4', 'https://user:password@example.test/video']) {
    saveExternalMediaPosition(badUrl, 12, 30)
    assert.equal(getExternalMediaPosition(badUrl, 30), null)
  }
  assert.equal(storage.size, 0)
})

test('handles malformed or unavailable browser storage without breaking playback', () => {
  for (const value of ['broken', '{}', '[null]', '{"seconds":"12","updatedAt":1000}']) {
    storage.set(`externalMediaPosition:${url}`, value)
    assert.equal(getExternalMediaPosition(url, 30), null)
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Unavailable') } })
  mock.method(console, 'error', () => {})
  assert.equal(getExternalMediaPosition(url, 30), null)
  assert.doesNotThrow(() => saveExternalMediaPosition(url, 12, 30))
})

test('retention and clearing history remove saved external positions', () => {
  storage.set('playerVolume', '0.7')
  mock.method(Date, 'now', () => 1000)
  saveExternalMediaPosition(url, 12, 30)
  mock.method(Date, 'now', () => 2000)
  saveExternalMediaPosition(`${url}?new`, 18, 30)
  removeExternalMediaPositionsBefore(2000)
  assert.equal(getExternalMediaPosition(url, 30), null)
  assert.equal(getExternalMediaPosition(`${url}?new`, 30), 18)
  clearExternalMediaPositions()
  assert.deepEqual([...storage], [['playerVolume', '0.7']])
})

function syncClient(remote) {
  return {
    uploaded: null,
    async getExternalMediaPositions() { return structuredClone(remote) },
    async putExternalMediaPositions(entries) { this.uploaded = entries },
  }
}

test('syncing keeps the newest position of each URL from either device', async () => {
  const other = `${url}?other=1`
  const remoteOnly = `${url}?remote=1`
  mock.method(Date, 'now', () => 2000)
  saveExternalMediaPosition(url, 12, 30)
  saveExternalMediaPosition(other, 5, 30)
  const client = syncClient([
    { url, seconds: 20, duration: 30, updatedAt: 1000 },
    { url: other, seconds: 0, watched: true, updatedAt: 3000 },
    { url: remoteOnly, seconds: 7, duration: 30, updatedAt: 1500 },
    { url: 'HTTPS://VIDEOS.EXAMPLE.TEST/not-normalized', seconds: 1, updatedAt: 4000 },
    { url: 'file:///home/user/video.mp4', seconds: 1, updatedAt: 4000 },
    { url: `${url}?invalid`, seconds: -1, updatedAt: 4000 },
  ])
  const { synced: baseline } = await syncExternalMediaPositions(client, {}, 0)
  assert.equal(getExternalMediaPosition(url, 30), 12)
  assert.deepEqual(getExternalMediaProgress(other), { watched: true, progress: 1 })
  assert.equal(getExternalMediaPosition(remoteOnly, 30), 7)
  assert.deepEqual(baseline, { [url]: 2000, [other]: 3000, [remoteOnly]: 1500 })
  assert.deepEqual(client.uploaded, [
    { url, seconds: 12, duration: 30, updatedAt: 2000 },
    { url: other, seconds: 0, watched: true, updatedAt: 3000 },
    { url: remoteOnly, seconds: 7, duration: 30, updatedAt: 1500 },
  ])
})

test('syncing removes positions another device removed and uploads local removals', async () => {
  const removedLocally = `${url}?local=1`
  const savedAgain = `${url}?again=1`
  mock.method(Date, 'now', () => 1000)
  saveExternalMediaPosition(url, 12, 30)
  mock.method(Date, 'now', () => 3000)
  saveExternalMediaPosition(savedAgain, 9, 30)
  const client = syncClient([
    { url: removedLocally, seconds: 4, updatedAt: 1000 },
    { url: `${url}?new=1`, seconds: 6, updatedAt: 2000 },
  ])
  const { synced: baseline } = await syncExternalMediaPositions(client, { [url]: 1000, [removedLocally]: 1000, [savedAgain]: 1000 }, 0)
  assert.equal(getExternalMediaPosition(url, 30), null)
  assert.equal(getExternalMediaPosition(removedLocally, 30), null)
  assert.equal(getExternalMediaPosition(savedAgain, 30), 9)
  assert.equal(getExternalMediaPosition(`${url}?new=1`, 30), 6)
  assert.deepEqual(baseline, { [savedAgain]: 3000, [`${url}?new=1`]: 2000 })
  assert.deepEqual(client.uploaded.map(entry => entry.url), [savedAgain, `${url}?new=1`])
})

test('syncing drops positions older than history retention on both sides', async () => {
  const day = 24 * 60 * 60 * 1000
  mock.method(Date, 'now', () => 10 * day)
  saveExternalMediaPosition(url, 12, 30)
  const client = syncClient([
    { url: `${url}?old=1`, seconds: 4, updatedAt: 8 * day },
    { url: `${url}?recent=1`, seconds: 6, updatedAt: 9.5 * day },
  ])
  await syncExternalMediaPositions(client, {}, 1)
  assert.equal(getExternalMediaPosition(`${url}?old=1`, 30), null)
  assert.deepEqual(client.uploaded.map(entry => entry.url), [url, `${url}?recent=1`])
})

test('syncing replaces a damaged saved position instead of removing it everywhere', async () => {
  storage.set(`externalMediaPosition:${url}`, '{not json')
  const client = syncClient([{ url, seconds: 12, duration: 30, updatedAt: 1000 }])
  await syncExternalMediaPositions(client, { [url]: 1000 }, 0)
  assert.equal(getExternalMediaPosition(url, 30), 12)
  assert.deepEqual(client.uploaded.map(entry => entry.url), [url])
})

test('syncing keeps a position saved while the synced positions load', async () => {
  mock.method(Date, 'now', () => 1000)
  saveExternalMediaPosition(url, 12, 30)
  const client = syncClient([])
  client.getExternalMediaPositions = async () => {
    mock.method(Date, 'now', () => 2000)
    saveExternalMediaPosition(url, 20, 30)
    return []
  }
  await syncExternalMediaPositions(client, {}, 0)
  assert.equal(getExternalMediaPosition(url, 30), 20)
  assert.deepEqual(client.uploaded.map(entry => entry.seconds), [20])
})

test('syncing fails without uploading when saved positions cannot be read', async () => {
  saveExternalMediaPosition(url, 12, 30)
  for (const method of ['key', 'getItem']) {
    mock.method(localStorage, method, () => { throw new Error('storage unavailable') })
    const client = syncClient([])
    await assert.rejects(syncExternalMediaPositions(client, { [url]: 1000 }, 0), /storage unavailable/, method)
    assert.equal(client.uploaded, null)
    mock.restoreAll()
  }
})
