import { test, expect, goTo } from '../../helpers/app.mjs'

test('opens downloads through quick settings on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 })
  await goTo(page, 'downloads')
  await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
})
