import { test } from '../../helpers/app.mjs'
import { verifyCustomThemeSync } from '../../helpers/sync-custom-themes.mjs'

test('custom themes settle across different storage orders and default colors', async ({ page }) => {
  await verifyCustomThemeSync(page)
})
