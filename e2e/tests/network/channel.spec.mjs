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

    // Channel tab changes must update the route and title without creating a
    // new history entry for every tab selection (796650405, 912e5ea6e).
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    const historyLength = await page.evaluate(() => history.length)
    const videosTab = page.getByRole('tab', { name: 'Videos' })
    await videosTab.click()
    await expect(videosTab).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/#\/channel\/UCSMOQeBJ2RAnuFungnQOxLg\/videos/)
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    await expect(page.locator(sel.activeTab)).not.toContainText('/channel/')
    expect(await page.evaluate(() => history.length)).toBe(historyLength)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/subscriptions/)
  })
})
