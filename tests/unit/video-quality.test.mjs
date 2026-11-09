import assert from 'node:assert/strict'
import test from 'node:test'

import { getDashQualityFromDimensions } from '../../src/renderer/helpers/player/videoQuality.js'

test('uses the shorter dimension for standard landscape and portrait streams', () => {
  assert.equal(getDashQualityFromDimensions(1920, 1080), 1080)
  assert.equal(getDashQualityFromDimensions(1080, 1920), 1080)
})

test('uses the 16:9-equivalent resolution for ultrawide streams', () => {
  assert.equal(getDashQualityFromDimensions(2560, 1080), 1440)
  assert.equal(getDashQualityFromDimensions(1080, 2560), 1440)
})
