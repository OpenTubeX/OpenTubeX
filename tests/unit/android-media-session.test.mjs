import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAndroidMediaSessionState,
  shouldSendAndroidMediaSessionState,
  shouldPauseAndroidPlaybackOnAppStateChange,
} from '../../src/renderer/helpers/androidMediaSession.js'

test('builds a bounded Android media state for the presented player', () => {
  assert.deepEqual(createAndroidMediaSessionState({
    playbackState: 'playing',
    metadata: {
      title: 'Video title',
      artist: 'Channel name',
      artwork: [{ src: 'https://example.com/thumb.jpg' }]
    },
    positionState: { duration: 120, position: 25, playbackRate: 1.5 },
    actionHandlers: {
      play: () => {},
      pause: () => {},
      seekbackward: () => {},
      nexttrack: null,
      unsupported: () => {}
    }
  }), {
    playbackState: 'playing',
    title: 'Video title',
    artist: 'Channel name',
    artwork: 'https://example.com/thumb.jpg',
    duration: 120,
    position: 25,
    playbackRate: 1.5,
    actions: ['play', 'pause', 'seekbackward']
  })
})

test('only pauses a backgrounded Android player after the user opts out', () => {
  assert.equal(shouldPauseAndroidPlaybackOnAppStateChange(false, true), false)
  assert.equal(shouldPauseAndroidPlaybackOnAppStateChange(false, false), true)
  assert.equal(shouldPauseAndroidPlaybackOnAppStateChange(true, false), false)
})

test('keeps the native source owner on renderer notification updates', () => {
  const payload = createAndroidMediaSessionState({ playbackState: 'playing', nativeOwner: 'android-source-1' })
  assert.equal(payload.nativeOwner, 'android-source-1')
  assert.equal(Object.hasOwn(createAndroidMediaSessionState(), 'nativeOwner'), false)
})

test('native position ticks do not restart the media service four times a second', () => {
  const previous = createAndroidMediaSessionState({
    playbackState: 'playing', nativeOwner: 'android-source-1',
    metadata: { title: 'Video' },
    positionState: { duration: 120, position: 10, playbackRate: 1 }
  })
  const next = { ...previous, position: 10.25 }
  assert.equal(shouldSendAndroidMediaSessionState(previous, next, 250), false)
  assert.equal(shouldSendAndroidMediaSessionState(previous, next, 1000), true)
  assert.equal(shouldSendAndroidMediaSessionState(previous, { ...next, title: 'New title' }, 250), true)
  assert.equal(shouldSendAndroidMediaSessionState(previous, { ...next, playbackState: 'paused' }, 250), true)
  assert.equal(shouldSendAndroidMediaSessionState(previous, { ...next, nativeOwner: 'android-source-2' }, 250), true)
  assert.equal(shouldSendAndroidMediaSessionState(null, next, 0), true)
  assert.equal(shouldSendAndroidMediaSessionState({ ...previous, nativeOwner: undefined }, next, 250), true)
  assert.equal(shouldSendAndroidMediaSessionState(previous, { ...next, nativeOwner: undefined }, 250), true)
})
