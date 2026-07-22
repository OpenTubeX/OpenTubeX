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

  test('comments load on request', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.comment').count()).toBeGreaterThan(0)

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

    await page.mouse.move(besideTitleX, titleCenterY)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.waitForTimeout(100)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(false)

    await setPlayerFullscreen(page, true)
    await page.mouse.move(titleBounds.x + titleBounds.width - 2, titleCenterY)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await expect(title).toHaveAttribute('aria-expanded', 'true')

    await page.mouse.move(titleBounds.x + titleBounds.width + 4, titleCenterY)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.waitForTimeout(100)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(false)

    await setPlayerFullscreen(page, true)
    await page.mouse.move(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.waitForTimeout(100)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(true)

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
    const [videoBounds, metadataBounds] = await Promise.all([
      page.locator('.ftVideoPlayer video.player').boundingBox(),
      page.locator('.fullscreenMetadataOverlay.open').boundingBox()
    ])
    expect(videoBounds.x + videoBounds.width).toBeLessThanOrEqual(metadataBounds.x + 1)

    await page.locator('.fullscreenActions').getByRole('button', { name: 'Show transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptCard')).toBeVisible()
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptSegment').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptActions .iconButton')).toHaveCount(2)
    await page.getByRole('button', { name: 'Close transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toHaveCount(0)

    await setPlayerFullscreen(page, false)
    await expect(page.locator('.infoArea .videoTitle')).toBeVisible()
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    await page.getByRole('button', { name: 'Close video information' }).click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
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
