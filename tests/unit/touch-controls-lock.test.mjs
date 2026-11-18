import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'

globalThis.KeyboardEvent = class extends Event {
  constructor(type, init = {}) {
    super(type, init)
    this.key = init.key
  }
}
globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout })

const { HOLD_TO_UNLOCK_MS, useTouchControlsLock } = await import('../../src/renderer/components/FtShakaVideoPlayer/opentubex/useTouchControlsLock.js')

const BUTTON = { left: 100, right: 200, top: 100, bottom: 150 }
const ON_BUTTON = { clientX: 150, clientY: 125 }
const OFF_BUTTON = { clientX: 400, clientY: 400 }

function setup() {
  const available = ref(true)
  const calls = []
  const scope = effectScope()
  const lock = scope.run(() => useTouchControlsLock({
    isAvailable: () => available.value,
    getUnlockButton: () => ({ getBoundingClientRect: () => BUTTON }),
    onLock: () => calls.push('lock'),
    onUnlock: () => calls.push('unlock'),
  }))
  // The events that would continue to the player and the page.
  const pageListener = []
  /** @param {string} type @param {object} [init] */
  const dispatch = (type, init = {}) => {
    const event = type === 'keydown'
      ? new KeyboardEvent(type, { cancelable: true, ...init })
      : Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, ...ON_BUTTON, ...init })
    // Added last, so it runs after the lock unless the lock stops the event.
    const record = () => pageListener.push(type)
    window.addEventListener(type, record, { capture: true })
    const notCancelled = window.dispatchEvent(event)
    window.removeEventListener(type, record, { capture: true })
    return notCancelled
  }
  return { available, calls, dispatch, lock, pageListener, dispose: () => scope.stop() }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('locked touch controls swallow touches and back until the unlock button is held', async () => {
  const { calls, dispatch, dispose, lock, pageListener } = setup()
  lock.lockTouchControls()
  await nextTick()
  assert.deepEqual(calls, ['lock'])
  lock.unlockButtonShown.value = false

  dispatch('pointerdown')
  await wait(HOLD_TO_UNLOCK_MS + 50)
  assert.equal(lock.touchControlsLocked.value, true, 'a hidden unlock button cannot be held')
  dispatch('pointerup')
  assert.equal(dispatch('touchmove'), false, 'panels must not scroll')
  dispatch('click', OFF_BUTTON)
  assert.equal(lock.unlockButtonShown.value, true, 'a touch reveals the unlock button')
  // Android's back button is cancelled, so it leaves the player in full screen.
  assert.equal(dispatch('keydown', { key: 'Escape' }), false)
  dispatch('keydown', { key: 'k' })
  assert.deepEqual(pageListener, ['keydown'])

  // A tap, or a hold that slides off the button, does not unlock.
  dispatch('pointerdown')
  dispatch('pointerup')
  dispatch('click')
  dispatch('pointerdown')
  dispatch('pointermove', OFF_BUTTON)
  await wait(HOLD_TO_UNLOCK_MS + 50)
  dispatch('pointerup', OFF_BUTTON)
  assert.equal(lock.touchControlsLocked.value, true)

  dispatch('pointerdown')
  await wait(HOLD_TO_UNLOCK_MS + 50)
  assert.equal(lock.touchControlsLocked.value, false)
  assert.deepEqual(calls, ['lock', 'unlock'])
  // The rest of the hold does not reach the unlocked player.
  dispatch('pointerup')
  dispatch('click')
  await nextTick()
  dispatch('pointerdown')
  assert.deepEqual(pageListener, ['keydown', 'pointerdown'])
  dispose()
})

test('touch controls unlock when the player leaves full screen', async () => {
  const { available, calls, dispatch, dispose, lock, pageListener } = setup()
  lock.lockTouchControls()
  await nextTick()
  available.value = false
  await nextTick()
  assert.equal(lock.touchControlsLocked.value, false)
  assert.deepEqual(calls, ['lock', 'unlock'])
  dispatch('click')
  assert.deepEqual(pageListener, ['click'])
  lock.lockTouchControls()
  assert.equal(lock.touchControlsLocked.value, false, 'only a full screen player locks')
  dispose()
})
