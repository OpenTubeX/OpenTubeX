import assert from 'node:assert/strict'
import test from 'node:test'

import { initializePageScrollbar } from '../../src/renderer/helpers/pageScrollbar.js'

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
