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

for (const segmentDurationMs of [5040, 4960]) {
  test(`live SABR segments keep the media times of ${segmentDurationMs} ms segments`, t => {
    const { scheme, stream } = load(t)

    // After 100 segments, five-second times would be four seconds off. The
    // buffered ranges map media times to segments, and requests ask for times.
    for (let sequenceNumber = 1001; sequenceNumber <= 1100; sequenceNumber++) {
      t.mock.timers.tick(segmentDurationMs)
      protocol.publishSabrLiveHead(scheme, head(sequenceNumber, Date.now(), segmentDurationMs))
    }
    const { timeMs } = head(1100, 0, segmentDurationMs)
    const reference = stream.segmentIndex.get(stream.segmentIndex.find(timeMs / 1000 + 2.5))
    assert.match(reference.getUris()[0], /&sq=1100$/)
    assert.ok(Math.abs(reference.startTime - timeMs / 1000) < 0.1, `sq 1100 starts at ${reference.startTime}`)
    const requestTimeMs = Number(new URL(reference.getUris()[0]).searchParams.get('startTimeMs'))
    assert.ok(requestTimeMs > timeMs && requestTimeMs < timeMs + segmentDurationMs, `${requestTimeMs} is outside sq 1100`)
  })
}

test('live SABR captions land on the media timeline of their segment', async () => {
  const { SabrLiveCaptionParser } = await import('../../src/renderer/helpers/player/SabrLiveCaptionParser.js')
  const box = (type, payload) => {
    const bytes = new Uint8Array(8 + payload.length)
    new DataView(bytes.buffer).setUint32(0, bytes.length)
    bytes.set(new TextEncoder().encode(type), 4)
    bytes.set(payload, 8)
    return bytes
  }
  // A self-initializing segment as SABR sends it, with one WebVTT document as its sample.
  // MPEGTS is 200240.5 seconds at 90 kHz, beyond the 33-bit range that HLS wraps at.
  const document = 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:18021645000\nKind: captions\n\n' +
    '00:00:00.000 --> 00:00:00.300\nfirst placeholder\n\n00:00:00.350 --> 00:00:02.100\nsecond placeholder\n'
  const segment = new Uint8Array([
    ...box('ftyp', new Uint8Array(16)),
    ...box('moov', new Uint8Array(0)),
    ...box('moof', new Uint8Array(0)),
    ...box('mdat', new TextEncoder().encode(document)),
  ])

  const parser = new SabrLiveCaptionParser()
  parser.parseInit(segment)
  const cues = parser.parseMedia(segment, { periodStart: 0, segmentStart: 200240, segmentEnd: 200245, vttOffset: 0 }, null, [])

  assert.deepEqual(cues.map(cue => [cue.startTime, cue.endTime, cue.payload]), [
    [200240.5, 200240.8, 'first placeholder'],
    [200240.85, 200242.6, 'second placeholder'],
  ])

  // Segments without captions have an empty sample
  const silentSegment = new Uint8Array([...box('moof', new Uint8Array(0)), ...box('mdat', new Uint8Array(0))])
  assert.deepEqual(parser.parseMedia(silentSegment, { periodStart: 0, segmentStart: 200245, segmentEnd: 200250, vttOffset: 0 }, null, []), [])
  // The transport skips a segment that keeps backing off with an empty response
  assert.deepEqual(parser.parseMedia(new Uint8Array(0), { periodStart: 0, segmentStart: 200250, segmentEnd: 200255, vttOffset: 0 }, null, []), [])
})

for (const segmentDurationMs of [4920, 5040]) {
  test(`catching up after a seek into older ${segmentDurationMs} ms live SABR segments reaches the head`, t => {
    const { liveWindow, scheme, stream: video } = load(t)
    const audio = { mimeType: 'audio/mp4', codecs: 'mp4a.40.2' }
    liveWindow.openSegmentIndex(audio, `${scheme}:audio?formatId=140-0-`)

    // The window places sq 900 at 4500s, but segments are shorter or longer than five seconds
    const realStartMs = sequenceNumber => 5_000_000 + (sequenceNumber - 1000) * segmentDurationMs
    const realSequenceNumber = timeMs => 1000 + Math.floor((timeMs - 5_000_000) / segmentDurationMs)

    // Like Shaka, fetch the segments in order from a seek, and like the
    // transport, start with the segment SABR has for the requested time and
    // continue from the one delivered
    const players = [video, audio].map(stream => ({ stream, position: stream.segmentIndex.find(4510), delivered: [] }))
    const request = player => {
      const reference = player.stream.segmentIndex.get(player.position++)
      if (!reference) return null
      const params = new URL(reference.getUris()[0]).searchParams
      const windowSequenceNumber = Number(params.get('sq'))
      const sequenceNumber = player.previous?.windowSequenceNumber === windowSequenceNumber - 1
        ? player.previous.sequenceNumber + 1
        : realSequenceNumber(Number(params.get('startTimeMs')))
      player.previous = { windowSequenceNumber, sequenceNumber }
      player.delivered.push(sequenceNumber)
      const windowGeneration = Number(params.get('windowGeneration'))
      return { windowSequenceNumber, windowGeneration, sequenceNumber, startMs: realStartMs(sequenceNumber) }
    }

    // Audio and video both ask before either segment arrives
    for (const segment of players.map(request)) protocol.publishSabrLiveSegment(scheme, segment)
    for (const player of players) {
      for (let segment; (segment = request(player));) protocol.publishSabrLiveSegment(scheme, segment)
    }

    // SABR answers the seek with the segment at the middle of the window's segment
    const first = realSequenceNumber(4512_500)
    const expected = Array.from({ length: 1001 - first }, (_, index) => first + index)
    for (const { delivered } of players) assert.deepEqual(delivered, expected)
    const last = video.segmentIndex.get(video.segmentIndex.find(5_000_000 / 1000 + 1))
    assert.match(last.getUris()[0], /&sq=1000$/)
    assert.ok(Math.abs(last.startTime - 5000) < 0.1, `sq 1000 starts at ${last.startTime}`)

    // A request from before the window was re-timed numbered its segments the
    // old way, so its segment leaves the window as it is, even one that starts elsewhere
    const placed = () => [...video.segmentIndex].map(reference => [reference.startTime, reference.getUris()[0]])
    const before = placed()
    protocol.publishSabrLiveSegment(scheme, { windowSequenceNumber: 995, windowGeneration: 0, sequenceNumber: 990, startMs: realStartMs(990) + 3000 })
    assert.deepEqual(placed(), before)
  })
}
