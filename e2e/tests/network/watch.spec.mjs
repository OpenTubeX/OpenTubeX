import { sel } from '../../helpers/app.mjs'
import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const CAPTIONED_VIDEO = {
  id: 'Xf-uUy5pdUI',
  title: 'What’s It Like to Be Killed by Nature’s Most Brutal Predator',
  url: 'https://www.youtube.com/watch?v=Xf-uUy5pdUI'
}

function longTranscript() {
  const timestamp = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    const remainingSeconds = seconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.000`
  }

  return `WEBVTT\n\n${Array.from({ length: 5000 }, (_, index) => (
    `${timestamp(index)} --> ${timestamp(index + 1)}\nTranscript line ${index}.`
  )).join('\n\n')}\n`
}

async function openVideo(page, video = { id: 'jNQXAC9IVRw', title: 'Me at the zoo', url: VIDEO_URL }) {
  await page.locator(sel.searchInput).fill(video.url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${video.id}`))
  await expect(page.locator('.videoTitle')).toContainText(video.title, { timeout: 30_000 })
}

test.describe('watch page', () => {
  test('shows video metadata', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await expect(page.getByText('jawed').first()).toBeVisible()
    await expect(page.locator(sel.activeTab).locator('.tabAvatar')).toBeVisible()
  })

  test('playback starts', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    await expect
      .poll(async () => await video.evaluate((el) => el.currentTime), { timeout: 30_000 })
      .toBeGreaterThan(1)
  })

  test('keeps the context menu open when the pointer leaves a playing video', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    await waitForPlaybackOrSkip(test, page)
    await page.locator('.ftVideoPlayer').click({ button: 'right' })

    const contextMenu = page.locator('.shaka-context-menu')
    await expect(contextMenu).toBeVisible()

    await page.mouse.move(0, 0)
    await page.waitForTimeout(3500)
    await expect(contextMenu).toBeVisible()
  })

  // Regression: playback speed controls stopped working (1c958d468)
  test('keyboard shortcuts change the playback rate', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)

    await page.locator('body').press('p')
    await expect.poll(async () => await video.evaluate((el) => el.playbackRate)).toBeGreaterThan(1)
    const raisedRate = await video.evaluate((el) => el.playbackRate)

    await page.locator('body').press('o')
    await expect.poll(async () => await video.evaluate((el) => el.playbackRate)).toBeLessThan(raisedRate)
  })

  test('long transcripts quickly align with the current cue', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.route(/\/api\/timedtext/, route => route.fulfill({
      body: longTranscript(),
      contentType: 'text/vtt'
    }))
    await openVideo(page, CAPTIONED_VIDEO)
    await waitForPlaybackOrSkip(test, page)

    const video = page.locator('video.player')
    const targetTime = await video.evaluate((element) => {
      element.pause()
      const time = Math.min(3600, Math.floor(element.duration / 2))
      element.currentTime = time
      element.dispatchEvent(new Event('timeupdate'))
      return time
    })
    expect(targetTime).toBeGreaterThan(100)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(100)
    await page.evaluate(() => {
      const nativeScrollTo = Element.prototype.scrollTo
      window.transcriptScrollCalls = []
      Element.prototype.scrollTo = function (...args) {
        if (this.classList.contains('transcriptSegments')) {
          window.transcriptScrollCalls.push({
            behavior: args[0]?.behavior,
            distance: Math.abs(args[0]?.top - this.scrollTop),
            clientHeight: this.clientHeight
          })
        }
        return nativeScrollTo.apply(this, args)
      }
    })

    await page.getByRole('button', { name: 'Show transcript' }).click()
    const activeSegment = page.locator('.transcriptSegment[aria-current="true"]')
    await expect(activeSegment).toBeVisible({ timeout: 30_000 })
    expect(Number(await activeSegment.getAttribute('data-segment-index'))).toBeGreaterThan(100)
    await expect.poll(() => page.evaluate(() => window.transcriptScrollCalls[0])).toBeTruthy()
    const scrollCall = await page.evaluate(() => window.transcriptScrollCalls[0])
    expect(scrollCall.behavior).toBe('smooth')
    expect(scrollCall.distance).toBeLessThanOrEqual(scrollCall.clientHeight)
  })

  test('closing the only sidebar chapter panel keeps it beside the description', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    await page.evaluate(async () => {
      const layout = document.querySelector('.videoLayout')
      const app = document.querySelector('#app')?.__vue_app__
      const findWatchView = (vnode) => {
        if (vnode?.component?.refs?.videoLayout === layout) {
          return vnode.component.proxy
        }
        if (vnode?.component?.subTree) {
          const match = findWatchView(vnode.component.subTree)
          if (match) {
            return match
          }
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = findWatchView(child)
            if (match) {
              return match
            }
          }
        }
        return null
      }
      const watchView = findWatchView(app?._container?._vnode)
      if (!watchView) {
        throw new Error('Unable to access the watch view')
      }

      await watchView.$store.dispatch('updateHideRecommendedVideos', true)
      watchView.useTheatreMode = true
      watchView.videoChapters = [{ title: 'Test chapter', timestamp: '0:00', startSeconds: 0 }]
      watchView.showSidebarChapters = true
      await watchView.$nextTick()
    })

    const layout = page.locator('.videoLayout')
    const panel = page.locator('.watchVideoChaptersPanel')
    await expect(layout).toHaveClass(/useTheatreMode/)
    await expect(panel).toBeVisible()

    await panel.getByRole('button', { name: 'Close Chapters' }).click()
    await expect(panel).toHaveClass(/chapters-panel-leave-active/)

    const leavingLayout = await page.evaluate(() => {
      const layoutElement = document.querySelector('.videoLayout')
      const infoElement = document.querySelector('.infoArea')
      const panelElement = document.querySelector('.watchVideoChaptersPanel')
      const infoBounds = infoElement.getBoundingClientRect()
      const panelBounds = panelElement.getBoundingClientRect()

      return {
        noSidebar: layoutElement.classList.contains('noSidebar'),
        infoRight: infoBounds.right,
        panelLeft: panelBounds.left
      }
    })
    expect(leavingLayout.noSidebar).toBe(false)
    expect(leavingLayout.panelLeft).toBeGreaterThanOrEqual(leavingLayout.infoRight - 1)

    await expect(panel).toHaveCount(0)
    await expect(layout).toHaveClass(/noSidebar/)
  })

  test('comments load on request', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.comment').count()).toBeGreaterThan(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    await expect(page.getByLabel('Loading more comments')).toHaveCount(0)

    // Exercise reply loading and its continuation path, not only the initial
    // top-level comment batch (8bcf0b58d).
    const replyToggle = page.locator('.commentMoreReplies').first()
    await expect(replyToggle).toBeVisible()
    await replyToggle.click()
    const replies = page.locator('.commentReplyBranch')
    await expect(replies.first()).toBeVisible({ timeout: 30_000 })

    const showMoreReplies = page.locator('.showMoreReplies').first()
    await expect(showMoreReplies).toBeVisible()
    const [continuationResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST' &&
        response.url().includes('/youtubei/v1/next')
      )),
      showMoreReplies.click()
    ])
    expect(continuationResponse.ok()).toBe(true)
    await expect(replies.first()).toBeVisible()
  })

  test('fullscreen comments dock preserves its active state and scroll position', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)
    await comments.evaluate((element) => { element.scrollTop = 300 })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)

    await page.locator('.fullscreenCommentHeader .fullscreenCommentAction').last().click()
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)

    await setPlayerFullscreen(page, false)
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)
  })

  test('fullscreen title opens the video information dock', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.route(/\/api\/timedtext/, route => route.fulfill({
      body: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTest transcript line.\n',
      contentType: 'text/vtt'
    }))
    await openVideo(page, CAPTIONED_VIDEO)
    await waitForPlaybackOrSkip(test, page)

    await setPlayerFullscreen(page, true)
    const title = page.locator('.playerFullscreenTitleOverlay')
    const titleBounds = await title.boundingBox()
    const playerBounds = await page.locator('.ftVideoPlayer').boundingBox()
    const titleRight = titleBounds.x + titleBounds.width
    const besideTitleX = titleRight + (playerBounds.x + playerBounds.width - titleRight) / 2
    const titleCenterY = titleBounds.y + titleBounds.height / 2

    await page.mouse.dblclick(besideTitleX, titleCenterY)
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(false)

    await setPlayerFullscreen(page, true)
    await page.mouse.move(titleBounds.x + titleBounds.width / 2, titleCenterY)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.waitForTimeout(100)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(true)

    await title.click({ force: true })

    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataTarget .videoTitle')).toContainText(CAPTIONED_VIDEO.title)
    await expect(page.locator('.fullscreenMetadataTarget .shareButton')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataTarget .quickBookmarkVideoIcon')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataTarget').getByRole('button', { name: 'Add to playlist' })).toHaveCount(0)
    await expect(page.locator('.fullscreenActions .fullscreenShareAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenPlaylistAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenQuickBookmarkAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle')).toHaveCount(1)
    await expect(page.locator('.fullscreenMetadataTarget').getByRole('button', { name: 'Show transcript' })).toHaveCount(0)
    const dockDescription = page.locator('.fullscreenMetadataTarget .videoDescription')
    await expect(dockDescription).toHaveClass(/alwaysExpanded/)
    await expect(dockDescription).not.toHaveClass(/short/)
    await expect(dockDescription.locator('.descriptionCloseButton, .descriptionStatus')).toHaveCount(0)
    await expect(page.locator('.infoArea .videoTitle')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataHeader')).not.toHaveCSS('cursor', 'grab')
    const playerVideo = page.locator('.ftVideoPlayer video.player')
    const metadataDock = page.locator('.fullscreenMetadataOverlay.open')
    await expect.poll(async () => {
      const [currentVideoBounds, currentMetadataBounds] = await Promise.all([
        playerVideo.boundingBox(),
        metadataDock.boundingBox()
      ])
      return currentVideoBounds.x + currentVideoBounds.width - currentMetadataBounds.x
    }).toBeLessThanOrEqual(1)
    await page.locator('.fullscreenActions').getByRole('button', { name: 'Show transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataHeader')).toHaveCSS('cursor', 'grab')
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptCard')).toBeVisible()
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptSegment').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptActions .iconButton')).toHaveCount(2)

    const transcriptDock = page.locator('.fullscreenTranscriptOverlay.open')
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return Math.abs(metadataBox.height - transcriptBox.height)
    }).toBeLessThan(5)
    const [stackedMetadataBounds, transcriptBounds] = await Promise.all([
      metadataDock.boundingBox(),
      transcriptDock.boundingBox()
    ])
    const resizeHandle = metadataDock.locator('.fullscreenDockResizeHandle')
    const resizeHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      resizeHandleBounds.x + resizeHandleBounds.width / 2,
      resizeHandleBounds.y + resizeHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.locator('.ftVideoPlayer').evaluate(element => element.classList.add('no-cursor'))
    await expect(page.locator('.ftVideoPlayer')).toHaveCSS('cursor', 'row-resize')
    await expect(metadataDock).toHaveCSS('transition-duration', '0s')
    await page.mouse.move(resizeHandleBounds.x + resizeHandleBounds.width / 2, resizeHandleBounds.y + 100)
    await page.mouse.up()
    await page.locator('.ftVideoPlayer').evaluate(element => element.classList.remove('no-cursor'))
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThan(stackedMetadataBounds.height + 60)
    await expect.poll(async () => (await transcriptDock.boundingBox()).height)
      .toBeLessThan(transcriptBounds.height - 60)

    const resizedMetadataHeight = (await metadataDock.boundingBox()).height
    await resizeHandle.press('ArrowUp')
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeLessThan(resizedMetadataHeight)

    const [currentHandleBounds, fullscreenPlayerBounds] = await Promise.all([
      resizeHandle.boundingBox(),
      page.locator('.ftVideoPlayer').boundingBox()
    ])
    await page.mouse.move(
      currentHandleBounds.x + currentHandleBounds.width / 2,
      currentHandleBounds.y + currentHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      currentHandleBounds.x + currentHandleBounds.width / 2,
      fullscreenPlayerBounds.y + fullscreenPlayerBounds.height - 1
    )
    await page.mouse.up()
    await expect.poll(async () => (await transcriptDock.boundingBox()).height)
      .toBeGreaterThanOrEqual(360)

    const fullscreenPlayer = page.locator('.ftVideoPlayer')
    await fullscreenPlayer.evaluate(element => {
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: 700 })
    })
    await expect.poll(async () => fullscreenPlayer.evaluate(element => element.clientHeight)).toBe(700)
    const denseStackMetadataHeight = (await metadataDock.boundingBox()).height
    const denseStackHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      denseStackHandleBounds.x + denseStackHandleBounds.width / 2,
      denseStackHandleBounds.y + denseStackHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      denseStackHandleBounds.x + denseStackHandleBounds.width / 2,
      denseStackHandleBounds.y + 60
    )
    await page.mouse.up()
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThan(denseStackMetadataHeight + 20)
    await resizeHandle.dblclick({ force: true })
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return Math.abs(metadataBox.height - transcriptBox.height)
    }).toBeLessThan(5)
    await fullscreenPlayer.evaluate(element => { delete element.clientHeight })
    await expect.poll(async () => fullscreenPlayer.evaluate(element => element.clientHeight)).toBeGreaterThan(700)

    const metadataHeader = metadataDock.locator('.fullscreenMetadataHeader')
    const transcriptHeader = transcriptDock.locator('.transcriptHeader')
    const expandedMetadataHeight = (await metadataDock.boundingBox()).height
    await metadataHeader.dblclick({ position: { x: 30, y: 26 } })
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThanOrEqual(60)
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeLessThan(61)
    await metadataHeader.dblclick({ position: { x: 30, y: 26 } })
    await expect.poll(async () => Math.abs((await metadataDock.boundingBox()).height - expandedMetadataHeight))
      .toBeLessThan(2)

    const [metadataHeaderBounds, transcriptHeaderBounds] = await Promise.all([
      metadataHeader.boundingBox(),
      transcriptHeader.boundingBox()
    ])
    await page.mouse.move(
      transcriptHeaderBounds.x + 30,
      transcriptHeaderBounds.y + transcriptHeaderBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      metadataHeaderBounds.x + 30,
      metadataHeaderBounds.y + 10,
      { steps: 5 }
    )
    await page.mouse.up()
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return transcriptBox.y < metadataBox.y
    }).toBe(true)

    const [reorderedMetadataBounds, reorderedTranscriptHeaderBounds] = await Promise.all([
      metadataDock.boundingBox(),
      transcriptHeader.boundingBox()
    ])
    await page.mouse.move(
      reorderedTranscriptHeaderBounds.x + 30,
      reorderedTranscriptHeaderBounds.y + reorderedTranscriptHeaderBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      reorderedMetadataBounds.x + 30,
      reorderedMetadataBounds.y + reorderedMetadataBounds.height - 10,
      { steps: 5 }
    )
    await page.mouse.up()
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return metadataBox.y < transcriptBox.y
    }).toBe(true)

    await page.getByRole('button', { name: 'Close transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toHaveCount(0)

    await setPlayerFullscreen(page, false)
    await expect(page.locator('.infoArea .videoTitle')).toBeVisible()
    const inlineDescription = page.locator('.infoArea .videoDescription')
    await expect(inlineDescription).not.toHaveClass(/alwaysExpanded/)
    await expect(inlineDescription.locator('.descriptionCloseButton, .descriptionStatus')).not.toHaveCount(0)
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    await page.getByRole('button', { name: 'Close video information' }).click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
  })

  test('fullscreen player overlays appear above the action pill', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await setPlayerFullscreen(page, true)
    const actions = page.locator('.fullscreenActions')
    const seekBar = page.locator('.shaka-seek-bar-container')
    const fullscreenButton = page.locator('.shaka-fullscreen-button')

    await expect(actions).toBeVisible()
    await expect(actions).toHaveCSS('z-index', '2')
    await fullscreenButton.hover()
    await expect(fullscreenButton).toHaveClass(/shaka-tooltip/)
    await expect(actions).toHaveCSS('z-index', '0')
    const seekBarBounds = await seekBar.boundingBox()
    await page.mouse.move(
      seekBarBounds.x + (seekBarBounds.width / 2),
      seekBarBounds.y + (seekBarBounds.height / 2)
    )
    await expect(actions).toHaveCSS('z-index', '0')
  })

  test('full window playlist action shows its prompt above the player', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await page.locator('.full-window-button').click({ force: true })
    await expect(page.locator('.ftVideoPlayer.fullWindow')).toBeVisible()
    await page.locator('.fullscreenPlaylistAction').click({ force: true })

    const prompt = page.locator('.prompt')
    await expect(prompt.getByText('Select a playlist to add your video to')).toBeVisible()
    await prompt.getByRole('button', { name: 'Cancel' }).click()

    await page.locator('.fullscreenQuickBookmarkAction').click({ force: true })
    const toastHolder = page.locator('.toast-holder')
    await expect(toastHolder.locator('.toast')).toBeVisible()
    expect(await toastHolder.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(1000)
  })

  // Regression: edited comments show their "(edited)" marker (929369543)
  test('edited comments carry the edited badge', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    // The comment ranking is not deterministic, so load a few batches and
    // only assert the badge when an edited comment actually shows up.
    const editedBadge = page.locator('.commentDate', { hasText: '(edited)' })
    for (let i = 0; i < 3 && (await editedBadge.count()) === 0; i++) {
      const showMore = page.locator('.getMoreComments')
      if (await showMore.count() === 0) { break }
      await showMore.scrollIntoViewIfNeeded()
      await showMore.click()
      await page.waitForTimeout(2000)
    }

    test.skip(await editedBadge.count() === 0, 'no edited comments in the loaded batches')
    await expect(editedBadge.first()).toBeVisible()
  })
})
