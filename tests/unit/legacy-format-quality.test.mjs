import assert from 'node:assert/strict'
import test from 'node:test'

import { findLegacyFormatForQuality } from '../../src/renderer/helpers/player/legacyFormats.js'

const LANDSCAPE_FORMATS = [
  { width: 640, height: 360, bitrate: 500_000 },
  { width: 426, height: 240, bitrate: 250_000 },
  { width: 256, height: 144, bitrate: 100_000 }
]

const PORTRAIT_FORMATS = [
  { width: 360, height: 640, bitrate: 500_000 },
  { width: 240, height: 426, bitrate: 250_000 }
]

test('an exactly matching legacy format is used', () => {
  const format = findLegacyFormatForQuality(LANDSCAPE_FORMATS, 240)

  assert.equal(format.height, 240)
})

test('the highest legacy format below the preferred quality is used', () => {
  // regression: an operator precedence bug made the filters match every format,
  // so the first one in the list was always used, no matter the preferred quality
  const format = findLegacyFormatForQuality(LANDSCAPE_FORMATS, 240)

  assert.equal(findLegacyFormatForQuality(LANDSCAPE_FORMATS, 1080).height, 360)
  assert.equal(format.height, 240)
  assert.equal(findLegacyFormatForQuality(LANDSCAPE_FORMATS, 200).height, 144)
})

test('the lowest legacy format is used when they are all above the preferred quality', () => {
  const format = findLegacyFormatForQuality(LANDSCAPE_FORMATS, 100)

  assert.equal(format.height, 144)
})

test('portrait videos are matched on their width', () => {
  assert.equal(findLegacyFormatForQuality(PORTRAIT_FORMATS, 240).width, 240)
  assert.equal(findLegacyFormatForQuality(PORTRAIT_FORMATS, 1080).width, 360)
})

test('the passed in formats are not reordered', () => {
  const formats = [...LANDSCAPE_FORMATS]

  findLegacyFormatForQuality(formats, 100)

  assert.deepEqual(formats, LANDSCAPE_FORMATS)
})
