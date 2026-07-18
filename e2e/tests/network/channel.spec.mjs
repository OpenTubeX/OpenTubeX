import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

// The official Blender channel.
const CHANNEL_URL = 'https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg'

test.describe('channel page', () => {
  test('shows channel info and videos', async ({ page }) => {
    await page.locator(sel.searchInput).fill(CHANNEL_URL)
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(/#\/channel\/UCSMOQeBJ2RAnuFungnQOxLg/)
    await expect(page.getByText('Blender').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
  })
})
