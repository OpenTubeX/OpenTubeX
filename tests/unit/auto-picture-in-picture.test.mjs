import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyFocusState,
  applyMinimizedState,
  applyPictureInPictureState,
  createAutoPictureInPictureState,
  canEnableAndroidAutoPictureInPicture,
  markPictureInPictureRequested,
  resolveAndroidAutoPictureInPictureUpdate,
  resolveAutoPictureInPictureAction,
  shouldAutoPictureInPicture
} from '../../src/renderer/components/ft-shaka-video-player/opentubex/autoPictureInPictureState.js'

test('Android auto PiP is enabled only while a video is actively playing', () => {
  assert.equal(canEnableAndroidAutoPictureInPicture(true, 'video', null), false)
  assert.equal(canEnableAndroidAutoPictureInPicture(true, 'video', { paused: true, ended: false }), false)
  assert.equal(canEnableAndroidAutoPictureInPicture(true, 'video', { paused: false, ended: true }), false)
  assert.equal(canEnableAndroidAutoPictureInPicture(false, 'video', { paused: false, ended: false }), false)
  assert.equal(canEnableAndroidAutoPictureInPicture(true, 'audio', { paused: false, ended: false }), false)
  assert.equal(canEnableAndroidAutoPictureInPicture(true, 'video', { paused: false, ended: false }), true)
})

test('background Android players cannot update the global auto PiP state', () => {
  const playingVideo = { paused: false, ended: false }

  assert.equal(
    resolveAndroidAutoPictureInPictureUpdate(false, true, 'video', playingVideo, {
      wasPresented: false
    }),
    null
  )
  assert.equal(
    resolveAndroidAutoPictureInPictureUpdate(true, true, 'video', playingVideo),
    true
  )
})

test('leaving a playing Android video tab clears its automatic PiP state', () => {
  const playingVideo = { paused: false, ended: false }

  assert.equal(
    resolveAndroidAutoPictureInPictureUpdate(false, true, 'video', playingVideo, {
      wasPresented: true
    }),
    false
  )
})

const ALL_TRIGGERS = {
  canAutoPip: true,
  isActiveTab: true,
  triggerOnTabChange: true,
  triggerOnMinimize: true,
  triggerOnBlur: true
}

/**
 * Mirrors the composable: resolve an action, request the matching toggle and
 * report which toggles the player would have been asked to perform.
 */
function createPlayer (state, options = ALL_TRIGGERS) {
  const toggles = []
  let inPip = false

  return {
    get inPip () { return inPip },
    toggles,
    update () {
      const wantPip = shouldAutoPictureInPicture(state, options)
      const action = resolveAutoPictureInPictureAction(state, { wantPip, inPip })

      if (action === 'enter' || action === 'exit') {
        markPictureInPictureRequested(state, action === 'enter')
        toggles.push(action)
      }

      return action
    },
    // Applies a previously requested toggle, as the async PiP transition would.
    settle () {
      inPip = !inPip
      if (applyPictureInPictureState(state, inPip)) {
        this.update()
      }
      return inPip
    },
    closedByUser () {
      inPip = false
      if (applyPictureInPictureState(state, false)) {
        this.update()
      }
    }
  }
}

// Regression (#492, #265): with the blur trigger enabled, restoring the window
// closed the PiP window but a stale blur reopened it right away.
test('restoring the window does not let a stale blur reopen PiP', () => {
  const state = createAutoPictureInPictureState()
  const player = createPlayer(state)

  // Minimizing blurs the window first, which opens PiP.
  applyFocusState(state, false)
  player.update()
  applyMinimizedState(state, true)
  player.update()
  player.settle()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, ['enter'])

  // Restoring closes it again.
  applyMinimizedState(state, false)
  player.update()
  player.settle()
  assert.equal(player.inPip, false)
  assert.deepEqual(player.toggles, ['enter', 'exit'])

  // A blur delivered while the window manager hands focus back must not count.
  applyFocusState(state, false)
  player.update()
  assert.equal(player.inPip, false)
  assert.deepEqual(player.toggles, ['enter', 'exit'])
})

test('the blur trigger works again once the window was really focused', () => {
  const state = createAutoPictureInPictureState()
  const player = createPlayer(state)

  applyMinimizedState(state, true)
  player.update()
  player.settle()
  applyMinimizedState(state, false)
  player.update()
  player.settle()
  assert.equal(player.inPip, false)

  applyFocusState(state, true)
  applyFocusState(state, false)
  player.update()
  player.settle()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, ['enter', 'exit', 'enter'])
})

// Regression (#492): blur and minimize fire within the same window transition,
// and PiP toggling is asynchronous, so both triggers used to request a toggle.
test('a second trigger does not cancel out the requested toggle', () => {
  const state = createAutoPictureInPictureState()
  const player = createPlayer(state)

  applyFocusState(state, false)
  assert.equal(player.update(), 'enter')

  // The window is reported as minimized before the PiP window has opened.
  applyMinimizedState(state, true)
  assert.equal(player.update(), 'wait')
  assert.deepEqual(player.toggles, ['enter'])

  player.settle()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, ['enter'])
})

test('a restore while the PiP request is still in flight closes PiP once', () => {
  const state = createAutoPictureInPictureState()
  const player = createPlayer(state)

  applyMinimizedState(state, true)
  assert.equal(player.update(), 'enter')

  applyMinimizedState(state, false)
  assert.equal(player.update(), 'wait')

  // The pending enter lands, so the settled state re-evaluates and closes it.
  player.settle()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, ['enter', 'exit'])

  player.settle()
  assert.equal(player.inPip, false)
})

test('PiP closed by the user is not reopened by an active trigger', () => {
  const state = createAutoPictureInPictureState()
  const player = createPlayer(state)

  applyMinimizedState(state, true)
  player.update()
  player.settle()
  assert.equal(player.inPip, true)

  player.closedByUser()
  assert.equal(player.inPip, false)
  assert.deepEqual(player.toggles, ['enter'])

  // A later re-evaluation (the player refreshes on `canplay`, focus changes and
  // tab switches) must not reopen what the user just closed.
  player.update()
  assert.equal(player.inPip, false)
  assert.deepEqual(player.toggles, ['enter'])

  // Restoring ends the trigger, so the next one may open PiP again.
  applyMinimizedState(state, false)
  player.update()
  applyMinimizedState(state, true)
  player.update()
  player.settle()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, ['enter', 'enter'])
})

test('PiP opened by the user is not closed on restore', () => {
  const state = createAutoPictureInPictureState()
  const player = createPlayer(state)

  // A manual PiP transition arrives without a matching request.
  player.settle()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, [])

  applyMinimizedState(state, true)
  player.update()
  applyMinimizedState(state, false)
  player.update()
  assert.equal(player.inPip, true)
  assert.deepEqual(player.toggles, [])
})

test('a restored automatic PiP request keeps its ownership while settling', () => {
  const state = createAutoPictureInPictureState()

  markPictureInPictureRequested(state, true, { automatic: true })
  assert.equal(resolveAutoPictureInPictureAction(state, { wantPip: true, inPip: false }), 'wait')
  applyPictureInPictureState(state, true)

  assert.equal(state.autoPipActive, true)
  assert.equal(resolveAutoPictureInPictureAction(state, { wantPip: false, inPip: true }), 'exit')
})

test('a restored manual PiP request remains user-owned', () => {
  const state = createAutoPictureInPictureState()

  markPictureInPictureRequested(state, true, { automatic: false })
  applyPictureInPictureState(state, true)

  assert.equal(state.autoPipActive, false)
  assert.equal(resolveAutoPictureInPictureAction(state, { wantPip: false, inPip: true }), 'none')
})

test('window minimize and blur only trigger for the presented tab', () => {
  const state = createAutoPictureInPictureState({ minimized: true, focused: false })
  const options = { ...ALL_TRIGGERS, isActiveTab: false, triggerOnTabChange: false }

  assert.equal(shouldAutoPictureInPicture(state, options), false)
  assert.equal(shouldAutoPictureInPicture(state, { ...options, triggerOnTabChange: true }), true)
})
