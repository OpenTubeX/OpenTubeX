import { readFile } from 'node:fs/promises'

import { test, expect, setWindowSize, setPlayerFullscreen, sel } from '../../helpers/app.mjs'
import { findWatchComponent } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { demoPlayerResponse, routeDemoMedia } from '../../helpers/media.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const current = 'jNQXAC9IVRw'
const previous = 'previous123'
const next = 'nextshort12'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    }
  }
})

async function openShorts({ app, page }, zoom = 1, phone = false) {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page, await readFile(new URL('../../fixtures/media/short-demo.webm', import.meta.url)))
  await page.route('**/youtubei/v1/player**', route => {
    const id = JSON.parse(route.request().postData()).videoId
    const response = demoPlayerResponse(id)
    Object.assign(response.streamingData.formats[0], { width: 360, height: 640 })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
  })
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${current}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator('.ftVideoPlayer.shortsPlayer')).toBeVisible()
  await setWindowSize(app, page, { width: 390, height: 800 })
  await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    const store = component.proxy.$store
    const channelId = 'UC-short-swipe'
    const profile = JSON.parse(JSON.stringify(store.getters.getActiveProfile))
    await store.dispatch('updateProfile', { ...profile, subscriptions: [{ id: channelId, name: 'Swipe test', thumbnail: '' }] })
    await store.dispatch('updateSubscriptionShortsCacheByChannel', {
      channelId,
      videos: ['previous123', 'jNQXAC9IVRw', 'nextshort12'].map((videoId, index) => ({
        videoId,
        title: `Short ${index + 1}`,
        authorId: channelId,
        isShort: true,
        published: 3 - index,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      }))
    })
  })
  await expect.poll(() => watch.evaluate(component => component.proxy.hasNextSubscriptionShort)).toBe(true)
  await expect.poll(() => page.locator('.ftVideoPlayer video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
  if (phone) await page.evaluate(() => document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs'))
  const cdp = await page.context().newCDPSession(page)
  const bounds = await page.locator('.shortsSwipeViewport').boundingBox()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const touch = async (type, dx = 0, dy = 0) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ x: point.x + dx, y: point.y + dy }]
    })
  }
  return { watch, touch, bounds, cdp }
}

for (const [zoom, phone] of [[1, false], [1.25, false], [1, true]]) {
  test(`Shorts follow the finger and finish swipes in both directions at ${zoom * 100}% UI scale${phone ? ' in phone layout' : ''}`, async ({ app, page }) => {
    const { watch, touch, bounds, cdp } = await openShorts({ app, page }, zoom, phone)
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await touch('touchStart')
    await touch('touchMove', 0, -80)
    await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y - 80, 0)
    await touch('touchMove', 0, -120)
    await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y - 120, 0)
    await expect.poll(async () => (await page.locator('.shortsSwipePreview').boundingBox()).y).toBeCloseTo(bounds.y + bounds.height - 120, 0)
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await touch('touchEnd')
    await expect(page).toHaveURL(new RegExp(`/watch/${next}`))
    await expect(player).toBeVisible()
    await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
    await expect(page.locator('.shortsSwipePreview')).toHaveCount(0)
    await expect.poll(() => watch.evaluate(component => Date.now() >= component.proxy.shortsNavigationLockedUntil)).toBe(true)
    await touch('touchStart')
    await touch('touchMove', 0, 120)
    await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y + 120, 0)
    await touch('touchEnd')
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await expect(player).toBeVisible()
    await watch.dispose()
    await cdp.detach()
  })
}

test('Shorts snap back on short, reversed, horizontal, and cancelled drags without toggling playback', async ({ app, page }) => {
  const { watch, touch, bounds, cdp } = await openShorts({ app, page })
  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const expectRestored = async () => {
    await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y, 0)
    await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)
  }
  await touch('touchStart')
  await touch('touchMove', 0, -30)
  await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y - 30, 0)
  await touch('touchEnd')
  await expectRestored()
  await touch('touchStart')
  await touch('touchMove', 0, -120)
  await touch('touchMove', 0, 30)
  await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y + 30, 0)
  await touch('touchEnd')
  await expectRestored()
  await touch('touchStart')
  await touch('touchMove', 60, -20)
  await touch('touchEnd')
  await expectRestored()
  await touch('touchStart')
  await touch('touchMove', 0, -120)
  await touch('touchCancel')
  await expectRestored()
  await watch.dispose()
  await cdp.detach()
})

test('Shorts resist dragging past feed boundaries and respect reduced motion', async ({ app, page }) => {
  const { watch, touch, bounds, cdp } = await openShorts({ app, page })
  await watch.evaluate(component => {
    component.proxy.navigateSubscriptionShort(-1)
  })
  await expect(page).toHaveURL(new RegExp(`/watch/${previous}`))
  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  await expect(player).toBeVisible()
  await expect.poll(() => watch.evaluate(component => Date.now() >= component.proxy.shortsNavigationLockedUntil)).toBe(true)
  await touch('touchStart')
  await touch('touchMove', 0, 120)
  const moved = (await player.boundingBox()).y - bounds.y
  expect(moved).toBeGreaterThan(0)
  expect(moved).toBeLessThan(60)
  await touch('touchEnd')
  await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y, 0)
  await expect(page).toHaveURL(new RegExp(`/watch/${previous}`))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await touch('touchStart')
  await touch('touchMove', 0, -120)
  await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y - 120, 0)
  await touch('touchEnd')
  await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
  await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
  await watch.dispose()
  await cdp.detach()
})

test('Shorts controls keep touch and keyboard actions after a cancelled swipe', async ({ app, page }) => {
  const { watch, touch, cdp } = await openShorts({ app, page })
  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  await touch('touchStart')
  await touch('touchMove', 0, -120)
  await touch('touchCancel')
  await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
  const play = player.locator('.shortsTopControl').first()
  await play.focus()
  await play.press('Enter')
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(false)
  const box = await play.boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
  await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipePointer)).toBeNull()
  await watch.dispose()
  await cdp.detach()
})

test('resizing during a Shorts drag cancels navigation and restores the player', async ({ app, page }) => {
  const { watch, touch, cdp } = await openShorts({ app, page })
  await touch('touchStart')
  await touch('touchMove', 0, -120)
  await setWindowSize(app, page, { width: 720, height: 820 })
  await touch('touchEnd')
  await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
  await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipePointer)).toBeNull()
  await expect(page.locator('.shortsSwipePreview')).toHaveCount(0)
  await expect(page.locator('.ftVideoPlayer')).toHaveCSS('transform', 'none')
  await watch.dispose()
  await cdp.detach()
})

for (const mode of ['fullwindow', 'fullscreen']) {
  test(`Shorts follow the finger without shrinking in ${mode}`, async ({ app, page }, testInfo) => {
    const { watch, cdp } = await openShorts({ app, page })
    const theme = mode === 'fullwindow' ? 'dark' : 'light'
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(theme))
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    if (mode === 'fullscreen') await setPlayerFullscreen(page, true)
    else await player.locator('.full-window-button').evaluate(button => button.click())
    await expect.poll(() => player.evaluate(element => element.getAnimations().length)).toBe(0)
    const bounds = await player.boundingBox()
    const touch = (type, dy = 0) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: ['touchEnd', 'touchCancel'].includes(type)
        ? []
        : [{
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2 + dy
          }]
    })
    await touch('touchStart')
    await touch('touchMove', -120)
    // Playback updates re-render the player's classes while the drag is active.
    await player.locator('video').evaluate(video => video.play())
    await expect(player).not.toHaveClass(/\bplayerPaused\b/)
    await expect.poll(async () => (await player.locator('video').boundingBox()).y).toBeCloseTo(bounds.y - 120, 0)
    const draggingBounds = await player.boundingBox()
    expect(draggingBounds.width).toBeCloseTo(bounds.width, 0)
    expect(draggingBounds.height).toBeCloseTo(bounds.height, 0)
    await expect.poll(async () => (await player.locator('.shortsSwipePreview').boundingBox()).y).toBeCloseTo(bounds.y + bounds.height - 120, 0)
    await player.locator('video').evaluate(video => video.pause())
    await expect(player).toHaveClass(/\bplayerPaused\b/)
    await expect.poll(async () => (await player.locator('video').boundingBox()).y).toBeCloseTo(bounds.y - 120, 0)
    await expect.poll(() => player.locator('.shortsSwipePreview img:not(.retryImagePlaceholder)')
      .evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    const screenshotPath = testInfo.outputPath('expanded-swipe.png')
    await page.screenshot({ path: screenshotPath, clip: bounds })
    await testInfo.attach('Expanded Shorts swipe after playback updates', { path: screenshotPath, contentType: 'image/png' })
    await touch('touchCancel')
    await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
    await expect.poll(async () => (await player.locator('video').boundingBox()).y).toBeCloseTo(bounds.y, 0)
    await touch('touchStart')
    await touch('touchMove', -120)
    await touch('touchEnd')
    await expect(page).toHaveURL(new RegExp(`/watch/${next}`))
    await expect(player).toBeVisible()
    await watch.dispose()
    await cdp.detach()
  })
}

for (const state of ['error', 'upcoming']) {
  test(`Shorts ${state} cards follow the finger and allow navigation`, async ({ app, page }) => {
    const { watch, touch, cdp } = await openShorts({ app, page })
    await watch.evaluate((component, state) => {
      if (state === 'error') component.proxy.errorMessage = 'Playback failed.'
      else {
        component.proxy.isUpcoming = true
        component.proxy.playabilityStatus = 'LIVE_STREAM_OFFLINE'
      }
    }, state)
    const card = page.locator(state === 'error' ? '.videoPlayerError' : '.videoPlayer:has(.premiereDate)')
    await expect(card).toBeVisible()
    const bounds = await card.boundingBox()
    // Start above the centered error actions so the gesture does not target a button.
    const startY = -bounds.height / 4
    await touch('touchStart', 0, startY)
    await touch('touchMove', 0, startY - 120)
    await expect.poll(async () => (await card.boundingBox()).y).toBeCloseTo(bounds.y - 120, 0)
    await expect.poll(async () => (await page.locator('.shortsSwipePreview').boundingBox()).width).toBeCloseTo(bounds.width, 0)
    await touch('touchCancel')
    await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
    await expect.poll(async () => (await card.boundingBox()).y).toBeCloseTo(bounds.y, 0)
    await touch('touchStart', 0, startY)
    await touch('touchMove', 0, startY - 120)
    await touch('touchEnd')
    await expect(page).toHaveURL(new RegExp(`/watch/${next}`))
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    await watch.dispose()
    await cdp.detach()
  })
}

for (const [zoom, theme] of [[1, 'dark'], [1.25, 'light']]) {
  test(`landscape Shorts swipe previews match the portrait player at ${zoom * 100}% UI scale in ${theme} theme`, async ({ app, page }, testInfo) => {
    const { watch, cdp } = await openShorts({ app, page }, zoom)
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(theme))
    await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout'))
    await setWindowSize(app, page, { width: 915, height: 412 })
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const bounds = await player.boundingBox()
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 - 80 }]
    })
    await expect.poll(async () => (await player.boundingBox()).y).toBeCloseTo(bounds.y - 80, 0)
    const preview = page.locator('.shortsSwipePreview')
    await expect.poll(async () => (await preview.boundingBox()).width).toBeCloseTo(bounds.width, 0)
    const previewBounds = await preview.boundingBox()
    expect(previewBounds.x).toBeCloseTo(bounds.x, 0)
    expect(previewBounds.height).toBeCloseTo(bounds.height, 0)
    expect(previewBounds.y).toBeCloseTo(bounds.y + bounds.height - 80, 0)
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await expect.poll(() => preview.locator('img:not(.retryImagePlaceholder)').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    const screenshotPath = testInfo.outputPath('landscape-swipe.png')
    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: (bounds.x - 8) * zoom,
        y: (bounds.y - 8) * zoom,
        width: (bounds.width + 16) * zoom,
        height: (bounds.height + 16) * zoom
      }
    })
    await testInfo.attach('Landscape Shorts swipe', { path: screenshotPath, contentType: 'image/png' })
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page).toHaveURL(new RegExp(`/watch/${next}`))
    await expect(player).toBeVisible()
    await watch.dispose()
    await cdp.detach()
  })
}

for (const [stage, theme, direction] of [['metadata', 'dark', -1], ['streams', 'light', 1]]) {
  test(`Shorts ${stage} loading placeholders follow the finger and allow skipping`, async ({ app, page }, testInfo) => {
    const { watch, touch, cdp } = await openShorts({ app, page })
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(theme))
    await watch.evaluate((component, stage) => {
      if (stage === 'metadata') component.proxy.isLoading = true
      else component.proxy.ytDlpStreamsPending = true
      component.proxy.shortsNavigationLockedUntil = Date.now() + 60_000
    }, stage)
    const placeholder = page.locator('.shortsSwipeViewport > .videoPlayerPlaceholder')
    await expect(placeholder).toBeVisible()
    const bounds = await placeholder.boundingBox()
    await touch('touchStart')
    await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipePointer)).toBeNull()
    await touch('touchEnd')
    await watch.evaluate(component => { component.proxy.shortsNavigationLockedUntil = Date.now() - 1 })
    await touch('touchStart')
    await touch('touchMove', 0, direction * 120)
    await expect.poll(async () => (await placeholder.boundingBox()).y).toBeCloseTo(bounds.y + direction * 120, 0)
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await touch('touchCancel')
    await expect.poll(() => watch.evaluate(component => component.proxy.shortsSwipeSettling)).toBe(false)
    await expect.poll(async () => (await placeholder.boundingBox()).y).toBeCloseTo(bounds.y, 0)
    await touch('touchStart')
    await touch('touchMove', 0, direction * 120)
    await expect(page.locator('.shortsSwipePreview')).toBeVisible()
    await expect.poll(() => page.locator('.shortsSwipeViewport img:not(.retryImagePlaceholder)')
      .evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    const screenshotPath = testInfo.outputPath('loading-swipe.png')
    await page.screenshot({
      path: screenshotPath,
      clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    })
    await testInfo.attach('Loading Shorts swipe', { path: screenshotPath, contentType: 'image/png' })
    await touch('touchEnd')
    await expect(page).toHaveURL(new RegExp(`/watch/${direction < 0 ? next : previous}`))
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    await watch.dispose()
    await cdp.detach()
  })
}
