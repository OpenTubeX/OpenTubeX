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
