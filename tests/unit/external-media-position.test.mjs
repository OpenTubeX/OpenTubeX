import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import {
  clearExternalMediaPositions,
  getExternalMediaPosition,
  removeExternalMediaPositionsBefore,
  saveExternalMediaPosition,
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
    saveExternalMediaPosition(url, 12, 30)
    saveExternalMediaPosition(url, seconds, 30)
    assert.equal(getExternalMediaPosition(url, 30), null)
    assert.equal(storage.size, 0)
  }
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
