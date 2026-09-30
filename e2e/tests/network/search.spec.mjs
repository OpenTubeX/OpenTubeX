import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('search', () => {
  test('search returns video results', async ({ page }) => {
    let blockPreviewRequest = true
    let returnPreviewPlaceholder = false
    let releasePreviewRequest
    let placeholderPreviewRequested = false
    let previewRequestFinished = false
    page.on('requestfinished', request => {
      if (/\/an_webp\//.test(request.url())) {
        previewRequestFinished = true
      }
    })
    await page.route(/\/an_webp\//, async route => {
      if (returnPreviewPlaceholder) {
        placeholderPreviewRequested = true
        await route.fulfill({
          status: 404,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"/>'
        })
        return
      }

      if (blockPreviewRequest) {
        await new Promise(resolve => {
          releasePreviewRequest = () => {
            blockPreviewRequest = false
            resolve()
          }
        })
      }
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
    await expect.poll(() => typeof releasePreviewRequest).toBe('function')
    await expect(preview).toHaveCount(0)

    await page.mouse.move(0, 0)
    await expect(preview).toHaveCount(0)

    releasePreviewRequest()
    await expect.poll(() => previewRequestFinished).toBe(true)
    await expect(preview).toHaveCount(0)

    await thumbnail.hover()
    await expect(preview).toHaveAttribute('src', /\/an_webp\//)
    await expect(preview).toHaveClass(/active/, { timeout: 400 })
    await expect(preview).toHaveCSS('opacity', '1')
    await expect.poll(() => preview.evaluate(image => (
      image.complete && image.naturalWidth > 0
    ))).toBe(true)

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
      const NativeImage = window.Image
      window.__thumbnailPreviewLoaderCount = 0
      window.Image = new Proxy(NativeImage, {
        construct(target, args) {
          window.__thumbnailPreviewLoaderCount++
          return Reflect.construct(target, args)
        }
      })
    })

    returnPreviewPlaceholder = true
    const secondVideo = page.locator('.ft-list-video').nth(1)
    await secondVideo.locator('.thumbnailLink').hover()
    await expect.poll(() => placeholderPreviewRequested).toBe(true)
    await page.waitForTimeout(600)
    await expect(secondVideo.locator('.thumbnailPreview')).toHaveCount(0)
    await expect(secondVideo.locator('.thumbnailImage').first()).toBeVisible()
    const loaderCountAfterPlaceholder = await page.evaluate(() => window.__thumbnailPreviewLoaderCount)

    await page.mouse.move(0, 0)
    returnPreviewPlaceholder = false
    await secondVideo.locator('.thumbnailLink').hover()
    await expect.poll(() => page.evaluate(() => window.__thumbnailPreviewLoaderCount))
      .toBeGreaterThan(loaderCountAfterPlaceholder)

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

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
      store.commit('setTabBarPosition', 'left')
    })
    await expect(page.locator('.tabBar.vertical')).toBeVisible()

    // Pause thumbnail copies while subsequent real pointer clicks land.
    await page.evaluate(() => {
      window.__thumbnailMorphs = []
      const animate = Element.prototype.animate
      Element.prototype.animate = function (keyframes, options) {
        const animation = animate.call(this, keyframes, options)
        if (this.classList.contains('newTabThumbnailMorph')) {
          animation.pause()
          window.__thumbnailMorphs.push(animation)
        }
        return animation
      }
      window.__backgroundDocumentSnapshots = 0
      const startViewTransition = document.startViewTransition.bind(document)
      document.startViewTransition = (...args) => {
        window.__backgroundDocumentSnapshots++
        return startViewTransition(...args)
      }
    })

    await page.locator('.ft-list-video .title').first().click({ button: 'middle' })
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page).toHaveURL(/#\/search\//)
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(1)
    await expect(page.locator('.newTabThumbnailMorph')).toHaveCSS('pointer-events', 'none')

    for (const index of [1, 2]) {
      const video = page.locator('.ft-list-video').nth(index)
      const link = video.locator(index === 1 ? '.title' : '.thumbnailLink')
      await link.click({ button: 'middle' })
      await expect(page.locator(sel.tabs)).toHaveCount(index + 2, { timeout: 3000 })
      await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(index + 1)
    }

    expect(await page.evaluate(() => window.__backgroundDocumentSnapshots)).toBe(0)
    await page.evaluate(() => window.__thumbnailMorphs.forEach(animation => animation.finish()))
    await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(0)

    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'reduce'
    })
    await page.locator('.ft-list-video .title').nth(1).click({ button: 'middle' })
    await expect(page.locator(sel.tabs)).toHaveCount(5)
    expect(await page.evaluate(() => window.__thumbnailMorphs)).toHaveLength(3)

    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/watch\//)
    if (!innertube.replay) {
      // Full watch page hydration needs the real API.
      await expect(page.locator('.tabContent[aria-hidden="false"] .videoTitle')).toBeVisible({ timeout: 30_000 })
    }
  })
})
