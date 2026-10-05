import assert from 'node:assert/strict'
import test from 'node:test'

import { initializePageScrollbar, observePageScrollbarVisibility } from '../../src/renderer/helpers/pageScrollbar.js'

function fakeElement () {
  const attributes = new Set(['data-overlayscrollbars-initialize'])

  return {
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name)
  }
}

test('Capacitor keeps the native page scrollbar and removes startup suppression', () => {
  const documentElement = fakeElement()
  const body = fakeElement()
  let overlayTarget = null

  const instance = initializePageScrollbar(
    { documentElement, body },
    true,
    (target) => {
      overlayTarget = target
      return { target }
    }
  )

  assert.equal(instance, null)
  assert.equal(overlayTarget, null)
  assert.equal(documentElement.hasAttribute('data-overlayscrollbars-initialize'), false)
  assert.equal(body.hasAttribute('data-overlayscrollbars-initialize'), false)
})

test('desktop initializes the themed page scrollbar as before', () => {
  const documentElement = fakeElement()
  const body = fakeElement()

  const instance = initializePageScrollbar(
    { documentElement, body },
    false,
    (target) => ({ target })
  )

  assert.equal(instance.target, body)
  assert.equal(documentElement.hasAttribute('data-overlayscrollbars-initialize'), true)
  assert.equal(body.hasAttribute('data-overlayscrollbars-initialize'), true)
})

test('page scrollbar visibility follows overlapping fullscreen and full-window states', () => {
  let mutation
  let disconnected = false
  const classes = new Set()
  const body = { classList: { contains: name => classes.has(name) } }
  const pageDocument = Object.assign(new EventTarget(), {
    body, fullscreenElement: null,
    defaultView: {
      MutationObserver: class {
        constructor(callback) { mutation = callback }
        observe(target, options) {
          assert.equal(target, body)
          assert.deepEqual(options, { attributes: true, attributeFilter: ['class'] })
        }
        disconnect() { disconnected = true }
      },
    },
  })
  const changes = []
  const stop = observePageScrollbarVisibility(pageDocument, hidden => changes.push(hidden))
  pageDocument.fullscreenElement = {}
  pageDocument.dispatchEvent(new Event('fullscreenchange'))
  classes.add('playerFullWindow')
  mutation()
  pageDocument.fullscreenElement = null
  pageDocument.dispatchEvent(new Event('fullscreenchange'))
  assert.deepEqual(changes, [false, true], 'Exiting native fullscreen must not reveal the scrollbar during full-window mode')
  classes.delete('playerFullWindow')
  mutation()
  mutation()
  assert.deepEqual(changes, [false, true, false])
  classes.add('playerFullWindow')
  mutation()
  assert.deepEqual(changes, [false, true, false, true], 'Rotation fullscreen uses the body class without native fullscreen')
  stop()
  assert.equal(disconnected, true)
  pageDocument.dispatchEvent(new Event('fullscreenchange'))
  assert.deepEqual(changes, [false, true, false, true])
})
