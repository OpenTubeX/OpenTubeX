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

test('desktop Shorts information keeps separator dots between metadata labels', async ({ app, page }, testInfo) => {
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

  for (const zoom of [1, 0.95, 1.25]) {
    await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoom)
    for (const width of ['', '160px']) {
      await metadata.evaluate((element, value) => { element.style.inlineSize = value }, width)
      await expect.poll(() => metadata.evaluate(element => {
        const items = Array.from(element.children)
        const container = element.getBoundingClientRect()
        return items.slice(1).every((item, index) => {
          const before = getComputedStyle(item, '::before')
          const bounds = item.getBoundingClientRect()
          const previous = items[index].getBoundingClientRect()
          // The divider is a single CSS dot; no extra bullet glyph may paint
          // on top of it or the adjacent text.
          if (before.content !== '""') return false
          const offset = parseFloat(before.insetInlineStart)
          const width = parseFloat(before.width)
          const start = bounds.left + offset
          const end = start + width
          if (Math.abs(bounds.top - previous.top) > 1) return end <= container.left
          return start > previous.right && end < bounds.left
        })
      }), { message: 'metadata separators must not overlap their labels' }).toBe(true)
    }
  }
  await metadata.evaluate(element => { element.style.inlineSize = '' })
  await page.evaluate(() => window.ftElectron.setZoomFactor(1))
  await page.screenshot({ path: testInfo.outputPath('shorts-video-info.png') })
})
