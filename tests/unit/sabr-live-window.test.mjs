import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as protocol from '../../src/renderer/helpers/player/sabrProtocol.js'

// shaka-player's compiled build reads `self` while loading, which Node lacks
globalThis.self ??= globalThis
const { default: shaka } = await import('shaka-player')

const source = (await readFile(new URL('../../src/renderer/helpers/player/SabrManifestParser.js', import.meta.url), 'utf8'))
  .replace(/^import [\s\S]*? from ['"][^'"]+['"]\n/gm, '').replaceAll('export const ', 'const ')

/** Five-second segments: 1000 is the newest, and a 500-second window is seekable. */
function head(sequenceNumber, receivedAtMs = Date.now(), segmentDurationMs = 5000) {
  return {
    sequenceNumber,
    timeMs: 5_000_000 + (sequenceNumber - 1000) * segmentDurationMs,
    minSeekableTimeMs: (sequenceNumber - 100) * 5000,
    maxSeekableTimeMs: (sequenceNumber - 4) * 5000,
    receivedAtMs,
  }
}

function load(t) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 })
  const SabrLiveWindow = vm.runInNewContext(`${source}\nSabrLiveWindow`, {
    shaka, ...protocol, process: { env: {} }, Date, setInterval, clearInterval,
  })
  const scheme = `sabr-live-test-${Math.random()}`
  const liveWindow = new SabrLiveWindow(head(1000), 5)
  const headRefreshes = []
  liveWindow.start(scheme, async () => { headRefreshes.push(Date.now()) })
  t.after(() => liveWindow.stop())

  const stream = { mimeType: 'video/webm', codecs: 'vp9' }
  liveWindow.openSegmentIndex(stream, `${scheme}:video?formatId=303-0-&resolution=1080`)
  return { liveWindow, scheme, stream, headRefreshes }
}

/**
 * @param {shaka.media.SegmentIndex} segmentIndex
 */
function sequenceNumbers(segmentIndex) {
  const numbers = []
  for (const reference of segmentIndex) {
    numbers.push(Number(new URL(reference.getUris()[0]).searchParams.get('sq')))
  }
  return [numbers[0], numbers.at(-1)]
}

test('a live SABR window spans the seekable segments and starts where YouTube does', t => {
  const { liveWindow, stream } = load(t)

  assert.deepEqual(sequenceNumbers(stream.segmentIndex), [900, 1000])
  assert.equal(liveWindow.presentationTimeline.isLive(), true)
  // YouTube's player starts at the maximum seekable time
  assert.equal(liveWindow.presentationTimeline.getSeekRangeEnd(), 4980)
  assert.equal(liveWindow.presentationTimeline.getSeekRangeStart(), 4500)

  // SABR returns the segment containing the requested time
  const reference = stream.segmentIndex.get(stream.segmentIndex.find(4997))
  assert.equal(reference.startTime, 4995)
  assert.match(reference.getUris()[0], /&startTimeMs=4997500&sq=999$/)
})

test('a live SABR window follows reported heads and expects few segments without them', t => {
  const { liveWindow, scheme, stream, headRefreshes } = load(t)

  t.mock.timers.tick(10_000)
  protocol.publishSabrLiveHead(scheme, head(1002))
  assert.deepEqual(sequenceNumbers(stream.segmentIndex), [902, 1002])
  assert.equal(liveWindow.presentationTimeline.getSeekRangeEnd(), 4990)

  // A head reported late by another request does not move the window back
  protocol.publishSabrLiveHead(scheme, head(1001))
  assert.deepEqual(sequenceNumbers(stream.segmentIndex), [902, 1002])

  // A paused player reports no heads, so the window follows the clock, but
  // only a few segments past the last reported head, then asks for the head
  assert.equal(headRefreshes.length, 0)
  t.mock.timers.tick(20_000)
  assert.deepEqual(sequenceNumbers(stream.segmentIndex), [902, 1005])
  assert.equal(headRefreshes.length, 1)
  protocol.publishSabrLiveHead(scheme, head(1006))
  t.mock.timers.tick(1000)
  assert.deepEqual(sequenceNumbers(stream.segmentIndex), [906, 1006])
  assert.equal(headRefreshes.length, 1)
})

test('live SABR requests stay inside their segment when segments outlast the target duration', t => {
  const { scheme, stream } = load(t)

  // Each segment lasts 5.04 seconds, so after 100 segments the contiguous
  // five-second times are four seconds early
  for (let sequenceNumber = 1001; sequenceNumber <= 1100; sequenceNumber++) {
    t.mock.timers.tick(5040)
    protocol.publishSabrLiveHead(scheme, head(sequenceNumber, Date.now(), 5040))
  }
  const reference = stream.segmentIndex.get(stream.segmentIndex.find(5502))
  assert.match(reference.getUris()[0], /&sq=1100$/)
  const requestTimeMs = Number(new URL(reference.getUris()[0]).searchParams.get('startTimeMs'))
  const { timeMs } = head(1100, 0, 5040)
  assert.ok(requestTimeMs > timeMs && requestTimeMs < timeMs + 5040, `${requestTimeMs} is outside sq 1100`)
})
