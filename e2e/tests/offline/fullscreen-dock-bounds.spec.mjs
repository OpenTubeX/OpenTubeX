import { writeFile } from 'node:fs/promises'

import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

async function expectDockInsidePlayer(dock, closeLabel = 'Close') {
  await expect.poll(() => dock.evaluate(element => {
    const dock = element.getBoundingClientRect()
    const player = element.closest('.ftVideoPlayer').getBoundingClientRect()
    const video = element.closest('.ftVideoPlayer').querySelector('video').getBoundingClientRect()
    return dock.left >= player.left && dock.right <= player.right &&
      dock.top >= player.top && dock.bottom <= player.bottom &&
      Math.abs(video.width + dock.width + 22 - player.width) <= 1
  })).toBe(true)
  const close = dock.getByRole('button', { name: closeLabel, exact: true })
  await expect.poll(() => close.evaluate(element => {
    const button = element.getBoundingClientRect()
    const header = element.closest('header').getBoundingClientRect()
    const target = document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2)
    if (button.left >= header.left && button.right <= header.right && element.contains(target)) return 'reachable'
    return JSON.stringify({
      inside: button.left >= header.left && button.right <= header.right,
      reachable: element.contains(target),
      button: [button.x, button.y, button.width, button.height],
      header: [header.x, header.y, header.width, header.height],
      target: `${target?.tagName}.${target?.getAttribute('class')}`,
    })
  })).toBe('reachable')
}

async function expectValidScroll(scroller, selector) {
  await expect.poll(() => scroller.evaluate((element, selector) => {
    const contentEnd = element.querySelector(selector).getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(element).paddingBottom)
    const maximum = Math.max(0, contentEnd - element.getBoundingClientRect().bottom + element.scrollTop)
    const tolerance = 2 / devicePixelRatio
    const visible = element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-visible')
    return element.scrollTop >= 0 && element.scrollTop <= maximum + tolerance && visible === (maximum > tolerance)
  }, selector)).toBe(true)
}

for (const { uiScale, colorScheme } of [{ uiScale: 175, colorScheme: 'light' }, { uiScale: 200, colorScheme: 'dark' }]) {
  test.describe(`fullscreen dock bounds at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          fullscreenActions: ['queue', 'recommendations', 'share'],
          reducedMotion: 'on',
          alwaysShowScrollbars: true,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
        }
      }
    })

    test('keeps queue and Up Next content and controls inside the minimum window', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      await mockPlayableWatchPage(app, page)
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await openMockedVideo(page)
      const watch = await page.evaluateHandle(findWatchComponent)
      try {
        await watch.evaluate(component => {
          component.proxy.recommendedVideos = Array.from({ length: 3 }, (_, index) => ({
            videoId: `related000${index}`, title: `Recommendation ${index + 1}`, author: 'Channel', type: 'video',
          }))
          for (let index = 0; index < 3; index++) {
            component.proxy.$store.commit('addVideoToWatchQueue', {
              video: { videoId: `queued0000${index}`, title: `Queued video ${index + 1}`, author: 'Channel' },
            })
          }
        })
        const player = page.locator('.ftVideoPlayer')
        await player.locator('video').evaluate(element => element.pause())
        await setWindowSize(app, page, { width: 340, height: 380 })
        await setPlayerFullscreen(page, true)
        const actions = player.locator('.fullscreenActions')
        await actions.getByRole('button', { name: 'Queue', exact: true }).click()
        const queue = player.locator('.fullscreenQueueOverlay.open')
        await expectDockInsidePlayer(queue)
        const handle = queue.getByRole('button', { name: 'Reorder Queued video 1', exact: true })
        await handle.scrollIntoViewIfNeeded()
        await expect.poll(() => handle.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return element.contains(target)
        })).toBe(true)
        await handle.press('ArrowDown')
        await expect(queue.locator('.queueVideoTitle').first()).toHaveText('Queued video 2')
        for (const button of await queue.locator('.queueActions button:not([disabled])').all()) {
          await button.scrollIntoViewIfNeeded()
          await expect.poll(() => button.evaluate(element => {
            const rect = element.getBoundingClientRect()
            const player = element.closest('.ftVideoPlayer').getBoundingClientRect()
            const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            return rect.left >= player.left && rect.right <= player.right && element.contains(target)
          })).toBe(true)
        }
        await queue.getByRole('button', { name: 'Remove Queued video 3 from queue', exact: true }).click()
        await expect(queue.locator('.queueItem')).toHaveCount(2)
        await expectValidScroll(queue.locator('.queueItems'), '.queueItemsContent')
        await queue.locator('.queueVideoTitle').first().scrollIntoViewIfNeeded()
        await expect.poll(() => queue.locator('.queueVideoTitle').first().evaluate(element => {
          const rect = element.getBoundingClientRect()
          const player = element.closest('.ftVideoPlayer').getBoundingClientRect()
          return rect.width > 0 && rect.left >= player.left && rect.right <= player.right
        })).toBe(true)
        await expectImagesLoaded(queue.locator('img:visible'))
        const capture = async name => {
          const data = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
          await writeFile(testInfo.outputPath(`${name}-${colorScheme}.png`), Buffer.from(data, 'base64'))
        }
        await capture('queue-scaled')
        const queueScroller = queue.locator('.queueItems')
        await queueScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await setWindowSize(app, page, { width: 880, height: 600 })
        await expectDockInsidePlayer(queue)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await setWindowSize(app, page, { width: 340, height: 380 })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await queue.getByRole('button', { name: 'Close', exact: true }).click()
        await actions.getByRole('button', { name: 'Recommended videos', exact: true }).click()
        const recommendations = player.locator('.fullscreenRecommendationsOverlay.open')
        await expectDockInsidePlayer(recommendations)
        await expect(recommendations.getByText('Recommendation 1', { exact: true }).first()).toBeVisible()
        await expectImagesLoaded(recommendations.locator('img:visible'))
        await capture('up-next-scaled')
        const recommendationsScroller = recommendations.locator('.recommendationsScroller')
        await recommendationsScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await setWindowSize(app, page, { width: 880, height: 600 })
        await expectDockInsidePlayer(recommendations)
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await setWindowSize(app, page, { width: 340, height: 380 })
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await setWindowSize(app, page, { width: 342, height: 880 })
        await watch.evaluate(async component => {
          component.proxy.videoChapters = Array.from({ length: 20 }, (_, index) => ({
            title: `Chapter ${index}`, startSeconds: index, endSeconds: index + 1, timestamp: `0:${index}`,
          }))
          await component.proxy.$nextTick()
          component.proxy.$refs.player.$.setupState.showChaptersOverlay = true
        })
        const chapters = player.locator('.chapterOverlay')
        await expect(chapters).toBeVisible()
        const lastChapter = chapters.locator('.chapterSeek').last()
        await lastChapter.scrollIntoViewIfNeeded()
        await expect.poll(() => lastChapter.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const dock = element.closest('.chapterOverlay').getBoundingClientRect()
          const actions = element.closest('.ftVideoPlayer').querySelector('.fullscreenActions').getBoundingClientRect()
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return dock.bottom <= actions.top && element.contains(target)
        })).toBe(true)
        await expectValidScroll(chapters.locator('.chaptersWrapper'), '.chaptersContent')
        await chapters.locator('.chapterOverlayHeader').dblclick()
        await expect.poll(() => chapters.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(59)
        await expect.poll(() => chapters.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(62)
        const chapterClose = chapters.getByRole('button', { name: 'Close Chapters', exact: true })
        await expect.poll(() => chapterClose.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return element.contains(target)
        })).toBe(true)
        await chapters.locator('.chapterOverlayHeader').dblclick()
        await recommendations.locator('.fullscreenDockResizeHandle').press('ArrowDown')
        await lastChapter.scrollIntoViewIfNeeded()
        await expectValidScroll(chapters.locator('.chaptersWrapper'), '.chaptersContent')
        await chapters.getByRole('button', { name: 'Close Chapters', exact: true }).click()
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await setWindowSize(app, page, { width: 340, height: 380 })
        await recommendations.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(player).not.toHaveClass(/fullscreenDockLayoutOpen/)
        await actions.getByRole('button', { name: 'Queue', exact: true }).click()
        await watch.evaluate(component => component.proxy.$store.dispatch('updateCurrentLocale', 'de-DE'))
        await expect(queue.locator('.clearQueueLabel')).toHaveText('Warteschlange leeren')
        await expectDockInsidePlayer(queue, 'Schließen')
        await expect.poll(() => queue.evaluate(element => {
          const label = element.querySelector('.clearQueueLabel').getBoundingClientRect()
          const close = element.querySelector('.fullscreenDockClose').getBoundingClientRect()
          return label.right <= close.left
        })).toBe(true)
        await queue.getByRole('button', { name: 'Schließen', exact: true }).click()
      } finally {
        await watch.dispose()
      }
    })
  })
}
