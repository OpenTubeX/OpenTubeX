import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAndroidBackgroundPlaybackFormat } from '../../src/renderer/helpers/player/androidBackgroundPlayback.js'

test('a playing Android video switches to audio while its surface is hidden', () => {
  assert.deepEqual(resolveAndroidBackgroundPlaybackFormat({
    hidden: true,
    continuePlayback: true,
    activeFormat: 'dash',
    audioFormatAvailable: true,
    paused: false,
  }), {
    activeFormat: 'audio',
    restoreFormat: 'dash',
  })
})

test('the selected video format returns when Android shows the surface again', () => {
  assert.deepEqual(resolveAndroidBackgroundPlaybackFormat({
    hidden: false,
    continuePlayback: true,
    activeFormat: 'audio',
    audioFormatAvailable: true,
    paused: false,
    restoreFormat: 'legacy',
  }), {
    activeFormat: 'legacy',
    restoreFormat: null,
  })
})

test('background format stays untouched when playback should not continue', () => {
  for (const input of [
    { continuePlayback: false, activeFormat: 'dash', audioFormatAvailable: true, paused: false },
    { continuePlayback: true, activeFormat: 'dash', audioFormatAvailable: false, paused: false },
    { continuePlayback: true, activeFormat: 'dash', audioFormatAvailable: true, paused: true },
    { continuePlayback: true, activeFormat: 'audio', audioFormatAvailable: true, paused: false },
  ]) {
    assert.equal(resolveAndroidBackgroundPlaybackFormat({ hidden: true, ...input }), null)
  }
})
