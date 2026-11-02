import assert from 'node:assert/strict'
import test from 'node:test'

import { isImportantToast } from '../../src/renderer/helpers/toastImportance.js'

test('confirmations and status toasts are not important', () => {
  assert.equal(isImportantToast({}), false)
  assert.equal(isImportantToast({ icon: ['fas', 'check'], action: null, buttons: [], buttonAction: null, important: false }), false)
  assert.equal(isImportantToast({ icon: ['fas', 'sync'] }), false)
})

test('errors and warnings are important', () => {
  assert.equal(isImportantToast({ icon: ['fas', 'circle-exclamation'] }), true)
  assert.equal(isImportantToast({ icon: ['fas', 'triangle-exclamation'] }), true)
})

test('toasts the user can act on are important', () => {
  assert.equal(isImportantToast({ action: () => {} }), true)
  assert.equal(isImportantToast({ buttons: [{ label: 'Undo' }] }), true)
  assert.equal(isImportantToast({ buttonAction: 'open-sync-settings' }), true)
})

test('toasts marked important are important', () => {
  assert.equal(isImportantToast({ icon: ['fas', 'clock'], important: true }), true)
})
