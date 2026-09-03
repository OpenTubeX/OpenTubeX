import assert from 'node:assert/strict'
import test from 'node:test'

import { tabMediaCoordinator } from '../../src/renderer/tabs/TabMediaCoordinator.js'

test('keeps media controls associated with a paused PiP video', (t) => {
  const handlers = new Map()
  const played = []
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler (action, handler) {
          handlers.set(action, handler)
        }
      }
    }
  })
  t.after(() => {
    tabMediaCoordinator.unregister('pip-tab')
    tabMediaCoordinator.unregister('active-tab')
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    } else {
      delete globalThis.navigator
    }
  })

  tabMediaCoordinator.setActionHandlers('pip-tab', 'player', {
    play: () => played.push('pip-tab')
  })
  tabMediaCoordinator.setMetadata('pip-tab', { title: 'PiP video' })
  tabMediaCoordinator.setPlaybackState('pip-tab', 'playing')

  tabMediaCoordinator.setActionHandlers('active-tab', 'player', {
    play: () => played.push('active-tab')
  })
  tabMediaCoordinator.setMetadata('active-tab', { title: 'Active video' })
  tabMediaCoordinator.setPresented('active-tab')

  tabMediaCoordinator.setPictureInPicture('pip-tab', true)
  tabMediaCoordinator.setPlaybackState('pip-tab', 'paused')
  handlers.get('play')()

  assert.deepEqual(played, ['pip-tab'])

  tabMediaCoordinator.setPictureInPicture('pip-tab', false)
  handlers.get('play')()

  assert.deepEqual(played, ['pip-tab', 'active-tab'])

  tabMediaCoordinator.unregister('pip-tab')
  tabMediaCoordinator.setPictureInPicture('pip-tab', true)
  handlers.get('play')()

  assert.deepEqual(played, ['pip-tab', 'active-tab', 'active-tab'])
})

test('clears the skip actions a source no longer offers', (t) => {
  const handlers = new Map()
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler (action, handler) {
          handlers.set(action, handler)
        }
      }
    }
  })
  t.after(() => {
    tabMediaCoordinator.unregister('skip-tab')
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    } else {
      delete globalThis.navigator
    }
  })

  tabMediaCoordinator.setPresented('skip-tab')
  tabMediaCoordinator.setPlaybackState('skip-tab', 'playing')
  tabMediaCoordinator.setActionHandlers('skip-tab', 'playlist', {
    previoustrack: () => {},
    nexttrack: () => {}
  })

  assert.equal(typeof handlers.get('previoustrack'), 'function')
  assert.equal(typeof handlers.get('nexttrack'), 'function')

  // The watch view keeps the source registered and passes null for the
  // directions that have nothing to skip to
  tabMediaCoordinator.setActionHandlers('skip-tab', 'playlist', {
    previoustrack: null,
    nexttrack: () => {}
  })

  assert.equal(handlers.get('previoustrack'), null)
  assert.equal(typeof handlers.get('nexttrack'), 'function')

  tabMediaCoordinator.setActionHandlers('skip-tab', 'playlist', {})

  assert.equal(handlers.get('nexttrack'), null)
})

test('dispatches native menu actions to the media session owner', (t) => {
  const dispatched = []
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler () {}
      }
    }
  })
  t.after(() => {
    tabMediaCoordinator.unregister('dock-tab')
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    } else {
      delete globalThis.navigator
    }
  })

  tabMediaCoordinator.setPresented('dock-tab')
  tabMediaCoordinator.setActionHandlers('dock-tab', 'player', {
    play: () => dispatched.push('play'),
    pause: () => dispatched.push('pause')
  })
  tabMediaCoordinator.setActionHandlers('dock-tab', 'playlist', {
    previoustrack: () => dispatched.push('previous'),
    nexttrack: () => dispatched.push('next')
  })
  tabMediaCoordinator.setPlaybackState('dock-tab', 'playing')

  tabMediaCoordinator.dispatchAction('play')
  tabMediaCoordinator.dispatchAction('pause')
  tabMediaCoordinator.dispatchAction('previoustrack')
  tabMediaCoordinator.dispatchAction('nexttrack')
  tabMediaCoordinator.dispatchAction('unsupported')

  assert.deepEqual(dispatched, ['play', 'pause', 'previous', 'next'])
})

test('passes native seek details to the presented player', (t) => {
  const dispatched = []
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaSession: { setActionHandler () {} } }
  })
  t.after(() => {
    tabMediaCoordinator.unregister('seek-tab')
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete globalThis.navigator
  })

  tabMediaCoordinator.setPresented('seek-tab')
  tabMediaCoordinator.setMetadata('seek-tab', { title: 'Seek video' })
  tabMediaCoordinator.setActionHandlers('seek-tab', 'player', {
    seekto: details => dispatched.push(details.seekTime)
  })
  tabMediaCoordinator.dispatchAction('seekto', { seekTime: 42 })

  assert.deepEqual(dispatched, [42])
})

test('Capacitor never routes media actions to a background tab', (t) => {
  const originalCapacitor = process.env.IS_CAPACITOR
  process.env.IS_CAPACITOR = 'true'
  let plays = 0
  t.after(() => {
    tabMediaCoordinator.unregister('background-media-tab')
    tabMediaCoordinator.unregister('presented-plain-tab')
    if (originalCapacitor === undefined) delete process.env.IS_CAPACITOR
    else process.env.IS_CAPACITOR = originalCapacitor
  })

  tabMediaCoordinator.setPresented('background-media-tab')
  tabMediaCoordinator.setActionHandlers('background-media-tab', 'player', {
    play: () => { plays++ }
  })
  tabMediaCoordinator.setPlaybackState('background-media-tab', 'playing')
  tabMediaCoordinator.setPresented('presented-plain-tab')
  tabMediaCoordinator.dispatchAction('play')

  assert.equal(plays, 0)
})

test('pauses every playing tab when Android background playback is disabled', (t) => {
  const paused = []
  t.after(() => {
    tabMediaCoordinator.unregister('first-android-tab')
    tabMediaCoordinator.unregister('second-android-tab')
  })

  for (const tabId of ['first-android-tab', 'second-android-tab']) {
    tabMediaCoordinator.setActionHandlers(tabId, 'player', {
      pause: () => paused.push(tabId)
    })
    tabMediaCoordinator.setPlaybackState(tabId, 'playing')
  }
  tabMediaCoordinator.pauseAll()

  assert.deepEqual(paused, ['first-android-tab', 'second-android-tab'])
})

test('reconciles playing state from the presented video clock', (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const mediaSession = {
    playbackState: 'none',
    setActionHandler () {},
    setPositionState () {}
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaSession }
  })
  t.after(() => {
    tabMediaCoordinator.unregister('clock-tab')
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete globalThis.navigator
  })

  tabMediaCoordinator.setPresented('clock-tab')
  tabMediaCoordinator.setMetadata('clock-tab', { title: 'Clock video' })
  tabMediaCoordinator.setPlaybackState('clock-tab', 'none')
  tabMediaCoordinator.setPositionState(
    'clock-tab',
    { duration: 120, position: 30, playbackRate: 1 },
    'playing'
  )

  assert.equal(mediaSession.playbackState, 'playing')
})

test('reports playback starts without treating owner reselection as a new start', (t) => {
  const states = []
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler () {}
      }
    }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ftElectron: {
        tabs: {
          setMediaSessionState: state => states.push(state)
        }
      }
    }
  })
  t.after(() => {
    tabMediaCoordinator.unregister('first-playing-tab')
    tabMediaCoordinator.unregister('second-playing-tab')
    for (const [property, descriptor] of [
      ['navigator', navigatorDescriptor],
      ['window', windowDescriptor]
    ]) {
      if (descriptor) {
        Object.defineProperty(globalThis, property, descriptor)
      } else {
        delete globalThis[property]
      }
    }
  })

  tabMediaCoordinator.setPresented('first-playing-tab')
  tabMediaCoordinator.setPlaybackState('first-playing-tab', 'playing')
  assert.equal(states.at(-1).playbackStarted, true)

  tabMediaCoordinator.setPlaybackState('second-playing-tab', 'playing')
  assert.equal(states.at(-1).playbackStarted, false)

  tabMediaCoordinator.setPresented('second-playing-tab')
  assert.equal(states.at(-1).playbackStarted, false)
})
