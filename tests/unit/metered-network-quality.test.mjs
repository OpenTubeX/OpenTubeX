import assert from 'node:assert/strict'
import test from 'node:test'

import {
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

test('lowers higher and automatic qualities on metered networks', () => {
  networkMetered.value = true
  assert.equal(limitQualityOnMeteredNetwork('1080', '480'), '480')
  assert.equal(limitQualityOnMeteredNetwork('auto', '480'), '480')
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
