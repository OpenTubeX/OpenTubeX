import assert from 'node:assert/strict'
import test from 'node:test'
import { installIosContextMenu } from '../../src/renderer/helpers/iosContextMenu.js'

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const listeners = new Map()
  const contexts = []
  const document = {
    defaultView: { PointerEvent: class { constructor(type, options) { Object.assign(this, { type }, options) } } },
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type) { listeners.delete(type) },
  }
  const target = {
    isConnected: true,
    closest(selector) { return selector.includes('a[href]') ? this : null },
    contains(element) { return element === this },
    dispatchEvent(event) { contexts.push(event); return true },
  }
  const dispose = installIosContextMenu(document)
  t.after(dispose)
  function send(type, options = {}) {
    const event = { type, target, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 40, clientY: 80,
      preventDefault() { this.prevented = true }, stopImmediatePropagation() {}, ...options }
    listeners.get(type)?.(event)
    return event
  }
  return { contexts, send, dispose, listeners }
}

test('a held link or thumbnail opens its existing context menu and suppresses release navigation', t => {
  const { contexts, send } = fixture(t)
  send('pointerdown')
  t.mock.timers.tick(500)
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].type, 'contextmenu')
  assert.equal(contexts[0].clientX, 40)
  send('pointerup')
  assert.equal(send('click').prevented, true)
  send('pointerdown')
  send('pointerup')
  assert.notEqual(send('click').prevented, true)
})

for (const action of ['pointerup', 'pointercancel', 'scroll', 'pointermove']) {
  test(`${action} cancels a pending hold so scrolling and taps keep working`, t => {
    const { contexts, send } = fixture(t)
    send('pointerdown')
    send(action, { clientY: 100 })
    t.mock.timers.tick(600)
    assert.equal(contexts.length, 0)
  })
}

test('a second finger cancels the pending hold', t => {
  const { contexts, send } = fixture(t)
  send('pointerdown')
  send('pointerdown', { pointerId: 2, isPrimary: false })
  t.mock.timers.tick(600)
  assert.equal(contexts.length, 0)
})

test('mouse input does not synthesize a touch menu and disposal removes listeners', t => {
  const { contexts, send, dispose, listeners } = fixture(t)
  send('pointerdown', { pointerType: 'mouse' })
  t.mock.timers.tick(600)
  assert.equal(contexts.length, 0)
  dispose()
  assert.equal(listeners.size, 0)
})
