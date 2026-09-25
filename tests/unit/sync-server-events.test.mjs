import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendSyncActivityEntries,
  getNextSyncEventCursor,
  parseSyncEvents,
  pruneSyncActivity,
} from '../../src/renderer/helpers/sync-server-events.js'

test('sync events reject a non-list response and skip entries without string IDs', () => {
  assert.throws(() => parseSyncEvents({ events: [] }), { message: 'Invalid sync events' })
  assert.deepEqual(parseSyncEvents([null, { id: 1 }, { id: 'a', recipient: '', payload: 'cipher' }]), [
    { id: 'a', recipient: '', payload: 'cipher' },
  ])
})

test('only broadcast events advance the cursor, including expired or unreadable events', () => {
  assert.equal(getNextSyncEventCursor('b', { id: 'c', recipient: '' }), 'c')
  assert.equal(getNextSyncEventCursor('b', { id: 'a', recipient: '' }), 'b')
  assert.equal(getNextSyncEventCursor('b', { id: 'z', recipient: 'phone' }), 'b')
})

test('activity events retain valid changes, original indexes, and avoid duplicate IDs', () => {
  const existing = [{ id: 'event:0', key: 'existing', createdAt: 10 }]
  const event = { id: 'event', created_at: 20 }
  const payload = {
    version: 1,
    type: 'activity',
    deviceName: 'Laptop',
    changes: [{ key: 'theme', value: 'dark' }, null, { collection: 'playlists' }, { value: 'missing key' }],
  }
  assert.deepEqual(appendSyncActivityEntries(existing, event, payload), [
    existing[0],
    { collection: 'playlists', id: 'event:2', deviceName: 'Laptop', createdAt: 20 },
  ])
  assert.equal(existing.length, 1)
  assert.deepEqual(appendSyncActivityEntries([], event, { ...payload, version: 2 }), [])
  assert.deepEqual(appendSyncActivityEntries([], event, { ...payload, deviceName: 3 }), [])
  assert.deepEqual(appendSyncActivityEntries([], { ...event, created_at: 'bad date' }, payload), [])
})

test('activity feed caps changes and keeps the 200 newest unexpired entries', () => {
  const event = { id: 'bulk', created_at: 100 }
  const payload = {
    version: 1,
    type: 'activity',
    deviceName: 'Phone',
    changes: Array.from({ length: 501 }, (_, index) => ({ key: `key${index}` })),
  }
  const expanded = appendSyncActivityEntries([], event, payload)
  assert.equal(expanded.length, 500)
  assert.equal(expanded.at(-1).id, 'bulk:499')
  const now = 31 * 24 * 60 * 60 * 1000
  const recent = expanded.map((entry, index) => ({ ...entry, createdAt: now - 1000 + index }))
  assert.equal(pruneSyncActivity([{ id: 'old', createdAt: 0 }, ...recent], now).length, 200)
  assert.equal(pruneSyncActivity([{ id: 'old', createdAt: 0 }, ...recent], now)[0].id, 'bulk:499')
})
