import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      animationSpeed: 0,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useQuickPlaybackSpeedBar: true,
    }
  }
})

async function openShort({ app, page }) {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 390, height: 800 })
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    component.proxy.useCustomShortsPlayerForCurrentVideo = true
    component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
    await component.proxy.$nextTick()
  })
  await watch.dispose()
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/shortsPlayer/)
}

test('phone Shorts options stay inside their menu dialog', async ({ app, page }) => {
  await openShort({ app, page })
  await page.locator('.shortsTopControlsGroup').last().locator('button').nth(-2).click({ force: true })
  const dialog = page.locator('.phonePlayerOptions[open]')
  await expect(dialog).toBeVisible()
  const bounds = await dialog.locator('.shaka-overflow-menu').boundingBox()
  const frame = await dialog.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(frame.x)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(frame.x + frame.width)
  expect(bounds.y).toBeGreaterThanOrEqual(frame.y)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(frame.y + frame.height)
})

test('phone Shorts controls clear navigation and show quick speeds', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => {
    document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs')
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
  })
  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const nav = page.locator('.sideNav')
  const [playerBounds, navBounds] = await Promise.all([player.boundingBox(), nav.boundingBox()])
  expect(playerBounds.y + playerBounds.height).toBeLessThanOrEqual(navBounds.y - 4)
  const seekBounds = await player.locator('.shaka-seek-bar-container').boundingBox()
  expect(seekBounds.y + seekBounds.height).toBeLessThanOrEqual(navBounds.y)
  await expect(player.locator('.ft-quick-playback-rate-bar')).toBeVisible()
  await expect.poll(() => player.locator('.ft-quick-playback-rate-bar').evaluate(el => getComputedStyle(el.parentElement).opacity)).toBe('1')
  await expect(player.locator('.shortsVolumeControl')).toBeHidden()

  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await page.setViewportSize({ width: 411, height: 842 })
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => { component.proxy.isLoading = true })
  await expect(page.locator('.shortsSkeletonSeek')).toBeVisible()
  const [skeletonBounds, zoomedNavBounds] = await Promise.all([
    page.locator('.shortsPlayerPlaceholder').first().boundingBox(),
    nav.boundingBox(),
  ])
  expect(skeletonBounds.y + skeletonBounds.height).toBeLessThanOrEqual(zoomedNavBounds.y - 4)
  await watch.dispose()
})

test('phone Shorts loading controls match the action rail', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs'))
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => { component.proxy.isLoading = true })

  const rail = page.locator('.shortsActionRailSkeleton')
  const placeholders = rail.locator('.shortsActionSkeleton > span')
  await expect(placeholders.first()).toBeVisible()
  await expect(rail.locator('.shortsActionSkeleton > small').first()).toBeHidden()
  const bounds = await placeholders.first().boundingBox()
  expect(bounds.width).toBeGreaterThanOrEqual(40)
  expect(bounds.width).toBeCloseTo(bounds.height, 0)
  expect(await placeholders.first().evaluate(el => getComputedStyle(el).borderRadius)).toBe('50%')
  await expect(page.locator('.shortsSkeletonControlGroup').first().locator('span:visible')).toHaveCount(1)

  await watch.dispose()
})

test('landscape phone Shorts keep a portrait player and accessible controls', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await page.setViewportSize({ width: 915, height: 412 })

  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const rail = page.locator('.shortsActionRail')
  const topControls = player.locator('.shortsTopControls')
  const [playerBounds, railBounds, controlsBounds] = await Promise.all([
    player.boundingBox(), rail.boundingBox(), topControls.boundingBox(),
  ])
  expect(playerBounds).not.toBeNull()
  expect(railBounds).not.toBeNull()
  expect(controlsBounds).not.toBeNull()
  expect(railBounds.x).toBeGreaterThanOrEqual(playerBounds.x + playerBounds.width + 8)
  expect(railBounds.x + railBounds.width).toBeLessThanOrEqual(page.viewportSize().width)
  expect(railBounds.y + railBounds.height).toBeLessThanOrEqual(playerBounds.y + playerBounds.height + 1)
  expect(playerBounds.y + playerBounds.height).toBeLessThanOrEqual(page.viewportSize().height - 8)
  expect(controlsBounds.x).toBeGreaterThanOrEqual(playerBounds.x)
  expect(controlsBounds.x + controlsBounds.width).toBeLessThanOrEqual(playerBounds.x + playerBounds.width + 1)
  const aspectRatio = await page.locator('.videoArea').evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--shorts-aspect-ratio')))
  expect(playerBounds.width).toBeLessThanOrEqual(playerBounds.height * aspectRatio + 2)
  const headerBounds = await page.locator('.topNav').boundingBox()
  expect(railBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height + 8)
  expect(railBounds.y).toBeLessThanOrEqual(playerBounds.y + 16)
  await expect(page.locator('.shortsChannelRow')).toBeHidden()
  await expect(page.locator('.shortsExternalTitle')).toBeVisible()
  await page.locator('.videoAreaMargin').evaluate(element => {
    const preview = document.createElement('button')
    preview.className = 'shortsNextPreview'
    element.append(preview)
  })
  const metadataBounds = await page.locator('.shortsExternalMetadata').boundingBox()
  expect(metadataBounds).not.toBeNull()
  expect(metadataBounds.y + metadataBounds.height).toBeLessThanOrEqual(playerBounds.y + playerBounds.height - 8)
  await page.locator('.shortsNextPreview').evaluate(element => element.remove())
  await page.setViewportSize({ width: 915, height: 320 })
  await rail.evaluate(element => { element.scrollTop = element.scrollHeight })
  expect(await rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const railClearance = await rail.evaluate(element => {
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    const buttons = element.querySelectorAll('button')
    return {
      scrollbarLeft: scrollbar.getBoundingClientRect().left,
      buttonRight: Math.max(...Array.from(buttons, button => button.getBoundingClientRect().right)),
    }
  })
  expect(railClearance.scrollbarLeft).toBeGreaterThanOrEqual(railClearance.buttonRight)
  await expect(rail.locator('.shortsMetadataAction')).toBeHidden()
  await page.setViewportSize({ width: 915, height: 412 })
  const soundBounds = await rail.locator('.shortsSoundThumbnail').boundingBox()
  expect(soundBounds).not.toBeNull()
  expect(soundBounds.y).toBeGreaterThanOrEqual(railBounds.y - 1)
  expect(soundBounds.y + soundBounds.height).toBeLessThanOrEqual(railBounds.y + railBounds.height + 1)

  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await page.setViewportSize({ width: 1024, height: 600 })
  await expect.poll(() => rail.evaluate(element => ({
    offset: element.scrollTop,
    overflow: element.scrollHeight - element.clientHeight,
    scrollbarVisible: element.querySelector(':scope > .os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible'),
  }))).toEqual({ offset: 0, overflow: 0, scrollbarVisible: false })
  await page.setViewportSize({ width: 915, height: 412 })

  await player.locator('video').evaluate(video => video.pause())
  await player.locator('.shortsTopControlsGroup').last().locator('button').last().click()
  await expect.poll(() => player.evaluate(element => document.fullscreenElement === element)).toBe(true)
  await expect(page.locator('.shortsFullscreenChannelRow')).toBeHidden()
  await expect(page.locator('.shortsFullscreenTitle')).toBeVisible()
  await page.evaluate(() => document.exitFullscreen())

  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => { component.proxy.isLoading = true })
  const placeholderBounds = await page.locator('.shortsPlayerPlaceholder').first().boundingBox()
  expect(placeholderBounds.width).toBeLessThanOrEqual(placeholderBounds.height * aspectRatio + 2)
  const circles = page.locator('.shortsActionSkeleton > span')
  await expect(circles.first()).toBeVisible()
  for (const circle of await circles.all()) {
    const bounds = await circle.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds.width).toBeCloseTo(bounds.height, 0)
  }
  for (const circle of await page.locator('.shortsSkeletonControlGroup span:visible').all()) {
    const bounds = await circle.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds.width).toBeCloseTo(bounds.height, 0)
  }
  await expect(page.locator('.shortsSkeletonChannelRow')).toBeHidden()
  await expect(page.locator('.shortsSkeletonTitle')).toBeVisible()
  await watch.evaluate(component => {
    component.proxy.isLoading = false
    component.proxy.ytDlpStreamsPending = true
  })
  const streamPlaceholder = page.locator('.streamPlaceholder.shortsPlayerPlaceholder')
  await expect(streamPlaceholder).toBeVisible()
  const [streamBounds, noticeBounds] = await Promise.all([
    streamPlaceholder.boundingBox(),
    streamPlaceholder.locator('.streamPlaceholderOverlay').boundingBox(),
  ])
  expect(streamBounds.width).toBeLessThanOrEqual(streamBounds.height * aspectRatio + 2)
  expect(noticeBounds.x).toBeGreaterThanOrEqual(streamBounds.x - 1)
  expect(noticeBounds.x + noticeBounds.width).toBeLessThanOrEqual(streamBounds.x + streamBounds.width + 1)
  expect(noticeBounds.y).toBeGreaterThanOrEqual(streamBounds.y - 1)
  expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(streamBounds.y + streamBounds.height + 1)
  expect(await streamPlaceholder.locator('.streamPlaceholderText').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await expect(streamPlaceholder.locator('.streamPlaceholderOverlay')).toHaveCSS('flex-direction', 'column')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveClass(/\blight\b/)
  expect(await page.locator('.shortsExternalTitleButton').evaluate(element => getComputedStyle(element).color === getComputedStyle(document.body).color)).toBe(true)
  await watch.dispose()
})

test('landscape Shorts keep light-theme metadata clear of the player', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveClass(/\blight\b/)
  await page.setViewportSize({ width: 700, height: 540 })

  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const metadata = page.locator('.shortsExternalMetadata')
  const [playerBounds, metadataBounds] = await Promise.all([player.boundingBox(), metadata.boundingBox()])
  expect(metadataBounds.x + metadataBounds.width).toBeLessThanOrEqual(playerBounds.x - 8)
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await expect.poll(async () => {
    const [scaledPlayer, scaledMetadata] = await Promise.all([player.boundingBox(), metadata.boundingBox()])
    return scaledPlayer.x - scaledMetadata.x - scaledMetadata.width
  }).toBeGreaterThanOrEqual(8)
})

test('landscape Shorts keep every control inside the narrow player and action rail', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => {
    document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout')
    document.documentElement.style.setProperty('--safe-area-inset-top', '27px')
  })
  await page.setViewportSize({ width: 1026, height: 461 })
  await page.locator('.ftVideoPlayer.shortsPlayer video').evaluate(video => video.pause())
  await expect(page.locator('.shortsTopControls')).toBeVisible()
  await page.locator('.shortsTopControlsGroup').last().evaluate(group => {
    const captions = document.createElement('button')
    captions.className = 'shortsTopControl shortsCaptionsControl'
    group.prepend(captions)
  })
  const captions = page.locator('.shortsCaptionsControl')
  await expect(captions).toBeHidden()
  const playerBounds = await page.locator('.ftVideoPlayer.shortsPlayer').boundingBox()
  for (const button of await page.locator('.shortsTopControls .shortsTopControl:visible').all()) {
    const bounds = await button.boundingBox()
    expect(bounds.width).toBeGreaterThanOrEqual(42)
    expect(bounds.x).toBeGreaterThanOrEqual(playerBounds.x - 1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(playerBounds.x + playerBounds.width + 1)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(playerBounds.y + playerBounds.height + 1)
  }
  await page.setViewportSize({ width: 600, height: 320 })
  const narrowPlayerBounds = await page.locator('.ftVideoPlayer.shortsPlayer').boundingBox()
  for (const button of await page.locator('.shortsTopControls .shortsTopControl:visible').all()) {
    const bounds = await button.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(narrowPlayerBounds.x - 1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(narrowPlayerBounds.x + narrowPlayerBounds.width + 1)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(narrowPlayerBounds.y + narrowPlayerBounds.height + 1)
  }
  await expect(captions).toBeHidden()
  await page.setViewportSize({ width: 1026, height: 600 })
  await expect(captions).toBeVisible()
  await page.setViewportSize({ width: 1026, height: 461 })

  const loadedButtons = [
    page.locator('.shortsTopControlsGroup').first().locator('.shortsTopControl:visible').first(),
    ...await page.locator('.shortsTopControlsGroup').last().locator('.shortsTopControl:visible').all(),
  ]
  const loadedControls = await Promise.all(loadedButtons.map(button => button.boundingBox()))

  const rail = page.locator('.shortsActionRail')
  await rail.evaluate(element => {
    const navigation = document.createElement('div')
    navigation.className = 'shortsNavigation'
    navigation.innerHTML = '<button class="shortsNavigationButton"></button><button class="shortsNavigationButton"></button>'
    element.prepend(navigation)
  })
  const railBounds = await rail.boundingBox()
  for (const button of await rail.locator('button:visible').all()) {
    const bounds = await button.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(railBounds.x - 1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(railBounds.x + railBounds.width + 1)
  }

  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => { component.proxy.isLoading = true })
  const skeletonControls = page.locator('.shortsSkeletonControlGroup span:visible')
  await expect(skeletonControls).toHaveCount(3)
  for (const [index, expected] of loadedControls.entries()) {
    const bounds = await skeletonControls.nth(index).boundingBox()
    expect(bounds.x).toBeCloseTo(expected.x, 0)
    expect(bounds.y).toBeCloseTo(expected.y, 0)
    expect(bounds.width).toBeCloseTo(expected.width, 0)
  }
  await watch.dispose()
})

test('very narrow landscape Shorts keep the info action when the title has no room', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await page.setViewportSize({ width: 420, height: 320 })
  await expect(page.locator('.shortsExternalTitle')).toBeHidden()
  await expect(page.locator('.shortsMetadataAction')).toBeVisible()
})

test('landscape Shorts keep long playback errors and retry actions readable', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => {
    document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout')
    document.documentElement.style.setProperty('--safe-area-inset-top', '27px')
  })
  await page.setViewportSize({ width: 1026, height: 461 })
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => {
    component.proxy.errorMessage = 'TypeError: Aborted(Assertion failed in quickjs/quickjs.c: quickjs_gc_object_list) '.repeat(12)
  })
  const container = page.locator('.videoPlayerError .errorContainer')
  await expect(container).toBeVisible()
  const containerBounds = await container.boundingBox()
  const railBounds = await page.locator('.shortsActionRail').boundingBox()
  expect(containerBounds.x + containerBounds.width).toBeLessThanOrEqual(railBounds.x - 8)
  for (const element of await container.locator('.errorMessage, .errorActionButton').all()) {
    const bounds = await element.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(containerBounds.x - 1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(containerBounds.x + containerBounds.width + 1)
  }
  await expect.poll(() => container.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto')
  await container.evaluate(element => { element.scrollTop = element.scrollHeight })
  expect(await container.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.setViewportSize({ width: 420, height: 320 })
  const narrowContainerBounds = await container.boundingBox()
  const narrowRailBounds = await page.locator('.shortsActionRail').boundingBox()
  expect(narrowContainerBounds.x + narrowContainerBounds.width).toBeLessThanOrEqual(narrowRailBounds.x - 8)
  for (const element of await container.locator('.errorMessage, .errorActionButton').all()) {
    const bounds = await element.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(narrowContainerBounds.x - 1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(narrowContainerBounds.x + narrowContainerBounds.width + 1)
  }
  await page.setViewportSize({ width: 1026, height: 461 })
  await watch.evaluate(component => { component.proxy.errorMessage = 'Playback failed.' })
  await expect.poll(() => container.evaluate(element => ({
    offset: element.scrollTop,
    overflow: element.scrollHeight - element.clientHeight,
    scrollbarVisible: element.querySelector(':scope > .os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible'),
  }))).toEqual({ offset: 0, overflow: 0, scrollbarVisible: false })
  await watch.dispose()
})

test('narrow landscape Shorts keep the translated loading notice inside the player', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await page.setViewportSize({ width: 600, height: 320 })
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => { component.proxy.ytDlpStreamsPending = true })
  const streamPlaceholder = page.locator('.streamPlaceholder.shortsPlayerPlaceholder')
  await expect(streamPlaceholder).toBeVisible()
  await streamPlaceholder.locator('.streamPlaceholderText').evaluate(element => {
    element.textContent = 'Récupération des flux avec yt-dlp…'
  })
  const [streamBounds, noticeBounds] = await Promise.all([
    streamPlaceholder.boundingBox(),
    streamPlaceholder.locator('.streamPlaceholderOverlay').boundingBox(),
  ])
  expect(noticeBounds.x).toBeGreaterThanOrEqual(streamBounds.x)
  expect(noticeBounds.x + noticeBounds.width).toBeLessThanOrEqual(streamBounds.x + streamBounds.width)
  expect(noticeBounds.y).toBeGreaterThanOrEqual(streamBounds.y)
  expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(streamBounds.y + streamBounds.height)
  expect(await streamPlaceholder.locator('.streamPlaceholderText').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await watch.dispose()
})

test('narrow landscape Shorts stay above the phone navigation', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => {
    document.querySelector('.app').classList.add('capacitorTabs', 'capacitorPhoneLayout')
    document.querySelector('.app').classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
  })
  await page.setViewportSize({ width: 600, height: 360 })
  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const navigation = page.locator('.sideNav')
  const [playerBounds, navigationBounds] = await Promise.all([player.boundingBox(), navigation.boundingBox()])
  expect(playerBounds).not.toBeNull()
  expect(navigationBounds).not.toBeNull()
  expect(playerBounds.y + playerBounds.height).toBeLessThanOrEqual(navigationBounds.y - 4)
})

test('short phone screens can reach every Shorts rail action with navigation present', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs'))
  await page.setViewportSize({ width: 390, height: 600 })
  const rail = page.locator('.shortsActionRail')
  await rail.evaluate(element => {
    const navigation = document.createElement('div')
    navigation.className = 'shortsNavigation'
    for (const label of ['Previous', 'Next']) {
      const button = document.createElement('button')
      button.className = 'shortsNavigationButton'
      button.textContent = label
      navigation.append(button)
    }
    ;(element.querySelector('.os-content') ?? element).prepend(navigation)
  })

  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const first = rail.locator('.shortsNavigationButton').first()
  const last = rail.locator('.shortsSoundThumbnail')
  const [playerBounds, railBounds, firstBounds] = await Promise.all([
    player.boundingBox(), rail.boundingBox(), first.boundingBox(),
  ])
  expect(railBounds.y).toBeGreaterThanOrEqual(playerBounds.y + 60)
  expect(firstBounds.y).toBeGreaterThanOrEqual(railBounds.y - 1)
  expect(await rail.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(1)

  await rail.evaluate(element => { element.scrollTop = element.scrollHeight })
  const lastBounds = await last.boundingBox()
  expect(lastBounds.y).toBeGreaterThanOrEqual(railBounds.y - 1)
  expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(railBounds.y + railBounds.height + 1)

  await rail.locator('.shortsNavigation').evaluate(element => element.remove())
  await expect.poll(() => rail.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(() => rail.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  expect((await rail.locator('.shortsAction').first().boundingBox()).y).toBeGreaterThanOrEqual(railBounds.y - 1)

  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await page.setViewportSize({ width: 411, height: 842 })
  await expect.poll(() => rail.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
})

test('medium-width Shorts retain their player height without bottom tabs', async ({ app, page }) => {
  await openShort({ app, page })
  await setWindowSize(app, page, { width: 720, height: 820 })
  const player = page.locator('.videoLayout.shortsPlayerActive .videoPlayer')
  const baseline = await player.boundingBox()
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs'))
  await expect.poll(async () => (await player.boundingBox()).height).toBeCloseTo(baseline.height, 0)
})

test('Shorts playlist sheet opens maximized', async ({ app, page }) => {
  await openShort({ app, page })
  await page.locator('.shortsActionRail .shortsAction').filter({ hasText: 'Add to Playlist' }).locator('button').first().click()
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet).toBeVisible()
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeLessThanOrEqual(1)
  expect((await sheet.boundingBox()).height).toBeGreaterThanOrEqual(790)
})

test('phone Shorts opens video information from the rail without a bottom title', async ({ app, page }) => {
  await openShort({ app, page })
  await expect(page.locator('.shortsExternalTitle')).toBeVisible()
  await expect(page.locator('.shortsMetadataAction')).toBeHidden()
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs'))
  await expect(page.locator('.shortsSoundThumbnail')).toBeVisible()
  await expect(page.locator('.shortsChannelRow')).toBeHidden()
  await expect(page.locator('.shortsExternalTitle')).toBeHidden()
  const information = page.locator('.shortsMetadataAction button')
  await expect(information).toBeVisible()
  await information.click()
  await expect(information).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.shortsAuxPanel.shortsAuxPanelOpen')).toBeVisible()
  await expect(page.locator('.shortsAuxPanelHeader')).toContainText(await information.getAttribute('title'))

  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(instance => { instance.proxy.isLoading = true })
  await expect(page.locator('.shortsSkeletonChannelRow')).toBeHidden()
  await expect(page.locator('.shortsSkeletonTitle')).toBeHidden()
  await watch.dispose()
})

test('Shorts fullscreen control opens fullscreen and only the top control shows replay on end', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorPhoneLayout', 'capacitorTabs'))
  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  await player.locator('video').evaluate(video => {
    video.pause()
    video.ui.configure({ bigButtons: ['play_pause'] })
  })
  await expect(player.locator('.shaka-big-buttons-container .shaka-play-button')).toHaveCount(1)
  await expect(player.locator('.shaka-big-buttons-container')).toBeHidden()
  await expect(player.locator('.shortsTopControls')).toBeVisible()
  const fullscreenButton = player.locator('.shortsTopControlsGroup').last().locator('button').last()
  const receivesTap = await fullscreenButton.evaluate(button => {
    const bounds = button.getBoundingClientRect()
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    return target?.closest('button') === button
  })
  expect(receivesTap).toBe(true)
  await fullscreenButton.click()
  await expect.poll(() => player.evaluate(el => document.fullscreenElement === el)).toBe(true)
  await player.locator('video').evaluate(video => {
    video.pause()
    video.dispatchEvent(new Event('ended'))
  })
  await expect(player.locator('.shortsTopControls .shortsReplayIcon')).toBeVisible()
})
