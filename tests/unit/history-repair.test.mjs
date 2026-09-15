import assert from 'node:assert/strict'
import test from 'node:test'
import { needsHistoryRepair, historyRepairPatch, parseHistoryRepairPlayer, repairHistory } from '../../src/historyRepair.js'

const record = { videoId: 'abcdefghijk', title: 'Video', author: 'Channel', authorId: 'channel', published: 1, lengthSeconds: 0, isLive: true, timeWatched: 5, watchProgress: 12, isWatched: true }
const metadata = { lengthSeconds: 120, isLive: false, isUpcoming: false }

test('repair selects incomplete imports and live entries, excluding stations and complete videos', () => {
  assert.equal(needsHistoryRepair(record), true)
  assert.equal(needsHistoryRepair({ ...record, isStation: true }), false)
  assert.equal(needsHistoryRepair({ ...record, ...metadata }), false)
  assert.equal(needsHistoryRepair({ ...record, ...metadata, authorId: '' }), true)
})

test('confirmed duration repairs false live flags without changing personal data', () => {
  assert.deepEqual(historyRepairPatch(record, metadata), { videoId: record.videoId, ...metadata, liveNow: false })
  assert.equal(historyRepairPatch(record, { lengthSeconds: 120 }), null)
  assert.equal(historyRepairPatch(record, { ...metadata, lengthSeconds: 0 }), null)
})

test('ended streams are not identified as currently live from isLiveContent', () => {
  const parsed = parseHistoryRepairPlayer({ videoDetails: { videoId: record.videoId, isLiveContent: true, lengthSeconds: '120' } }, record.videoId)
  assert.equal(parsed.isLive, false)
  assert.equal(parsed.lengthSeconds, 120)
  assert.throws(() => parseHistoryRepairPlayer({}, record.videoId))
})

test('repair uses latest entries, batches saves, reports errors and skips removed records', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...record, videoId: `abcdefghij${i}` }))
  let active = 0
  let maxActive = 0
  const saved = []
  const result = await repairHistory({
    records: rows, signal: new AbortController().signal, onProgress: () => {},
    getRecord: id => id.endsWith('0') ? null : rows.find(row => row.videoId === id),
    fetchMetadata: async id => {
      active++; maxActive = Math.max(active, maxActive)
      await new Promise(resolve => setTimeout(resolve, 1)); active--
      if (id.endsWith('1')) throw new Error('Unavailable')
      return metadata
    },
    saveMetadata: async patches => { saved.push(patches); return { repaired: patches.length, failed: 0 } }
  })
  assert.equal(maxActive, 4)
  assert.equal(saved.length, 2)
  assert.deepEqual(result, { total: 8, checked: 8, repaired: 6, failed: 1 })
})

test('cancellation stops queued work and does not save in-flight responses', async () => {
  const controller = new AbortController()
  let requests = 0
  await repairHistory({
    records: Array(8).fill(record), signal: controller.signal, onProgress: () => {},
    getRecord: () => record,
    fetchMetadata: async () => { requests++; controller.abort(); return metadata },
    saveMetadata: () => { assert.fail('Cancelled repair saved metadata') }
  })
  assert.equal(requests, 4)
})

test('active streams and upcoming videos keep their verified status', () => {
  const live = historyRepairPatch({ ...record, isLive: false }, { lengthSeconds: 120, isLive: true, isUpcoming: false })
  assert.equal(live.isLive, true)
  assert.equal(live.liveNow, true)
  assert.equal(live.lengthSeconds, undefined)
  const upcoming = historyRepairPatch(record, { lengthSeconds: 120, isLive: false, isUpcoming: true })
  assert.equal(upcoming.isUpcoming, true)
  assert.equal(upcoming.lengthSeconds, undefined)
})

test('missing channel metadata is filled without replacing existing titles or watch context', () => {
  const patch = historyRepairPatch({ ...record, author: '', authorId: undefined }, {
    ...metadata, author: 'Recovered channel', authorId: 'channel-id', title: 'New title', timeWatched: 999, watchProgress: 0
  })
  assert.equal(patch.author, 'Recovered channel')
  assert.equal(patch.authorId, 'channel-id')
  assert.equal(patch.title, undefined)
  assert.equal(patch.timeWatched, undefined)
  assert.equal(patch.watchProgress, undefined)
})

test('database failures are counted and do not stop later repair batches', async () => {
  let saves = 0
  const result = await repairHistory({
    records: Array(8).fill(record), signal: new AbortController().signal, onProgress: () => {},
    getRecord: () => record, fetchMetadata: async () => metadata,
    saveMetadata: async patches => { if (++saves === 1) throw new Error('Write failed'); return { repaired: patches.length, failed: 0 } }
  })
  assert.deepEqual(result, { total: 8, checked: 8, repaired: 4, failed: 4 })
})


test('repair selects imports whose only missing metadata is the publication date', () => {
  for (const published of [undefined, null, 0, '']) {
    const imported = { ...record, ...metadata, published }
    assert.equal(needsHistoryRepair(imported), true)
    assert.equal(historyRepairPatch(imported, { ...metadata, published: 123 }).published, 123)
  }
})


test('repair progress includes both successful and failed writes in the same batch', async () => {
  const result = await repairHistory({
    records: Array(4).fill(record), signal: new AbortController().signal, onProgress: () => {},
    getRecord: () => record, fetchMetadata: async () => metadata,
    saveMetadata: async () => ({ repaired: 3, failed: 1 })
  })
  assert.deepEqual(result, { total: 4, checked: 4, repaired: 3, failed: 1 })
})

test('explicit broadcast status overrides legacy isLive on ended and upcoming premieres', () => {
  for (const isUpcoming of [false, true]) {
    const metadata = parseHistoryRepairPlayer({
      videoDetails: { videoId: record.videoId, isLive: true, isUpcoming, lengthSeconds: '120' },
      microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false } } }
    }, record.videoId)
    assert.equal(metadata.isLive, false)
    const patch = historyRepairPatch(record, metadata)
    assert.equal(patch.isLive, false)
    assert.equal(patch.liveNow, false)
    assert.equal(patch.isUpcoming, isUpcoming)
  }
})

test('upcoming status suppresses legacy live status even without broadcast metadata', () => {
  const metadata = parseHistoryRepairPlayer({
    videoDetails: { videoId: record.videoId, isLive: true, isUpcoming: true }
  }, record.videoId)
  assert.equal(metadata.isLive, false)
})
