import { test } from '../../helpers/app.mjs'
import { verifySyncDeviceReconnection } from '../../helpers/sync-device-reconnection.mjs'
import { verifySyncDeviceRemoval } from '../../helpers/sync-device-removal.mjs'

for (const otherLogin of [false, true]) {
  test(`device removal ${otherLogin ? 'preserves tabs used by another login' : 'cleans up synced tabs'} and orphaned sets can be deleted`, async ({ page }) => {
    await verifySyncDeviceRemoval(page, { otherLogin })
  })
}

test('device removal reconfirms tab deletion when another login expires', async ({ page }) => {
  await verifySyncDeviceRemoval(page, { otherLogin: true, otherLoginExpires: true })
})

test('device removal reports partial completion when revocation fails and can be retried', async ({ page }) => {
  await verifySyncDeviceRemoval(page, { revokeFailsOnce: true })
})

test('device removal finishes after a lost revocation response without repeating deletion', async ({ page }) => {
  await verifySyncDeviceRemoval(page, { revokeResponseLost: true })
})

test('device removal cleans up tabs when the login disappears before confirmation', async ({ page }) => {
  await verifySyncDeviceRemoval(page, { loginDisappears: true })
})

test('device removal preserves tabs when another login reconnects during a conflict retry', async ({ page }) => {
  await verifySyncDeviceRemoval(page, { reconnectDuringCleanup: true })
})

for (const conflict of [false, true]) {
  test(`desktop reauthentication reclaims revoked tab sets after ${conflict ? 'a conflict' : 'a failed upload'}`, async ({ page }) => {
    await verifySyncDeviceReconnection(page, { conflict })
  })
}

test('desktop reauthentication preserves intentional tab-set deletion', async ({ page }) => {
  await verifySyncDeviceReconnection(page, { intentionalDeletion: true })
})

test('desktop upgrade reclaims tabs after an older client signs back in', async ({ page }) => {
  await verifySyncDeviceReconnection(page, { olderLogin: true })
})
