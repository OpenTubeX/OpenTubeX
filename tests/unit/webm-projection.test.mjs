import assert from 'node:assert/strict'
import test from 'node:test'

import { voidWebmProjection } from '../../src/renderer/helpers/player/webmProjection.js'

/**
 * @param {string} id hex
 * @param {number[]} data
 * @param {string} [size] hex, defaults to a 1-byte size
 */
function element(id, data, size) {
  return [...Buffer.from(id, 'hex'), ...(size ? Buffer.from(size, 'hex') : [0x80 | data.length]), ...data]
}

// Shaped like the Projection element in YouTube's VR VP9 streams: no pose angles
const projection = element('7670', [...element('7671', [1]), ...element('7672', Array(20).fill(0))])
const ebmlHeader = element('1a45dfa3', element('4282', [...Buffer.from('webm')]))
const video = element('e0', [...element('b0', [0x01, 0x00]), ...element('ba', [0x00, 0x90]), ...projection])
const tracks = element('1654ae6b', element('ae', [...element('d7', [1]), ...element('86', [...Buffer.from('V_VP9')]), ...video]))
const segmentData = [...element('1549a966', element('2ad7b1', [0x0f, 0x42, 0x40])), ...tracks]

/**
 * @param {string} segmentSize hex
 */
function initSegment(segmentSize) {
  return Uint8Array.from([...ebmlHeader, ...element('18538067', segmentData, segmentSize)])
}

test('voids the Projection element without changing the segment layout', () => {
  for (const segmentSize of ['01ffffffffffffff', `010000000000${segmentData.length.toString(16).padStart(4, '0')}`]) {
    const original = initSegment(segmentSize)
    const data = original.slice()
    assert.equal(voidWebmProjection(data.buffer), true)

    const offset = original.findIndex((byte, index) => byte === 0x76 && original[index + 1] === 0x70)
    const payloadSize = projection.length - 3
    assert.deepEqual([...data.subarray(offset, offset + 3)], [0xEC, 0x40, payloadSize])
    assert.deepEqual([...data.subarray(0, offset)], [...original.subarray(0, offset)])
    assert.deepEqual([...data.subarray(offset + 3)], [...original.subarray(offset + 3)])
  }
})

test('handles views and init segments truncated after the Tracks element', () => {
  const buffer = new Uint8Array(initSegment('0100000000100000').length + 8)
  buffer.set(initSegment('0100000000100000'), 4)
  const view = buffer.subarray(4, buffer.length - 4)
  assert.equal(voidWebmProjection(view), true)
  assert.equal(voidWebmProjection(view), false)
})

test('leaves rectangular WebM and other containers untouched', () => {
  const rectangular = Uint8Array.from([
    ...ebmlHeader,
    ...element('18538067', element('1654ae6b', element('ae', element('e0', element('b0', [0x01, 0x00])))), '01ffffffffffffff')
  ])
  const mp4 = Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from('ftypdash'), 0x76, 0x70, 0x9b])
  for (const data of [rectangular, mp4, new Uint8Array()]) {
    const copy = data.slice()
    assert.equal(voidWebmProjection(copy), false)
    assert.deepEqual(copy, data)
  }
})

test('reads 8-byte placeholder sizes of the Projection parents exactly', () => {
  /**
   * @param {number[]} data
   */
  const size8 = data => `01${data.length.toString(16).padStart(14, '0')}`

  // Padding the audio track covers every size modulo 16
  for (let padding = 0; padding < 16; padding++) {
    const audioData = [...element('d7', [1]), ...element('86', [...Buffer.from('A_OPUS')]), ...element('ec', Array(padding).fill(0))]
    const videoData = [...element('b0', [0x01, 0x00]), ...projection]
    const videoTrackData = [...element('d7', [2]), ...element('e0', videoData, size8(videoData))]
    const tracksData = [...element('ae', audioData, size8(audioData)), ...element('ae', videoTrackData, size8(videoTrackData))]
    const data = Uint8Array.from([
      ...ebmlHeader,
      ...element('18538067', element('1654ae6b', tracksData, size8(tracksData)), '01ffffffffffffff')
    ])
    assert.equal(voidWebmProjection(data), true, `padding ${padding}`)
  }
})
