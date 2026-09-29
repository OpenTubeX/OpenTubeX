import assert from 'node:assert/strict'
import test from 'node:test'
import { fillTsVideoGap } from '../../src/renderer/helpers/player/twitchTsVideoGap.js'

function box (type, payload) {
  const bytes = new Uint8Array(payload.length + 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  bytes.set(Buffer.from(type), 4)
  bytes.set(payload, 8)
  return bytes
}

function segment (durations) {
  const trun = new Uint8Array(12 + durations.length * 16)
  const view = new DataView(trun.buffer)
  view.setUint32(0, 0x01000f01)
  view.setUint32(4, durations.length)
  view.setUint32(8, 0)
  durations.forEach((duration, index) => view.setUint32(12 + index * 16, duration))
  return box('moof', box('traf', box('trun', trun)))
}

function sampleDurations (bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(28)
  return Array.from({ length: count }, (_, index) => view.getUint32(36 + index * 16))
}

test('fills a Twitch TS video hole by holding its final frame through the segment end', () => {
  const bytes = segment([90000, 90000, 90000])
  const result = fillTsVideoGap(bytes, 10)
  assert.deepEqual(sampleDurations(result), [90000, 90000, 720000])
})

test('leaves a complete Twitch TS segment unchanged', () => {
  const bytes = segment([90000, 90000, 90000])
  assert.equal(fillTsVideoGap(bytes, 3), bytes)
})
