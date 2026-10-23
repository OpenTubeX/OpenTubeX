import { writeFile } from 'node:fs/promises'

import { test, expect, setPlayerFullscreen, setWindowSize, openInterfaceCustomizer } from '../../helpers/app.mjs'
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
  const actions = player.locator('.fullscreenActions')
  await expect.poll(() => player.evaluate(element => {
    const player = element.getBoundingClientRect()
    const actions = element.querySelector('.fullscreenActions').getBoundingClientRect()
    return actions.left >= player.left && actions.right <= player.right &&
      actions.top >= player.top && actions.bottom <= player.bottom
  })).toBe(true)
  const buttons = actions.locator('.fullscreenActionsContent > button, .fullscreenActionsContent > div > button')
  for (const button of await buttons.all()) {
    await button.scrollIntoViewIfNeeded()
    await expect.poll(() => button.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const viewport = element.closest('.fullscreenActions').getBoundingClientRect()
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return rect.left >= viewport.left && rect.right <= viewport.right &&
        rect.top >= viewport.top && rect.bottom <= viewport.bottom &&
        Math.abs(rect.width - 40) <= 1 && Math.abs(rect.height - 40) <= 1 && element.contains(target)
    })).toBe(true)
  }
}

/**
 * Reads the queue dock header, which must stay one row with every shown part
 * inside it. Its clear label hides before the count.
 */
function readQueueHeader(queue) {
  return queue.locator('.queueHeader').evaluate(element => {
    const header = element.getBoundingClientRect()
    const center = header.top + header.height / 2
    const label = element.querySelector('.queueLabel')
    const text = document.createRange()
    text.selectNodeContents(label)
    const clearLabel = element.querySelector('.clearQueueLabel').checkVisibility()
    const count = element.querySelector('.queueCount').checkVisibility()
    const parts = [...element.querySelectorAll('.queueTitle, .queueCount, .queueHeaderAction, .fullscreenDockClose')]
    return {
      oneRow: Math.round(header.height) === 52 && parts.filter(part => part.checkVisibility()).every(part => {
        const bounds = part.getBoundingClientRect()
        return bounds.left >= header.left - 1 && bounds.right <= header.right + 1 &&
          Math.abs(bounds.top + bounds.height / 2 - center) <= 1
      }),
      hideOrder: !clearLabel || count,
      titleTruncated: text.getBoundingClientRect().width - label.getBoundingClientRect().width >= 0.001,
      clearLabel,
      count,
    }
  })
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
      // Hundreds of steps; under parallel load this exceeds the default 60s budget while still progressing
      test.setTimeout(120_000)
      await setWindowSize(app, page, { width: 1360, height: 850 })
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      await openInterfaceCustomizer(page, 'fullscreen actions')
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
        // The dock only reserves a scrollbar gutter while it scrolls, so use a window short enough to overflow.
        await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
        await setWindowSize(app, page, { width: 382, height: 300 })
        await expectActionsFitPlayer(player)
        await expect(actions).toHaveAttribute('data-overlayscrollbars-viewport')
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await expect(actions.locator(':scope > .os-scrollbar-vertical')).toBeVisible()
        await actions.evaluate(element => { element.scrollTop = 0 })
        await expectImagesLoaded(queue.locator('img:visible'))
        await captureDocks('scrolling-actions')
        await scrollToBottom(actions)
        await watch.evaluate(component => { component.proxy.$store.commit('setEnableDownloads', false) })
        await expect(actions.getByRole('button', { name: 'Download Video', exact: true })).toHaveCount(0)
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await watch.evaluate(component => { component.proxy.$store.commit('setEnableDownloads', true) })
        await expect(actions.getByRole('button', { name: 'Download Video', exact: true })).toBeVisible()
        await scrollToBottom(actions)
        const selectedActions = await watch.evaluate(component => component.proxy.$store.getters.getFullscreenActions)
        await watch.evaluate(component => component.proxy.$store.dispatch('updateFullscreenActions', ['queue', 'share']))
        await expect(actions.locator('.fullscreenActionsContent > *')).toHaveCount(2)
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await watch.evaluate((component, value) => component.proxy.$store.dispatch('updateFullscreenActions', value), selectedActions)
        await expect(actions.getByRole('button', { name: 'Download Video', exact: true })).toBeVisible()
        await scrollToBottom(actions)
        await setWindowSize(app, page, { width: 480, height: 400 })
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await setWindowSize(app, page, { width: 1360, height: 850 })
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await page.mouse.move(0, 0)
        await expectUnifiedDockHeader(queue, '.queueHeader')
        await expect(queueScroller).toHaveAttribute('data-overlayscrollbars-viewport')
        await expect(queue.locator('.queueItem')).toHaveCount(20)
        await queue.locator('.queueItem').filter({ has: page.getByRole('heading', { name: 'Queued video 2', exact: true }) }).getByRole('button', { name: 'More options', exact: true }).click()
        await page.getByRole('menuitem', { name: /^Move video up$/i }).click()
        await expect(queue.locator('.queueItem h3').first()).toHaveText('Queued video 2')
        await queue.locator('.queueItem').filter({ has: page.getByRole('heading', { name: 'Queued video 2', exact: true }) }).getByRole('button', { name: 'More options', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Remove from Queue', exact: true }).click()
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
        await actions.getByRole('button', { name: /^Add to playlist$/i }).click()
        const playlist = page.getByRole('dialog', { name: 'Save to…', exact: true })
        await expect(playlist).toBeVisible()
        await playlist.press('Escape')
        await expect(playlist).toHaveCount(0)
        await expectActionsFitPlayer(player)
        await expect.poll(() => readQueueHeader(queue)).toMatchObject({ oneRow: true, hideOrder: true, titleTruncated: false })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await setWindowSize(app, page, { width: 1360, height: 850 })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await scrollToBottom(queueScroller)
        await expectValidScroll(queueScroller, '.queueItemsContent')
        const expectQueueScrollbarClear = async () => {
          await expect.poll(() => queueScroller.evaluate(element => {
            const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical').getBoundingClientRect()
            const actions = element.querySelector('.queueItemMenu').getBoundingClientRect()
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
        await setWindowSize(app, page, { width: 480, height: 400 })
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
        // Offscreen comments still have lazy image placeholders.
        await expectImagesLoaded(comments.locator('.commentThread').first().locator('img'))
        await queueScroller.evaluate(element => { element.scrollTop = 0 })
        await expectValidScroll(queueScroller, '.queueItemsContent')
        await expect(queueScroller.locator(':scope > .os-scrollbar-vertical')).toBeVisible()
        await captureDocks('queue-comments')
        await scrollToBottom(queueScroller)
        await setWindowSize(app, page, { width: 480, height: 400 })
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
        await setWindowSize(app, page, { width: 382, height: 300 })
        await scrollToBottom(actions)
        await queue.getByRole('button', { name: 'Clear Queue', exact: true }).click()
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await expect(queue).toHaveCount(0)
        await expect(actions.getByRole('button', { name: 'Queue', exact: true })).toHaveCount(0)
        await scrollToBottom(actions)
        await watch.evaluate(component => {
          component.proxy.$store.commit('setForbiddenTitles', JSON.stringify(['Recommended video']))
        })
        await expectValidScroll(actions, '.fullscreenActionsContent')
        await expect(recommendations).toHaveCount(0)
        await expect(actions.getByRole('button', { name: 'Recommended videos', exact: true })).toHaveCount(0)
        await watch.evaluate(component => { component.proxy.$store.commit('setForbiddenTitles', '[]') })
        await expect(actions.getByRole('button', { name: 'Recommended videos', exact: true })).toBeVisible()
        await expect(recommendations).toHaveCount(0)
        await setWindowSize(app, page, { width: 1450, height: 950 })
        await expectValidScroll(actions, '.fullscreenActionsContent')

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

    test('uses saved downloads instead of cached recommendations while offline', async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width: 1360, height: 850 })
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      await mockPlayableWatchPage(app, page)
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await openMockedVideo(page)
      const watch = await page.evaluateHandle(findWatchComponent)
      try {
        await watch.evaluate(component => {
          const watch = component.proxy
          watch.$store.commit('setFullscreenActions', ['recommendations', 'share'])
          watch.$store.commit('upsertYtDlpDownload', {
            id: 1,
            videoId: 'offline0001',
            status: 'completed',
            mode: 'video',
            thumbnail: 'https://i.ytimg.com/vi/offline0001/hqdefault.jpg',
            files: [{ videoId: 'offline0001', title: 'Saved offline video', path: '/offline.webm', extension: 'webm' }],
          })
          watch.recommendedVideos = [{ videoId: 'related0001', title: 'Cached recommendation', author: 'Recommendation channel', type: 'video' }]
          watch.localFilePlayback = false
          watch.$store.commit('setForbiddenTitles', JSON.stringify(['Cached recommendation']))
        })
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
          window.dispatchEvent(new Event('offline'))
        })
        const player = page.locator('.ftVideoPlayer')
        await player.locator('video').evaluate(element => element.pause())
        await setPlayerFullscreen(page, true)
        const action = player.locator('.fullscreenActions').getByRole('button', { name: 'Recommended videos', exact: true })
        const dock = player.locator('.fullscreenRecommendationsOverlay.open')
        await expect.poll(() => watch.evaluate(component => component.proxy.offlineDownloadSuggestions.length)).toBe(1)
        await expect(action).toBeVisible()
        await action.click()
        await expect(dock.getByRole('heading', { name: 'Available offline', exact: true })).toBeVisible()
        await expect(dock.locator('.offlineDownloadRecommendation')).toHaveText(/Saved offline video/)
        await expect(dock.getByText('Cached recommendation', { exact: true })).toHaveCount(0)
        await expectValidScroll(dock.locator('.recommendationsScroller'), '.recommendationsContent')

        await watch.evaluate(component => { component.proxy.$store.commit('setForbiddenTitles', JSON.stringify(['Saved offline video'])) })
        await expect(action).toHaveCount(0)
        await expect(dock).toHaveCount(0)

        await watch.evaluate(component => { component.proxy.$store.commit('setForbiddenTitles', '[]') })
        await action.click()
        await expect(dock.locator('.offlineDownloadRecommendation')).toHaveText(/Saved offline video/)
        await expectImagesLoaded(dock.locator('img:visible'))
        await expect(dock.locator('img:visible')).toHaveAttribute('src', 'https://i.ytimg.com/vi/offline0001/maxresdefault.jpg')
        const bounds = await dock.evaluate(element => {
          const dock = element.getBoundingClientRect()
          const row = element.querySelector('.offlineDownloadRecommendation').getBoundingClientRect()
          return { x: dock.x, y: dock.y, width: dock.width, height: row.bottom - dock.top + 12 }
        })
        const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }, bounds) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents
          const zoom = contents.getZoomFactor()
          const clip = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value * zoom)]))
          return (await contents.capturePage(clip)).toPNG().toString('base64')
        }, bounds)
        await writeFile(testInfo.outputPath(`offline-recommendations-${colorScheme}.png`), Buffer.from(screenshot, 'base64'))
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
          window.dispatchEvent(new Event('online'))
        })
        await expect(dock.getByRole('heading', { name: 'Up Next', exact: true })).toBeVisible()
        await expect(dock.getByText('Cached recommendation', { exact: true }).first()).toBeVisible()
        await expect(dock.locator('.offlineDownloadRecommendation')).toHaveCount(0)
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
          window.dispatchEvent(new Event('offline'))
        })
        await expect(dock.locator('.offlineDownloadRecommendation')).toHaveText(/Saved offline video/)
        await watch.evaluate(component => { component.proxy.$store.commit('removeYtDlpDownload', 1) })
        await expect(action).toHaveCount(0)
        await expect(dock).toHaveCount(0)
      } finally {
        await watch.dispose()
      }
    })
  })
}

test.describe('fullscreen queue header', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

  test('hides the clear label, then the count, to stay one row', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await page.evaluate(() => {
      for (let index = 0; index < 3; index++) {
        window.$store.commit('addVideoToWatchQueue', {
          video: { videoId: `queued0000${index}`, title: `Queued video ${index + 1}`, author: 'Queue channel' }
        })
      }
    })
    await video.evaluate(element => element.pause())
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
    await setWindowSize(app, page, { width: 1360, height: 420 })
    const player = page.locator('.ftVideoPlayer')
    await page.locator('body').press('s')
    await expect(player).toHaveClass(/fullWindow/)
    const watch = await page.evaluateHandle(findWatchComponent)
    try {
      await watch.evaluate(component => component.proxy.$refs.player.setFullscreenQueue(true))
      const queue = player.locator('.fullscreenQueueOverlay.open')
      await expect(queue).toBeVisible()
      await expect.poll(() => readQueueHeader(queue)).toEqual({
        oneRow: true, hideOrder: true, titleTruncated: false, clearLabel: true, count: true
      })

      // The narrowest landscape dock keeps the title by dropping the clear label.
      await setWindowSize(app, page, { width: 650, height: 430 })
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({
        oneRow: true, hideOrder: true, titleTruncated: false, clearLabel: false
      })
      const clear = queue.getByRole('button', { name: 'Clear Queue', exact: true })
      await expect(clear).toHaveAttribute('title', 'Clear Queue')
      const closeBox = await queue.getByRole('button', { name: 'Close', exact: true }).boundingBox()
      for (const action of [clear, queue.getByRole('button', { name: 'Save Queue to Playlist', exact: true })]) {
        const box = await action.boundingBox()
        expect(box.width).toBeCloseTo(closeBox.width, 0)
        expect(box.height).toBeCloseTo(closeBox.height, 0)
      }

      // Hiding the save action leaves room for the count again.
      await setWindowSize(app, page, { width: Math.round(760 * uiScale / 100), height: 440 })
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({ clearLabel: false, count: false })
      await page.evaluate(() => window.$store.dispatch('updateHidePlaylists', true))
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({ oneRow: true, titleTruncated: false, count: true })

      // Font changes resize the title without resizing the header. A wider
      // copy of the bundled font refits once it loads, and switching back
      // refits without any font loading.
      await page.evaluate(() => {
        const rule = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
          .find(rule => rule instanceof CSSFontFaceRule && /geist-latin-wght/.test(rule.style.getPropertyValue('src')))
        const path = rule.style.getPropertyValue('src').match(/url\("?([^")]+)"?\)/)[1]
        const url = new URL(path, rule.parentStyleSheet.href ?? document.baseURI)
        document.fonts.add(new FontFace('Wide Late', `url(${url})`, { sizeAdjust: '150%', weight: '100 900' }))
        return window.$store.dispatch('updateAppFont', 'Wide Late')
      })
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({ oneRow: true, titleTruncated: false, count: false })
      await page.evaluate(() => window.$store.dispatch('updateAppFont', 'Geist Variable'))
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({ oneRow: true, titleTruncated: false, count: true })

      await page.evaluate(() => window.$store.dispatch('updateHidePlaylists', false))
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({ count: false })

      // Longer translations fit again after a locale change.
      await setWindowSize(app, page, { width: 1360, height: 450 })
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({ clearLabel: true, count: true })
      await page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'de-DE'))
      await expect(queue.locator('.queueLabel')).toHaveText('Warteschlange')
      await expect.poll(() => readQueueHeader(queue)).toMatchObject({
        oneRow: true, hideOrder: true, titleTruncated: false, clearLabel: false
      })
    } finally {
      await watch.dispose()
    }
  })
})
