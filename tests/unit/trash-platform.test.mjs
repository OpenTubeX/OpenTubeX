import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldUseGioTrash } from '../../src/main/trashPlatform.js'

test('uses GIO trash inside Flatpak on Linux', () => {
  assert.equal(shouldUseGioTrash('linux', true), true)
})

test('keeps the native trash implementation outside Linux Flatpak', () => {
  assert.equal(shouldUseGioTrash('linux', false), false)
  assert.equal(shouldUseGioTrash('darwin', true), false)
  assert.equal(shouldUseGioTrash('win32', true), false)
})
