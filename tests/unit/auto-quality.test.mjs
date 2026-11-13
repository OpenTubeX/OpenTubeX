import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAutoQualityFallback,
  playbackEngineSupportsAutoQuality,
  streamsSupportAutoQuality
} from '../../src/renderer/helpers/player/autoQuality.js'

test.afterEach(() => {
  delete process.env.SUPPORTS_LOCAL_API
})

test('auto quality is unavailable for SABR streams', () => {
  // ABR quality switches are broken with SABR, see FreeTube#8906
  assert.equal(streamsSupportAutoQuality('dash', true), false)
  assert.equal(streamsSupportAutoQuality('audio', true), false)
})

test('only the built-in stream extraction method loses auto quality, and only with SABR only', () => {
  process.env.SUPPORTS_LOCAL_API = true

  assert.equal(playbackEngineSupportsAutoQuality('yt-dlp', 'sabr'), true)
  assert.equal(playbackEngineSupportsAutoQuality('built-in', 'auto'), true)
  assert.equal(playbackEngineSupportsAutoQuality('built-in', 'sabr'), false)
})

test('builds without the local API always support auto quality', () => {
  // those never use SABR, as they get their streams from Invidious
  assert.equal(playbackEngineSupportsAutoQuality('built-in', 'sabr'), true)
})

test('the fallback for auto fits the screen in physical pixels, up to 1080p', () => {
  // A portrait phone with a 1080 x 2400 pixel display
  assert.equal(getAutoQualityFallback({ width: 412, height: 915 }, 2.625), '1080')
  // A 1366 x 768 laptop
  assert.equal(getAutoQualityFallback({ width: 1366, height: 768 }, 1), '720')
  // A 1080p display at 95% UI Scale, after dividing out Electron's zoom factor
  assert.equal(getAutoQualityFallback({ width: 1920, height: 1080 }, 0.949999988079071 / 0.95), '1080')
  // A 4K display, which a fixed quality shouldn't saturate the connection for
  assert.equal(getAutoQualityFallback({ width: 1920, height: 1080 }, 2), '1080')
})
