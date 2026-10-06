import { test } from '../../helpers/app.mjs'
import { verifySyncDeviceRemoval } from '../../helpers/sync-device-removal.mjs'

for (const otherLogin of [false, true]) {
  test(`device removal ${otherLogin ? 'preserves tabs used by another login' : 'cleans up synced tabs'} and orphaned sets can be deleted`, async ({ page }) => {
    await verifySyncDeviceRemoval(page, { otherLogin })
  })
}
