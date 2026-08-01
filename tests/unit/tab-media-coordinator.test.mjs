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
