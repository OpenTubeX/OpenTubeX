import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMeteredAutoQualityMaxPixels,
  limitQualityOnMeteredNetwork,
  networkMetered
} from '../../src/renderer/helpers/player/meteredNetworkQuality.js'

test.afterEach(() => {
  networkMetered.value = false
})

test('keeps the quality on unmetered networks', () => {
  assert.equal(limitQualityOnMeteredNetwork('1080', '480'), '1080')
  assert.equal(limitQualityOnMeteredNetwork('auto', '480'), 'auto')
})

test('lowers higher qualities on metered networks', () => {
  networkMetered.value = true
  assert.equal(limitQualityOnMeteredNetwork('1080', '480'), '480')
})

test('keeps auto quality adaptive on metered networks', () => {
  networkMetered.value = true
  assert.equal(limitQualityOnMeteredNetwork('auto', '480'), 'auto')
})

test('keeps qualities that are already within the limit', () => {
  networkMetered.value = true
  assert.equal(limitQualityOnMeteredNetwork('480', '480'), '480')
  assert.equal(limitQualityOnMeteredNetwork('360', '480'), '360')
})

test('keeps every quality without a limit', () => {
  networkMetered.value = true
  assert.equal(limitQualityOnMeteredNetwork('2160', 'none'), '2160')
  assert.equal(limitQualityOnMeteredNetwork('auto', 'none'), 'auto')
})

test('does not limit auto quality on unmetered networks or without a limit', () => {
  assert.equal(getMeteredAutoQualityMaxPixels('480'), Infinity)
  networkMetered.value = true
  assert.equal(getMeteredAutoQualityMaxPixels('none'), Infinity)
})

test('limits auto quality to the pixels of the limit in any orientation', () => {
  networkMetered.value = true
  const maxPixels = getMeteredAutoQualityMaxPixels('480')
  assert.ok(854 * 480 <= maxPixels)
  assert.ok(480 * 854 <= maxPixels)
  assert.ok(640 * 480 <= maxPixels)
  assert.ok(1280 * 720 > maxPixels)
})

test('allows the 16:9 resolution of every limit', () => {
  networkMetered.value = true
  for (const [width, height] of [[256, 144], [426, 240], [640, 360], [854, 480], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
    assert.ok(width * height <= getMeteredAutoQualityMaxPixels(String(height)), `${height}p`)
  }
})
