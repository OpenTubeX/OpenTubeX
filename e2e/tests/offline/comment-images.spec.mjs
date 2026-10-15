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

test('keeps hovered attachments still when reduced motion is enabled', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page, { commentImages: attachments })
  await page.route('https://i.ytimg.com/c_exp/**', async route => route.fulfill({
    contentType: 'image/webp',
    body: await readFile(new URL('../../fixtures/media/comment-animation.webp', import.meta.url))
  }))
  await openMockedVideo(page)
  const attachment = page.locator('.commentImageAttachment').first()
  await attachment.scrollIntoViewIfNeeded()
  await expect(attachment).toHaveClass(/commentAttachmentReady/)
  await attachment.hover()
  const poster = attachment.locator('canvas')
  const animation = attachment.locator('.commentAttachmentAnimation')

  for (const [preference, system, reduce] of [
    ['on', 'no-preference', true],
    ['off', 'reduce', false],
    ['system', 'reduce', true],
    ['system', 'no-preference', false]
  ]) {
    await page.emulateMedia({ reducedMotion: system })
    await page.evaluate(preference => window.$store.dispatch('updateReducedMotion', preference), preference)
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', reduce ? 'reduce' : 'no-preference')
    await attachment.hover()
    if (reduce) {
      await expect(poster).toBeVisible()
      await expect(animation).toBeHidden()
      const stillFrame = await poster.screenshot({ path: testInfo.outputPath('reduced-motion-preview.png') })
      await page.waitForTimeout(250)
      expect(await poster.screenshot()).toEqual(stillFrame)
      await testInfo.attach('reduced motion preview', { body: stillFrame, contentType: 'image/png' })
    } else {
      await expect(poster).toBeHidden()
      await expect(animation).toBeVisible()
    }
  }
  await page.mouse.move(0, 0)
  await expect(poster).toBeVisible()
  await expect(animation).toBeHidden()
})

test('redraws the still frame when attachment dimensions change without a new URL', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { commentImages: attachments })
  await page.route('https://i.ytimg.com/c_exp/**', async route => route.fulfill({
    contentType: 'image/webp',
    body: await readFile(new URL('../../fixtures/media/comment-animation.webp', import.meta.url))
  }))
  await openMockedVideo(page)
  await page.mouse.move(0, 0)
  const attachment = page.locator('.commentImageAttachment').first()
  await attachment.scrollIntoViewIfNeeded()
  await expect(attachment).toHaveClass(/commentAttachmentReady/)
  const canvas = attachment.locator('canvas')
  // A drawn cross-origin image taints the canvas. Resizing clears both the
  // bitmap and the taint, so successful pixel reads reveal a blank poster.
  const hasDrawnImage = () => canvas.evaluate(element => {
    try {
      element.getContext('2d').getImageData(0, 0, 1, 1)
      return false
    } catch (error) {
      if (error.name !== 'SecurityError') throw error
      return true
    }
  })
  expect(await hasDrawnImage()).toBe(true)
  await page.evaluate(() => {
    const findAttachment = vnode => {
      if (vnode.component?.type.__name === 'CommentImageAttachment') return vnode.component
      if (vnode.component) return findAttachment(vnode.component.subTree)
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
          const found = findAttachment(child)
          if (found) return found
        }
      }
    }
    const component = findAttachment(document.querySelector('#app')._vnode)
    const attachment = JSON.parse(JSON.stringify(component.props.attachment))
    attachment.image.sources[0].width = 150
    component.props.attachment = attachment
  })
  await expect(canvas).toHaveAttribute('width', '64')
  expect(await hasDrawnImage()).toBe(true)
  await expect(canvas).toBeVisible()
  await attachment.hover()
  await expect(attachment.locator('img:not(.retryImagePlaceholder)')).toBeVisible()
  await expect(canvas).toBeHidden()
  await page.mouse.move(0, 0)
  await expect(canvas).toBeVisible()
  expect(await hasDrawnImage()).toBe(true)
})

for (const unavailableText of [undefined, '']) {
  test(`shows a localized fallback after an image fails without ${unavailableText === undefined ? 'supplied' : 'nonempty'} unavailable text`, async ({ app, page }, testInfo) => {
    const attachmentData = { ...attachments[0], unavailableText }
    await mockPlayableWatchPage(app, page, { commentImages: [attachmentData] })
    await page.route('https://i.ytimg.com/c_exp/**', route => route.fulfill({ status: 404, body: '' }))
    await openMockedVideo(page)
    const attachment = page.locator('.commentImageAttachment').first()
    await attachment.scrollIntoViewIfNeeded()
    await expect(attachment).toHaveText('Image unavailable')
    const screenshotPath = testInfo.outputPath('attachment-unavailable.png')
    await attachment.screenshot({ path: screenshotPath })
    await testInfo.attach('unavailable attachment', { path: screenshotPath, contentType: 'image/png' })
  })
}

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
