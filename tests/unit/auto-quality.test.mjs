import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAutoQualityFallback,
  playbackEngineSupportsAutoQuality,
  streamsSupportAutoQuality
} from '../../src/renderer/helpers/player/autoQuality.js'

test.afterEach(() => {
  delete process.env.SUPPORTS_LOCAL_API
  delete process.env.IS_ELECTRON
  delete globalThis.window
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
  // A 4K display, which a fixed quality shouldn't saturate the connection for
  assert.equal(getAutoQualityFallback({ width: 1920, height: 1080 }, 2), '1080')
})

test('UI Scale does not change the fallback for auto', () => {
  // Electron's zoom factor is part of devicePixelRatio, but not of the screen size
  process.env.IS_ELECTRON = true
  globalThis.window = {
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 0.949999988079071,
    ftElectron: { getZoomFactor: () => 0.95 }
  }

  assert.equal(getAutoQualityFallback(), '1080')
})
