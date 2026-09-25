import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { createDockMediaSessionController, shouldAdvanceDockMediaSequence } from '../../src/main/dockMediaSession.js'

test('advances Dock media ownership only for newly owned playback', () => {
  assert.equal(shouldAdvanceDockMediaSequence('playing', true), true)
  assert.equal(shouldAdvanceDockMediaSequence('playing', false), false)
  assert.equal(shouldAdvanceDockMediaSequence('paused', true), false)
})

test('Dock media control follows the latest playing window, then focus and metadata', () => {
  let now = 0
  let changes = 0
  const sent = []
  const controller = createDockMediaSessionController({
    onChange: () => { changes++ },
    now: () => ++now,
    sendAction: (manager, action) => sent.push([manager.browserWindow.id, action]),
  })
  const manager = (id) => {
    const browserWindow = Object.assign(new EventEmitter(), {
      id,
      focused: false,
      destroyed: false,
      isFocused() { return this.focused },
      isDestroyed() { return this.destroyed },
    })
    return { browserWindow }
  }
  const first = manager(1)
  const second = manager(2)
  controller.updateSession(first, { playbackState: 'playing', playbackStarted: true, hasMetadata: true, actions: ['pause'] })
  controller.updateSession(second, { playbackState: 'playing', playbackStarted: true, hasMetadata: true, actions: ['pause'] })
  assert.equal(controller.getSession().manager, second)
  controller.updateSession(first, { playbackState: 'playing', playbackStarted: false, hasMetadata: true, actions: ['pause'] })
  assert.equal(controller.getSession().manager, second)
  controller.requestAction('pause')
  controller.requestAction('nexttrack')
  assert.deepEqual(sent, [[2, 'pause']])

  controller.updateSession(second, { playbackState: 'paused', hasMetadata: true, actions: ['play'] })
  assert.equal(controller.getSession().manager, first)
  controller.updateSession(first, { playbackState: 'paused', hasMetadata: true, actions: ['play'] })
  first.browserWindow.focused = true
  first.browserWindow.emit('focus')
  assert.equal(controller.getSession().manager, first)
  first.browserWindow.destroyed = true
  first.browserWindow.emit('closed')
  assert.equal(controller.getSession().manager, second)
  assert.equal(changes, 7)
})
