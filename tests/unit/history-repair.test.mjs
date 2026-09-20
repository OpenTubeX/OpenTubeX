import assert from 'node:assert/strict'
import test from 'node:test'
import { needsHistoryRepair, historyRepairPatch, parseHistoryRepairPlayer, repairHistory as runRepairHistory } from '../../src/historyRepair.js'

const repairHistory = options => runRepairHistory({ wait: async () => {}, ...options })

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

test('temporary metadata failures recover within one repair run', async () => {
  let attempts = 0
  const result = await repairHistory({
    records: [record], signal: new AbortController().signal, onProgress: () => {},
    getRecord: () => record,
    fetchMetadata: async () => {
      if (++attempts === 1) throw new TypeError('Failed to fetch')
      return metadata
    },
    saveMetadata: async patches => ({ repaired: patches.length, failed: 0 })
  })
  assert.deepEqual(result, { total: 1, checked: 1, repaired: 1, failed: 0 })
})


test('retries only failed requests after the first pass, with decreasing concurrency', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...record, videoId: `abcdefghij${i}` }))
  const attempts = new Map()
  const requested = []
  const waits = []
  const progress = []
  const activeByPass = [0, 0, 0]
  const maxByPass = [0, 0, 0]
  const result = await repairHistory({
    records: rows, signal: new AbortController().signal,
    getRecord: id => rows.find(row => row.videoId === id),
    onProgress: value => progress.push(value),
    wait: async milliseconds => waits.push(milliseconds),
    fetchMetadata: async id => {
      const pass = attempts.get(id) ?? 0
      attempts.set(id, pass + 1)
      requested.push(id)
      activeByPass[pass]++
      maxByPass[pass] = Math.max(maxByPass[pass], activeByPass[pass])
      await new Promise(resolve => setImmediate(resolve))
      activeByPass[pass]--
      if (id.endsWith('0') || pass === 2) return metadata
      throw new Error('Temporary server failure')
    },
    saveMetadata: async patches => ({ repaired: patches.length, failed: 0 })
  })
  assert.deepEqual(requested.slice(0, 8), rows.map(row => row.videoId))
  assert.equal(attempts.get(rows[0].videoId), 1)
  assert.deepEqual(maxByPass, [4, 2, 1])
  assert.ok(waits.includes(3000))
  assert.ok(waits.filter(delay => delay === 1000).length > 2)
  assert.deepEqual(result, { total: 8, checked: 8, repaired: 8, failed: 0 })
  assert.ok(progress.every(value => value.checked <= value.total && value.failed >= 0))
  assert.ok(progress.some(value => value.checked === 8 && value.failed === 7))
})

test('persistent server failures stop after three attempts and count once', async () => {
  let attempts = 0
  const result = await repairHistory({
    records: [record], signal: new AbortController().signal, onProgress: () => {},
    getRecord: () => record,
    fetchMetadata: async () => { attempts++; throw Object.assign(new Error('Service unavailable'), { status_code: 503 }) },
    saveMetadata: () => assert.fail('Unavailable metadata must not be saved')
  })
  assert.equal(attempts, 3)
  assert.deepEqual(result, { total: 1, checked: 1, repaired: 0, failed: 1 })
})

test('cancellation during the retry pause starts no additional requests', async () => {
  const controller = new AbortController()
  let attempts = 0
  const result = await runRepairHistory({
    records: [record], signal: controller.signal,
    onProgress: value => { if (value.failed) setImmediate(() => controller.abort()) },
    getRecord: () => record,
    fetchMetadata: async () => { attempts++; throw new Error('Temporary failure') },
    saveMetadata: () => assert.fail('Cancelled repair saved metadata')
  })
  assert.equal(controller.signal.aborted, true)
  assert.equal(attempts, 1)
  assert.deepEqual(result, { total: 1, checked: 1, repaired: 0, failed: 1 })
})

test('retry skips entries removed or repaired while waiting', async () => {
  for (const current of [null, { ...record, ...metadata }]) {
    let attempts = 0
    const result = await repairHistory({
      records: [record], signal: new AbortController().signal, onProgress: () => {},
      getRecord: () => current,
      fetchMetadata: async () => { attempts++; throw new Error('Temporary failure') },
      saveMetadata: () => assert.fail('Already repaired or removed entry was saved')
    })
    assert.equal(attempts, 1)
    assert.deepEqual(result, { total: 1, checked: 1, repaired: 0, failed: 0 })
  }
})

test('YouTube bot checks pause the batch before requesting more history entries', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...record, videoId: `abcdefghi${String(i).padStart(2, '0')}` }))
  let cooledDown = false
  const requests = []
  const waits = []
  const result = await repairHistory({
    records: rows, signal: new AbortController().signal, onProgress: () => {},
    getRecord: id => rows.find(row => row.videoId === id),
    wait: async milliseconds => {
      waits.push(milliseconds)
      if (milliseconds >= 30000) {
        assert.equal(requests.length, 4)
        cooledDown = true
      }
    },
    fetchMetadata: async id => {
      requests.push(id)
      if (!cooledDown) return parseHistoryRepairPlayer({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }, id)
      return metadata
    },
    saveMetadata: async patches => ({ repaired: patches.length, failed: 0 })
  })
  assert.equal(waits[0], 30000)
  assert.deepEqual(result, { total: 12, checked: 12, repaired: 12, failed: 0 })
  assert.equal(requests.length, 16)
})

test('persistent YouTube bot checks stop after bounded cooldowns without exhausting the history', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...record, videoId: `abcdefghi${String(i).padStart(2, '0')}` }))
  const waits = []
  const progress = []
  let requests = 0
  await assert.rejects(repairHistory({
    records: rows, signal: new AbortController().signal,
    getRecord: id => rows.find(row => row.videoId === id),
    onProgress: value => progress.push(value),
    wait: async milliseconds => waits.push(milliseconds),
    fetchMetadata: async id => {
      requests++
      return parseHistoryRepairPlayer({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }, id)
    },
    saveMetadata: () => assert.fail('Bot check supplied no metadata')
  }), /not a bot/)
  assert.equal(requests, 6)
  assert.deepEqual(waits, [30000, 60000])
  assert.deepEqual(progress.at(-1), { total: 12, checked: 4, repaired: 0, failed: 4 })
})


test('untouched entries retain their retries after both bot cooldowns', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...record, videoId: `abcdefghij${i}` }))
  const attempts = new Map()
  let cooldowns = 0
  const result = await repairHistory({
    records: rows, signal: new AbortController().signal, onProgress: () => {},
    getRecord: id => rows.find(row => row.videoId === id),
    wait: async milliseconds => { if (milliseconds >= 30000) cooldowns++ },
    fetchMetadata: async id => {
      attempts.set(id, (attempts.get(id) ?? 0) + 1)
      if (cooldowns < 2) return parseHistoryRepairPlayer({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }, id)
      if (id === rows[4].videoId && attempts.get(id) < 3) throw new Error('Temporary failure')
      return metadata
    },
    saveMetadata: async patches => ({ repaired: patches.length, failed: 0 })
  })
  assert.equal(attempts.get(rows[4].videoId), 3)
  assert.deepEqual(result, { total: 5, checked: 5, repaired: 5, failed: 0 })
})


for (const failure of ['unavailable', 'malformed', 400, 403, 404, 429, 503, 'network']) {
  test(`classifies ${failure} metadata failures before retrying`, async () => {
    let attempts = 0
    const waits = []
    const retryable = [429, 503, 'network'].includes(failure)
    const result = await repairHistory({
      records: [record], signal: new AbortController().signal, onProgress: () => {},
      getRecord: () => record,
      wait: async milliseconds => waits.push(milliseconds),
      fetchMetadata: async () => {
        attempts++
        if (attempts > 1) return metadata
        if (failure === 'unavailable') return parseHistoryRepairPlayer({ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } }, record.videoId)
        if (failure === 'malformed') throw new SyntaxError('Invalid JSON')
        if (failure === 'network') throw new TypeError('Failed to fetch')
        throw Object.assign(new Error('Request failed'), { status_code: failure })
      },
      saveMetadata: async patches => ({ repaired: patches.length, failed: 0 })
    })
    assert.equal(attempts, retryable ? 2 : 1)
    assert.deepEqual(result, { total: 1, checked: 1, repaired: retryable ? 1 : 0, failed: retryable ? 0 : 1 })
    if (failure === 429) assert.deepEqual(waits, [30000])
  })
}

test('yt-dlp history metadata repairs fields without overwriting watch state', async () => {
  const { parseHistoryRepairYtDlp } = await import('../../src/historyRepair.js')
  const parsed = parseHistoryRepairYtDlp({
    id: record.videoId, title: 'Recovered title', channel: 'Channel', channel_id: 'channel',
    duration: 120, upload_date: '20250920', live_status: 'was_live'
  }, record.videoId)
  assert.equal(parsed.published, Date.parse('2025-09-20'))
  assert.equal(parsed.authorId, 'channel')
  assert.deepEqual(historyRepairPatch(record, parsed), { videoId: record.videoId, lengthSeconds: 120, isLive: false, liveNow: false, isUpcoming: false })
  assert.throws(() => parseHistoryRepairYtDlp({ id: 'wrong' }, record.videoId))
  assert.equal(parseHistoryRepairYtDlp({ id: record.videoId, timestamp: 123, live_status: 'is_upcoming' }, record.videoId).isUpcoming, true)
  assert.equal(parseHistoryRepairYtDlp({ id: record.videoId, timestamp: 123 }, record.videoId).published, 123000)
})

test('yt-dlp rate limits pause repair before retrying', async () => {
  const { parseHistoryRepairYtDlp } = await import('../../src/historyRepair.js')
  const waits = []
  let calls = 0
  const result = await repairHistory({
    records: [record], getRecord: () => record, signal: new AbortController().signal,
    onProgress: () => {}, wait: async delay => waits.push(delay),
    fetchMetadata: async () => ++calls === 1 ? parseHistoryRepairYtDlp({ error: 'rate-limit' }, record.videoId) : metadata,
    saveMetadata: async () => ({ repaired: 1, failed: 0 })
  })
  assert.equal(result.repaired, 1)
  assert.equal(result.failed, 0)
  assert.ok(waits.includes(30000))
})

test('yt-dlp errors preserve rate limits without exposing native error details', async () => {
  const { historyRepairYtDlpError } = await import('../../src/historyRepair.js')
  for (const message of ['HTTP Error 429', 'Too Many Requests', "Sign in to confirm you’re not a bot"]) {
    assert.deepEqual(historyRepairYtDlpError(message), { error: 'rate-limit' })
  }
  assert.deepEqual(historyRepairYtDlpError('Cannot read /private/cookies.txt'), { error: 'History metadata unavailable' })
  assert.deepEqual(historyRepairYtDlpError(undefined), { error: 'History metadata unavailable' })
})
