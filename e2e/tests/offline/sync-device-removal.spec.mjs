import { test } from '../../helpers/app.mjs'
import { verifySyncDeviceRemoval } from '../../helpers/sync-device-removal.mjs'

test('device removal cleans up synced tabs and orphaned sets can be deleted', async ({ page }) => {
  await verifySyncDeviceRemoval(page)
})
