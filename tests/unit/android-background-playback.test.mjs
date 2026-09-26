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

test('iOS backgrounding preserves the video source used by Picture in Picture', async () => {
  const { readFile } = await import('node:fs/promises')
  const { default: vm } = await import('node:vm')
  const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const method = source.match(/updateAndroidBackgroundPlaybackFormat\(\) \{[\s\S]*?\n    \},/)[0]
  for (const ios of [true, false]) {
    const watch = {
      $refs: { player: { isNativePlayback: () => false, isPaused: () => false } },
      $store: { getters: { getContinuePlaybackWhenScreenIsLocked: true } },
      activeFormat: 'dash', audioFormatAvailable: true, androidBackgroundRestoreFormat: null,
    }
    vm.runInNewContext(`Object.assign(watch, {${method}}); watch.updateAndroidBackgroundPlaybackFormat()`, {
      watch, process: { env: { IS_CAPACITOR: true, IS_IOS: ios } },
      isAppHidden: () => true, resolveAndroidBackgroundPlaybackFormat,
    })
    assert.equal(watch.activeFormat, ios ? 'dash' : 'audio')
    assert.equal(watch.androidBackgroundRestoreFormat, ios ? null : 'dash')
  }
})
