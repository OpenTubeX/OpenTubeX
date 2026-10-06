import { test } from '../../helpers/app.mjs'
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
