import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('search', () => {
  test('search returns video results', async ({ page }) => {
    await page.locator(sel.searchInput).fill('big buck bunny')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(/#\/search\//)
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.ft-list-video').count()).toBeGreaterThan(3)
  })

  test('opening a search result loads the watch page', async ({ page, innertube }) => {
    await page.locator(sel.searchInput).fill('big buck bunny')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    await page.evaluate(() => {
      window.__viewTransitionSnapshots = []
      const startViewTransition = document.startViewTransition.bind(document)
      document.startViewTransition = (update) => {
        const snapshot = {
          sourceName: document.querySelector('.ft-list-video .thumbnailImage')?.style.viewTransitionName
        }
        window.__viewTransitionSnapshots.push(snapshot)
        const transition = startViewTransition(async () => {
          await update()
          snapshot.targetName = getComputedStyle(document.querySelector('.tabBar .tab:last-of-type')).viewTransitionName
        })
        transition.ready.then(
          () => { snapshot.ready = true },
          error => { snapshot.readyError = String(error) }
        )
        return transition
      }
    })

    await page.locator('.ft-list-video .title').first().click({ button: 'middle' })
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page).toHaveURL(/#\/search\//)
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect.poll(() => page.evaluate(() => window.__viewTransitionSnapshots[0]?.targetName)).toBe('new-tab-thumbnail-morph')
    await expect.poll(() => page.evaluate(() => window.__viewTransitionSnapshots[0]?.ready)).toBe(true)
    expect(await page.evaluate(() => window.__viewTransitionSnapshots[0])).toEqual({
      sourceName: 'new-tab-thumbnail-morph',
      targetName: 'new-tab-thumbnail-morph',
      ready: true
    })

    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'reduce'
    })
    await page.locator('.ft-list-video .title').nth(1).click({ button: 'middle' })
    await expect(page.locator(sel.tabs)).toHaveCount(3)
    expect(await page.evaluate(() => window.__viewTransitionSnapshots)).toHaveLength(1)

    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/watch\//)
    if (!innertube.replay) {
      // Full watch page hydration needs the real API.
      await expect(page.locator('.tabContent[aria-hidden="false"] .videoTitle')).toBeVisible({ timeout: 30_000 })
    }
  })
})
