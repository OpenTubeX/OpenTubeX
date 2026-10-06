import { writeFile } from 'node:fs/promises'

import { test, expect, goToSettingsSection, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

async function expectValidScroll(scroller, contentSelector) {
  await expect.poll(() => scroller.evaluate((element, selector) => {
    const content = element.querySelector(selector)
    const contentEnd = content.getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(element).paddingBottom)
    const viewportEnd = element.getBoundingClientRect().bottom
    const maximum = Math.max(0, contentEnd - viewportEnd + element.scrollTop)
    const tolerance = 2 / devicePixelRatio
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    return element.scrollTop >= 0 && element.scrollTop <= maximum + tolerance &&
      scrollbar.classList.contains('os-scrollbar-visible') === (maximum > tolerance)
  }, contentSelector)).toBe(true)
}

async function scrollToBottom(scroller) {
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
}

async function expectActionsFitPlayer(player) {
  await expect.poll(() => player.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const actions = element.querySelector('.fullscreenActions')
    return [...actions.children].every(action => {
      const button = action.matches('button') ? action : action.querySelector('button')
      const rect = button.getBoundingClientRect()
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return rect.left >= bounds.left && rect.right <= bounds.right &&
        rect.top >= bounds.top && rect.bottom <= bounds.bottom &&
        Math.abs(rect.width - 40) <= 1 && Math.abs(rect.height - 40) <= 1 && button.contains(target)
    })
  })).toBe(true)
}

async function expectUnifiedDockHeader(dock, headerSelector) {
  await expect.poll(() => dock.evaluate((element, selector) => {
    const header = element.querySelector(selector)
    const close = header.querySelector('button[title="Close"]')
    const dockBounds = element.getBoundingClientRect()
    const headerBounds = header.getBoundingClientRect()
    const closeBounds = close.getBoundingClientRect()
    const border = Number.parseFloat(getComputedStyle(element).borderLeftWidth)
    return {
      fullWidth: Math.abs(headerBounds.left - dockBounds.left - border) <= 1 &&
        Math.abs(dockBounds.right - headerBounds.right - border) <= 1,
      height: Math.round(headerBounds.height * 10) / 10,
      closeWidth: Math.round(closeBounds.width * 10) / 10,
      closeHeight: Math.round(closeBounds.height * 10) / 10,
      closeInset: Math.round((headerBounds.right - closeBounds.right) * 10) / 10,
      closeBackground: getComputedStyle(close).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
    }
  }, headerSelector)).toEqual({
    fullWidth: true,
    height: 52,
    closeWidth: 36,
    closeHeight: 36,
    closeInset: 8,
    closeBackground: 'rgba(0, 0, 0, 0)',
    headerBackground: 'rgba(20, 20, 20, 0.52)',
  })
  const close = dock.getByRole('button', { name: 'Close', exact: true })
  await close.hover()
  await expect(close).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.2)')
  await dock.page().mouse.move(0, 0)
}

for (const { uiScale, iconPack, colorScheme } of [
  { uiScale: 100, iconPack: 'material', colorScheme: 'dark' },
  { uiScale: 125, iconPack: 'remix', colorScheme: 'light' },
]) {
  test.describe(`fullscreen queue and recommendations at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          iconPack,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
          reducedMotion: 'on',
          alwaysShowScrollbars: true,
        }
      }
    })

    test('adds optional actions, edits the queue and restores fullscreen docks', async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width: 1360, height: 850 })
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize fullscreen actions', exact: true }).click()
      await expect(page.locator('.selectedAction[data-fullscreen-action-id="queue"]')).toBeVisible()
      await expect(page.locator('.selectedAction[data-fullscreen-action-id="download"]')).toHaveCount(0)
      await expect(page.locator('.selectedAction[data-fullscreen-action-id="recommendations"]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Add action', exact: true }).click()
      const menu = page.getByRole('menu', { name: 'Add action', exact: true })
      await expect(menu.getByRole('menuitem')).toHaveCount(2)
      await menu.getByRole('menuitem', { name: 'Download Video', exact: true }).click()
      await menu.getByRole('menuitem', { name: 'Recommended videos', exact: true }).click()
      await page.locator('.settingsCloseButton').click()

      await mockPlayableWatchPage(app, page)
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await page.route('https://images.test/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
      await openMockedVideo(page)
      const watch = await page.evaluateHandle(findWatchComponent)
      try {
        await watch.evaluate(component => {
          const watch = component.proxy
          const store = watch.$store
          watch.recommendedVideos = Array.from({ length: 20 }, (_, index) => ({
            videoId: `related${String(index).padStart(4, '0')}`,
            title: `Recommended video ${index + 1}`,
            author: 'Recommendation channel',
            authorId: 'UC-recommendation-test',
            lengthSeconds: 60,
            viewCount: 100,
            published: Date.now() - 86400000,
            type: 'video',
            isLive: false,
          }))
          for (let index = 0; index < 20; index++) {
            store.commit('addVideoToWatchQueue', {
              video: {
                videoId: `queued${String(index).padStart(5, '0')}`,
                title: `Queued video ${index + 1}`,
                author: 'Queue channel',
                thumbnail: `https://images.test/queue-${index}.svg`,
              }
            })
          }
        })
        const player = page.locator('.ftVideoPlayer')
        await player.locator('video').evaluate(element => element.pause())
        const sidebarQueue = page.locator('.sidebarArea .queueItems')
        await sidebarQueue.evaluate(element => { element.scrollTop = 150 })
        await expect.poll(() => sidebarQueue.evaluate(element => Math.abs(element.scrollTop - 150))).toBeLessThanOrEqual(1)
        await setPlayerFullscreen(page, true)
        const actions = player.locator('.fullscreenActions')
        const captureDocks = async (name) => {
          const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
          await writeFile(testInfo.outputPath(`${name}-${colorScheme}.png`), Buffer.from(screenshot, 'base64'))
        }
        await expect(actions.getByRole('button', { name: 'Queue', exact: true })).toBeVisible()
        await expect(player.locator('.fullscreenQueueOverlay.open')).toHaveCount(0)
        await actions.getByRole('button', { name: 'Queue', exact: true }).click()
        const queue = player.locator('.fullscreenQueueOverlay.open')
        const queueScroller = queue.locator('.queueItems')
        await expect(queue).toBeVisible()
        await page.mouse.move(0, 0)
        await expectUnifiedDockHeader(queue, '.queueHeader')
        await expect(queueScroller).toHaveAttribute('data-overlayscrollbars-viewport')
        await expect(queue.locator('.queueItem')).toHaveCount(20)
        await queue.getByRole('button', { name: 'Move Queued video 2 up', exact: true }).click()
        await expect(queue.locator('.queueVideoTitle').first()).toHaveText('Queued video 2')
        await queue.getByRole('button', { name: 'Remove Queued video 2 from queue', exact: true }).click()
        await expect(queue.locator('.queueItem')).toHaveCount(19)
        await scrollToBottom(queueScroller)
        await setWindowSize(app, page, { width: 480, height: 400 })
        await expectActionsFitPlayer(player)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await queueScroller.evaluate(element => { element.scrollTop = 0 })
        await expectImagesLoaded(queue.locator('img:visible'))
        await captureDocks('wrapped-actions')
        await scrollToBottom(queueScroller)
        await actions.getByRole('button', { name: 'Share Video', exact: true }).click()
        const share = player.locator('.fullscreenDropdownLayer[aria-label="Share Video"]')
        await expect(share).toBeVisible()
        await share.press('Escape')
        await expect(share).toHaveCount(0)
        await expectActionsFitPlayer(player)
        await expect.poll(() => queue.locator('.queueHeader').evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const title = element.querySelector('.queueTitle').getBoundingClientRect()
          const count = element.querySelector('.queueCount').getBoundingClientRect()
          return Array.from(element.children).every(child => {
            const childBounds = child.getBoundingClientRect()
            return childBounds.left >= bounds.left - 1 && childBounds.right <= bounds.right + 1
          }) && count.left >= title.right && Math.abs(count.top + count.height / 2 - title.top - title.height / 2) <= 1
        })).toBe(true)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await setWindowSize(app, page, { width: 1360, height: 850 })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await scrollToBottom(queueScroller)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        const expectQueueScrollbarClear = async () => {
          await expect.poll(() => queueScroller.evaluate(element => {
            const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical').getBoundingClientRect()
            const actions = element.querySelector('.queueActions').getBoundingClientRect()
            return scrollbar.left - actions.right
          })).toBeGreaterThanOrEqual(3)
        }
        await expectQueueScrollbarClear()
        const scrollbarWidth = await watch.evaluate(component => component.proxy.$store.getters.getScrollbarThumbWidth)
        await watch.evaluate(component => component.proxy.$store.dispatch('updateScrollbarThumbWidth', 16))
        await expectQueueScrollbarClear()
        await watch.evaluate((component, width) => component.proxy.$store.dispatch('updateScrollbarThumbWidth', width), scrollbarWidth)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        const queuePosition = await queueScroller.evaluate(element => element.scrollTop)
        await queue.getByRole('button', { name: 'Close', exact: true }).click()
        await expect.poll(() => sidebarQueue.evaluate(element => Math.abs(element.scrollTop - 150))).toBeLessThanOrEqual(1)
        await setWindowSize(app, page, { width: 480, height: 400 })
        await expectActionsFitPlayer(player)
        await setWindowSize(app, page, { width: 1360, height: 850 })
        await actions.getByRole('button', { name: 'Queue', exact: true }).click()
        await expect.poll(() => queueScroller.evaluate((element, position) => Math.abs(element.scrollTop - position), queuePosition)).toBeLessThanOrEqual(1)

        await actions.getByRole('button', { name: 'Recommended videos', exact: true }).click()
        const recommendations = player.locator('.fullscreenRecommendationsOverlay.open')
        const recommendationsScroller = recommendations.locator('.recommendationsScroller')
        await expect(recommendations).toBeVisible()
        await page.mouse.move(0, 0)
        await expectUnifiedDockHeader(recommendations, '.recommendationsDockHeader')
        await expect(recommendationsScroller).toHaveAttribute('data-overlayscrollbars-viewport')
        await setWindowSize(app, page, { width: 480, height: 900 })
        await expectActionsFitPlayer(player)
        await setWindowSize(app, page, { width: 1360, height: 850 })
        await expect(queue.getByRole('button', { name: 'Resize dock', exact: true })).toBeVisible()
        await scrollToBottom(queueScroller)
        await queue.getByRole('button', { name: 'Resize dock', exact: true }).press('ArrowUp')
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await queue.locator('.queueHeader').dblclick({ position: { x: 30, y: 15 } })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await queue.locator('.queueHeader').dblclick({ position: { x: 30, y: 15 } })
        await queue.getByRole('button', { name: 'Resize dock', exact: true }).dblclick()
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await expectImagesLoaded(queue.locator('img'))
        await scrollToBottom(recommendationsScroller)
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await expect(recommendationsScroller.locator(':scope > .os-scrollbar-vertical')).toBeVisible()
        await expectImagesLoaded(recommendations.locator('img'))
        await recommendations.getByRole('button', { name: 'Close', exact: true }).click()
        await actions.getByRole('button', { name: 'Comments', exact: true }).click()
        const comments = player.locator('.fullscreenCommentsOverlay.open')
        await expect(comments).toBeVisible()
        const loadComments = comments.locator('.getCommentsTitle')
        if (await loadComments.count() > 0) await loadComments.click()
        await expect(comments.locator('.commentThread').first()).toBeVisible()
        await expectImagesLoaded(comments.locator('img:visible'))
        await queueScroller.evaluate(element => { element.scrollTop = 0 })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await expect(queueScroller.locator(':scope > .os-scrollbar-vertical')).toBeVisible()
        await captureDocks('queue-comments')
        await scrollToBottom(queueScroller)
        await setWindowSize(app, page, { width: 480, height: 900 })
        await queue.locator('.queueHeader').dblclick({ position: { x: 30, y: 15 } })
        await expect.poll(() => queue.evaluate(element => {
          const dock = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return dock.height <= 61 && [...element.querySelectorAll('.queueHeader button')].every(button => {
            const bounds = button.getBoundingClientRect()
            return bounds.bottom <= dock.bottom - Number.parseFloat(style.borderBottomWidth) + 1 &&
              bounds.right <= dock.right - Number.parseFloat(style.borderRightWidth) + 1
          })
        })).toBe(true)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await queue.locator('.queueHeader').dblclick({ position: { x: 30, y: 15 } })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await setWindowSize(app, page, { width: 1360, height: 850 })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await queue.getByRole('button', { name: 'Close', exact: true }).click()
        await actions.getByRole('button', { name: 'Recommended videos', exact: true }).click()
        await recommendationsScroller.evaluate(element => { element.scrollTop = 0 })
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await expect(recommendationsScroller.locator(':scope > .os-scrollbar-vertical')).toBeVisible()
        await expectImagesLoaded(recommendations.locator('img'))
        await captureDocks('up-next-comments')
        await comments.getByRole('button', { name: 'Hide Comments', exact: true }).click()
        await actions.getByRole('button', { name: 'Queue', exact: true }).click()

        // Enlarging the viewport and reducing either list must clamp themed scrollbars.
        await scrollToBottom(queueScroller)
        await scrollToBottom(recommendationsScroller)
        await setPlayerFullscreen(page, false)
        await expect(page.locator('.sidebarArea .watchQueue')).toBeVisible()
        await expect(page.locator('.sidebarArea .watchVideoRecommendations')).toBeVisible()
        await setWindowSize(app, page, { width: 1450, height: 950 })
        await setPlayerFullscreen(page, true)
        await expect(queue).toBeVisible()
        await expect(recommendations).toBeVisible()
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await scrollToBottom(queueScroller)
        await watch.evaluate(component => {
          const store = component.proxy.$store
          for (const item of store.getters.getWatchQueue.slice(2)) store.commit('removeVideoFromWatchQueue', item.queueItemId)
        })
        await expect(queue.locator('.queueItem')).toHaveCount(2)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await expect.poll(() => queueScroller.evaluate(element => element.scrollTop)).toBe(0)
        await scrollToBottom(recommendationsScroller)
        await watch.evaluate(component => { component.proxy.$store.commit('setForbiddenTitles', JSON.stringify(['Recommended video 1'])) })
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await watch.evaluate(component => { component.proxy.$store.commit('setForbiddenTitles', '[]') })
        await scrollToBottom(recommendationsScroller)
        await watch.evaluate(component => { component.proxy.recommendedVideos = component.proxy.recommendedVideos.slice(0, 2) })
        await expectValidScroll(recommendationsScroller, '.recommendationsContent')
        await expect.poll(() => recommendationsScroller.evaluate(element => element.scrollTop)).toBe(0)
        await queue.getByRole('button', { name: 'Clear Queue', exact: true }).click()
        await expect(queue).toHaveCount(0)
        await expect(actions.getByRole('button', { name: 'Queue', exact: true })).toHaveCount(0)
        await watch.evaluate(component => {
          component.proxy.$store.commit('setForbiddenTitles', JSON.stringify(['Recommended video']))
        })
        await expect(recommendations).toHaveCount(0)
        await expect(actions.getByRole('button', { name: 'Recommended videos', exact: true })).toHaveCount(0)
        await watch.evaluate(component => { component.proxy.$store.commit('setForbiddenTitles', '[]') })
        await expect(actions.getByRole('button', { name: 'Recommended videos', exact: true })).toBeVisible()
        await expect(recommendations).toHaveCount(0)

        await actions.getByRole('button', { name: 'Download Video', exact: true }).click()
        const download = player.locator('.downloadPromptCard')
        await expect(download).toBeVisible()
        await expect(download.locator('.downloadVideoTitle')).toHaveText('Me at the zoo')
        await download.getByRole('button', { name: 'Cancel', exact: true }).click()
        await setPlayerFullscreen(page, false)
        await page.locator('.watchVideoInfo').getByRole('button', { name: 'Download Video', exact: true }).click()
        await expect(page.locator('.downloadPromptCard')).toBeVisible()
        await page.locator('.downloadPromptCard').getByRole('button', { name: 'Cancel', exact: true }).click()
        await watch.evaluate(component => { component.proxy.$store.commit('setEnableDownloads', false) })
        await setPlayerFullscreen(page, true)
        await expect(actions.getByRole('button', { name: 'Download Video', exact: true })).toHaveCount(0)
      } finally {
        await watch.dispose()
      }
    })
  })
}
