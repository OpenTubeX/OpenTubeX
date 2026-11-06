import assert from 'node:assert/strict'
import test from 'node:test'

import {
  playbackEngineSupportsAutoQuality,
  streamsSupportAutoQuality
} from '../../src/renderer/helpers/player/autoQuality.js'

test.afterEach(() => {
  delete process.env.SUPPORTS_LOCAL_API
})

test('auto quality is available for streams that do not use SABR', () => {
  assert.equal(streamsSupportAutoQuality('dash', false), true)
  assert.equal(streamsSupportAutoQuality('audio', false), true)
})

test('auto quality is unavailable for SABR streams', () => {
  // ABR quality switches are broken with SABR, see FreeTube#8906
  assert.equal(streamsSupportAutoQuality('dash', true), false)
  assert.equal(streamsSupportAutoQuality('audio', true), false)
})

test('the legacy formats never use auto quality', () => {
  // they are single progressive files with their own quality selection
  assert.equal(streamsSupportAutoQuality('legacy', false), false)
  assert.equal(streamsSupportAutoQuality('legacy', true), false)
})

test('only the built-in stream extraction method loses auto quality', () => {
  process.env.SUPPORTS_LOCAL_API = true

  assert.equal(playbackEngineSupportsAutoQuality('yt-dlp'), true)
  assert.equal(playbackEngineSupportsAutoQuality('built-in'), false)
})

test('builds without the local API always support auto quality', () => {
  // those never use SABR, as they get their streams from Invidious
  assert.equal(playbackEngineSupportsAutoQuality('built-in'), true)
})
