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

test('landscape phone Shorts keep controls and loading circles inside the player', async ({ app, page }) => {
  await openShort({ app, page })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await page.setViewportSize({ width: 915, height: 412 })

  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const rail = page.locator('.shortsActionRail')
  const topControls = player.locator('.shortsTopControls')
  const [playerBounds, railBounds, controlsBounds] = await Promise.all([
    player.boundingBox(), rail.boundingBox(), topControls.boundingBox(),
  ])
  expect(railBounds.x).toBeGreaterThanOrEqual(playerBounds.x)
  expect(railBounds.x + railBounds.width).toBeLessThanOrEqual(playerBounds.x + playerBounds.width + 1)
  expect(railBounds.y + railBounds.height).toBeLessThanOrEqual(playerBounds.y + playerBounds.height + 1)
  expect(playerBounds.y + playerBounds.height).toBeLessThanOrEqual(page.viewportSize().height - 8)
  expect(controlsBounds.x).toBeGreaterThanOrEqual(playerBounds.x)
  expect(controlsBounds.x + controlsBounds.width).toBeLessThanOrEqual(playerBounds.x + playerBounds.width + 1)
  await expect(page.locator('.shortsChannelRow')).toBeHidden()
  await expect(page.locator('.shortsExternalTitle')).toBeVisible()
  await rail.evaluate(element => { element.scrollTop = element.scrollHeight })
  expect(await rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const soundBounds = await rail.locator('.shortsSoundThumbnail').boundingBox()
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
  const circles = page.locator('.shortsActionSkeleton > span')
  await expect(circles.first()).toBeVisible()
  for (const circle of await circles.all()) {
    const bounds = await circle.boundingBox()
    expect(bounds.width).toBeCloseTo(bounds.height, 0)
  }
  for (const circle of await page.locator('.shortsSkeletonControlGroup span:visible').all()) {
    const bounds = await circle.boundingBox()
    expect(bounds.width).toBeCloseTo(bounds.height, 0)
  }
  await expect(page.locator('.shortsSkeletonChannelRow')).toBeHidden()
  await expect(page.locator('.shortsSkeletonTitle')).toBeVisible()
  await watch.dispose()
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
  expect(await rail.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
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
