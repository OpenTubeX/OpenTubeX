import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('search', () => {
  test('search returns video results', async ({ page }) => {
    let releasePreviewRequest
    await page.route(/\/an_webp\//, async route => {
      await new Promise(resolve => { releasePreviewRequest = resolve })
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>'
      })
    })

    await page.locator(sel.searchInput).fill('big buck bunny')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(/#\/search\//)
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.ft-list-video').count()).toBeGreaterThan(3)

    const video = page.locator('.ft-list-video').first()
    const thumbnail = video.locator('.thumbnailLink')
    const preview = video.locator('.thumbnailPreview')

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
    })

    const href = await thumbnail.getAttribute('href')
    const videoId = /\/watch\/([^?]+)/.exec(href)?.[1]
    expect(videoId).toBeTruthy()
    await page.evaluate((videoId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertToHistoryCache', { videoId, isWatched: true })
    }, videoId)
    await expect(video).toHaveClass(/watched/)

    await thumbnail.hover()
    await expect(preview).toHaveAttribute('src', /\/an_webp\//)
    await expect.poll(() => typeof releasePreviewRequest).toBe('function')
    await expect(preview).not.toHaveClass(/loaded/)
    await expect(preview).toHaveCSS('opacity', '0')

    releasePreviewRequest()
    await expect(preview).toHaveClass(/loaded/)
    await expect(preview).toHaveCSS('opacity', '1')

    const [thumbnailBox, previewBox] = await Promise.all([
      video.locator('.thumbnailImage').first().boundingBox(),
      preview.boundingBox()
    ])
    expect(previewBox.x).toBeCloseTo(thumbnailBox.x, 1)
    expect(previewBox.y).toBeCloseTo(thumbnailBox.y, 1)
    expect(previewBox.width).toBeCloseTo(thumbnailBox.width, 1)
    expect(previewBox.height).toBeCloseTo(thumbnailBox.height, 1)

    await page.mouse.move(0, 0)
    await expect(preview).toHaveCount(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowThumbnailPreviews', false)
    })

    await thumbnail.hover()
    await page.waitForTimeout(600)
    await expect(preview).toHaveCount(0)
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
