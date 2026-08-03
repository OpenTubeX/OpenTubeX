import assert from 'node:assert/strict'
import test from 'node:test'

import { migrateLegacySettings } from '../../src/renderer/helpers/settings-migrations.js'

test('migrates the legacy subscription progress notification preference', () => {
  assert.deepEqual(migrateLegacySettings({ showSubscriptionRefreshToast: false }), {
    showProgressBarToast: false,
  })
})

test('prefers the current progress notification preference', () => {
  assert.deepEqual(migrateLegacySettings({
    showSubscriptionRefreshToast: false,
    showProgressBarToast: true,
  }), {
    showProgressBarToast: true,
  })
})
