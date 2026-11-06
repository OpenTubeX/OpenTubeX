import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      animationSpeed: 0,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    },
  },
})

test('desktop Shorts information labels metadata with icons instead of separator dots', { tag: '@scale' }, async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    component.proxy.useCustomShortsPlayerForCurrentVideo = true
    component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
    component.proxy.videoPublished = new Date('2025-03-28T12:00:00Z').getTime()
    component.proxy.videoViewCount = 49648
    component.proxy.videoCategory = 'Science & Technology'
    await component.proxy.$nextTick()
  })
  await watch.dispose()
  await page.locator('.shortsExternalTitleButton').click()
  const metadata = page.locator('.shortsAuxPanelOpen .datePublishedAndViewCount')
  await expect(metadata).toBeVisible()
  await expect(metadata.locator(':scope > *')).toHaveCount(4)
  await expect(metadata.locator(':scope > * > .statIcon:first-child')).toHaveCount(4)
  await expect(metadata).not.toContainText('Published on')
  await expect(metadata).not.toContainText('Video Category')
  await expect(metadata.locator('.publishedDate')).toHaveAttribute('title', /^Published on /)
  await expect(metadata.locator('.videoCategory')).toHaveText('Science & Technology')
  await expect(metadata.locator('.videoCategory')).toHaveAttribute('title', 'Video Category: Science & Technology')
  await expect(metadata.getByRole('img', { name: 'Published on', exact: true })).toHaveCount(1)
  await expect(metadata.getByRole('img', { name: 'Video Category:', exact: true })).toHaveCount(1)

  for (const width of ['', '160px']) {
    await metadata.evaluate((element, value) => { element.style.inlineSize = value }, width)
    await expect.poll(() => metadata.evaluate(element => {
      const items = Array.from(element.children)
      const container = element.getBoundingClientRect()
      return items.every((item, index) => {
        if (getComputedStyle(item, '::before').content !== 'none') return false
        const bounds = item.getBoundingClientRect()
        if (index === 0) return true
        const previous = items[index - 1].getBoundingClientRect()
        // A wrapped item starts its own line; otherwise it must not touch the previous label.
        if (Math.abs(bounds.top - previous.top) > 1) return Math.abs(bounds.left - container.left) <= 1
        return bounds.left > previous.right
      })
    }), { message: 'icon-labeled metadata must not draw separators or overlap' }).toBe(true)
  }
  await metadata.evaluate(element => { element.style.inlineSize = '' })
  await page.screenshot({ path: testInfo.outputPath('shorts-video-info.png') })
})
