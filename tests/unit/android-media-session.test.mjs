import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'

import { createAndroidMediaSessionState } from '../../src/renderer/helpers/androidMediaSession.js'

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

test('media updates throttle successful ticks and retry rejected requests', async () => {
  const capacitor = globalThis.Capacitor
  const previousHeaders = capacitor.PluginHeaders
  const previousNativePromise = capacitor.nativePromise
  const previousEnvironment = process.env.IS_CAPACITOR
  const previousError = console.error
  const previousPerformance = globalThis.performance
  const calls = []
  let time = 1000
  capacitor.PluginHeaders = [{ name: 'AndroidMediaSession', methods: [
    { name: 'update', rtype: 'promise' }, { name: 'clear', rtype: 'promise' }
  ] }]
  capacitor.nativePromise = (plugin, method, options) => {
    calls.push({ plugin, method, options })
    return calls.length === 1 ? Promise.reject(new Error('service unavailable')) : Promise.resolve()
  }
  process.env.IS_CAPACITOR = '1'
  console.error = () => {}
  globalThis.performance = { now: () => time }
  try {
    const { updateAndroidMediaSession } = await import('../../src/renderer/helpers/androidMediaSession.js?retry-test')
    const state = {
      playbackState: 'playing',
      positionState: { duration: 120, position: 10, playbackRate: 1 }
    }
    updateAndroidMediaSession(state)
    await setImmediate()
    time = 1250
    updateAndroidMediaSession({ ...state, positionState: { ...state.positionState, position: 10.25 } })
    await setImmediate()
    assert.equal(calls.length, 2)

    time = 1500
    updateAndroidMediaSession({ ...state, positionState: { ...state.positionState, position: 10.5 } })
    await setImmediate()
    assert.equal(calls.length, 2)

    time = 2250
    updateAndroidMediaSession({ ...state, positionState: { ...state.positionState, position: 11.5 } })
    await setImmediate()
    assert.equal(calls.length, 3)

    time = 2300
    updateAndroidMediaSession({ ...state, metadata: { title: 'Updated' } })
    await setImmediate()
    assert.equal(calls.length, 4)

    time = 2350
    updateAndroidMediaSession({ ...state, playbackState: 'none' })
    await setImmediate()
    assert.deepEqual(calls.map(call => call.method), ['update', 'update', 'update', 'update', 'clear'])
  } finally {
    capacitor.PluginHeaders = previousHeaders
    capacitor.nativePromise = previousNativePromise
    if (previousEnvironment === undefined) delete process.env.IS_CAPACITOR
    else process.env.IS_CAPACITOR = previousEnvironment
    console.error = previousError
    globalThis.performance = previousPerformance
  }
})
