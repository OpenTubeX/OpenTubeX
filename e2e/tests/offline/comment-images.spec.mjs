import { readFile } from 'node:fs/promises'
import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

const attachments = [[300, 300], [120, 240]].map(([width, height], index) => ({
  width,
  height,
  image: {
    sources: [{ url: `https://i.ytimg.com/c_exp/test/animation-${index}.webp?rs=signed`, width, height }],
    imageFormatHint: 'IMAGE_FORMAT_ANIMATED_WEBP'
  },
  unavailableText: 'GIF unavailable',
  rendererContext: { accessibilityContext: { label: 'Comment image attachment' } }
}))

test('renders animated attachments in empty comments, text comments and replies without overflow', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page, { commentImages: attachments })
  await page.route('https://i.ytimg.com/c_exp/**', async route => route.fulfill({
    contentType: 'image/webp',
    body: await readFile(new URL(`../../fixtures/media/comment-animation${route.request().url().includes('animation-1') ? '-portrait' : ''}.webp`, import.meta.url))
  }))
  await openMockedVideo(page)
  await page.mouse.move(0, 0)
  const images = page.locator('.commentImageAttachment img:not(.retryImagePlaceholder)')
  const firstAttachment = page.locator('.commentImageAttachment').first()
  await firstAttachment.scrollIntoViewIfNeeded()
  await expectImagesLoaded(images)
  await expect(firstAttachment).toHaveClass(/commentAttachmentReady/)
  await expect(images.first()).toHaveAttribute('src', attachments[0].image.sources[0].url)
  await expect(page.locator('.commentText').first()).toHaveText('')
  await expect(page.locator('.commentText').nth(1)).not.toHaveText('')
  const portrait = page.locator('.commentAttachmentPoster').nth(1)
  await expect.poll(() => portrait.evaluate(image => {
    const { width, height } = image.getBoundingClientRect()
    return width / height
  })).toBeCloseTo(120 / 240, 2)

  const poster = firstAttachment.locator('canvas')
  const stillFrame = await poster.screenshot()
  await page.waitForTimeout(250)
  expect(await poster.screenshot()).toEqual(stillFrame)
  await expect(images.first()).toBeHidden()
  await firstAttachment.hover()
  await expect(poster).toBeHidden()
  await expect(images.first()).toBeVisible()
  const bounds = await images.first().boundingBox()
  const clip = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)]))
  // CDP screenshots capture an animated image's default frame. Capture the
  // compositor through Electron to verify that the hovered image is moving.
  const captureAnimation = () => app.electronApp.evaluate(async ({ BrowserWindow }, clip) => (
    await BrowserWindow.getAllWindows()[0].webContents.capturePage(clip)
  ).toPNG().toString('base64'), clip)
  const animatedFrame = await captureAnimation()
  await expect.poll(captureAnimation).not.toBe(animatedFrame)
  await page.mouse.move(0, 0)
  await expect(images.first()).toBeHidden()
  expect(await poster.screenshot()).toEqual(stillFrame)

  const thread = page.locator('.commentThread').first()
  await thread.locator('.commentReplyRootToggle button').click()
  const replyImage = page.locator('.commentReplyContent .commentImageAttachment img:not(.retryImagePlaceholder)').first()
  await expectImagesLoaded(replyImage)

  for (const uiScale of [1, 1.25]) {
    for (const width of [1280, 360]) {
      await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.webContents.setZoomFactor(uiScale)
        window.setContentSize(Math.round(width * uiScale), Math.round(900 * uiScale))
      }, { width, uiScale })
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
      if (width === 360) {
        await page.locator('.phoneCommentsOpen').click()
        await expect(page.locator('.mobileSheet[open]')).toBeVisible()
      }
      const visiblePosters = page.locator('.commentAttachmentPoster:visible')
      await expect(visiblePosters.first()).toBeVisible()
      expect(await visiblePosters.evaluateAll(elements => elements.every(image => {
        const rect = image.getBoundingClientRect()
        const parent = image.closest('.comment').getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.right <= parent.right + 1 && rect.height <= 128.5
      }))).toBe(true)
      if (width === 360) {
        await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
      }
    }
  }
  await testInfo.attach('comment attachments', { body: await page.screenshot(), contentType: 'image/png' })
})

test('shows the supplied unavailable message when an attachment has no usable image', async ({ app, page }) => {
  const unavailable = structuredClone(attachments[0])
  unavailable.image.sources = [{ url: 'javascript:alert(1)' }]
  await mockPlayableWatchPage(app, page, { commentImages: [unavailable] })
  await openMockedVideo(page)
  const attachment = page.locator('.commentImageAttachment').first()
  await expect(attachment).toHaveText('GIF unavailable')
  await expect(attachment.locator('img')).toHaveCount(0)
})

test('keeps pinned GIF comments and replies visible when a reload omits them', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { commentImages: attachments })
  await page.route('https://i.ytimg.com/c_exp/**', async route => route.fulfill({
    contentType: 'image/webp',
    body: await readFile(new URL(`../../fixtures/media/comment-animation${route.request().url().includes('animation-1') ? '-portrait' : ''}.webp`, import.meta.url))
  }))
  await openMockedVideo(page)
  const thread = page.locator('.commentThread').first()
  await thread.locator('.commentPinButton').first().click()
  await thread.locator('.commentReplyRootToggle button').click()
  const reply = thread.locator('.commentReplyContent').first()
  await expect(reply.locator('.commentAttachmentReady')).toBeAttached()
  await reply.locator('.commentPinButton').click()

  const persistedPins = await page.evaluate(() => JSON.parse(localStorage.getItem('opentubex-comment-pins')))
  const snapshots = Object.values(persistedPins).flatMap(state => state.commentSnapshots)
  expect(snapshots[0].imageAttachment.image.sources[0].url).toBe(attachments[0].image.sources[0].url)
  expect(snapshots[0].replies[0].imageAttachment.image.sources[0].url).toBe(attachments[0].image.sources[0].url)

  await page.route('**/youtubei/v1/next*', (route, request) => {
    if (!JSON.parse(request.postData() ?? '{}').continuation) return route.fallback()
    return route.fulfill({
      json: {
        onResponseReceivedEndpoints: [
          { reloadContinuationItemsCommand: { continuationItems: [{ commentsHeaderRenderer: {} }] } },
          { reloadContinuationItemsCommand: { continuationItems: [] } }
        ],
        frameworkUpdates: { entityBatchUpdate: { mutations: [] } }
      }
    })
  })
  await page.locator('.reloadComments').click()
  await expect(page.locator('.commentThread')).toHaveCount(1)
  await expect(page.locator('.commentPersonalPin')).toHaveCount(2)
  await expect(page.locator('.commentThread > .commentAttachmentReady')).toBeAttached()
  await expect(page.locator('.commentReplyContent .commentAttachmentReady').first()).toBeAttached()
  await expect(page.locator('.commentThread > .commentImageAttachment canvas')).toBeVisible()
  await expect(page.locator('.commentThread > .commentImageAttachment .commentAttachmentAnimation')).toBeHidden()
})
