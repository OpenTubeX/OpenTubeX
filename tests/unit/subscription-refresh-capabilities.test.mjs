import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSubscriptionRefreshCapabilities } from '../../src/renderer/helpers/subscriptionRefreshCapabilities.js'

test('subscription refresh uses the correct progress and notification channels per runtime', () => {
  assert.deepEqual(resolveSubscriptionRefreshCapabilities({ isElectron: true, isCapacitor: false }), {
    storageBroadcast: false,
    electronProgress: true,
    androidNotifications: false,
  })
  assert.deepEqual(resolveSubscriptionRefreshCapabilities({ isElectron: false, isCapacitor: true }), {
    storageBroadcast: true,
    electronProgress: false,
    androidNotifications: true,
  })
  assert.deepEqual(resolveSubscriptionRefreshCapabilities({ isElectron: false, isCapacitor: false }), {
    storageBroadcast: true,
    electronProgress: false,
    androidNotifications: false,
  })
})
