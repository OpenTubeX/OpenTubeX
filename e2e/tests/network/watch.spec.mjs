import { sel } from '../../helpers/app.mjs'
import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

async function openVideo(page) {
  await page.locator(sel.searchInput).fill(VIDEO_URL)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.videoTitle')).toContainText('Me at the zoo', { timeout: 30_000 })
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
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await setPlayerFullscreen(page, true)
    const title = page.locator('.playerFullscreenTitleOverlay')
    await title.click({ force: true })

    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataTarget .videoTitle')).toContainText('Me at the zoo')
    await expect(page.locator('.infoArea .videoTitle')).toHaveCount(0)
    const [videoBounds, metadataBounds] = await Promise.all([
      page.locator('.ftVideoPlayer video.player').boundingBox(),
      page.locator('.fullscreenMetadataOverlay.open').boundingBox()
    ])
    expect(videoBounds.x + videoBounds.width).toBeLessThanOrEqual(metadataBounds.x + 1)

    await page.getByRole('button', { name: 'Show transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptCard')).toBeVisible()
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
