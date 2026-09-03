import assert from 'node:assert/strict'
import test from 'node:test'

import { supportsNativeNotifications } from '../../src/main/nativeNotifications.js'

test('does not initialize Windows notifications in portable builds', () => {
  let initialized = false
  const notification = {
    isSupported () {
      initialized = true
      return true
    }
  }

  assert.equal(supportsNativeNotifications(
    notification,
    { PORTABLE_EXECUTABLE_DIR: 'D:\\OpenTubeX' },
    'win32'
  ), false)
  assert.equal(initialized, false)
})

test('checks native notification support for installed builds', () => {
  let initialized = false
  const notification = {
    isSupported () {
      initialized = true
      return true
    }
  }

  assert.equal(supportsNativeNotifications(notification, {}, 'win32'), true)
  assert.equal(initialized, true)
})

test('keeps native notifications available outside Windows', () => {
  const notification = { isSupported: () => true }

  assert.equal(supportsNativeNotifications(
    notification,
    { PORTABLE_EXECUTABLE_DIR: '/opt/OpenTubeX' },
    'linux'
  ), true)
})
