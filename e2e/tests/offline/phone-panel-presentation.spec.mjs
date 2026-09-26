import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 0, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('portrait Shorts actions open phone sheets instead of side panels', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.useCustomShortsPlayerForCurrentVideo = true
    vm.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
    await vm.$nextTick()
  })
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/shortsPlayer/)
  expect(await watch.evaluate(vm => ({
    phoneLayout: vm.phoneLayout,
    portraitLayout: vm.portraitLayout,
    shortsPhonePanelsEnabled: vm.shortsPhonePanelsEnabled
  }))).toEqual({ phoneLayout: true, portraitLayout: true, shortsPhonePanelsEnabled: true })
  const video = page.locator('.ftVideoPlayer video')
  await expect(video).toHaveJSProperty('paused', false)

  for (const [action, title] of [
    ['.shortsExternalTitleButton', 'Video information'],
    ['.shortsCommentsAction button', 'Comments'],
    ['.shortsComponentAction button[title="Show transcript"]', 'Transcript']
  ]) {
    // Electron keeps its desktop side navigation over the title at this width.
    await page.locator(action).evaluate(button => button.click())
    const sheet = page.locator('.dockedSheet[open]')
    await expect(sheet).toBeVisible()
    await expect(video).toHaveJSProperty('paused', false)
    if (title === 'Video information') {
      await expect(sheet.locator('.shortsAuxPanelTarget')).toHaveCSS('overflow-y', 'visible')
    }
    await expect.poll(async () => {
      const { top, height } = await sheet.evaluate(el => el.getBoundingClientRect())
      return height / (top + height)
    }).toBeGreaterThan(0.68)
    await expect.poll(async () => {
      const { top, height } = await sheet.evaluate(el => el.getBoundingClientRect())
      return height / (top + height)
    }).toBeLessThan(0.72)
    await expect(sheet.locator('.mobileSheetHeader')).toContainText(title)
    await expect(page.locator('.shortsAuxPanelOpen, .shortsCommentsPanelOpen')).toHaveCount(0)
    await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toHaveCount(0)
  }

  await watch.evaluate(vm => vm.$store.dispatch('updateUseSponsorBlock', true))
  const sponsorAction = page.locator('.shortsComponentAction button[title="Open SponsorBlock info"]')
  await expect(sponsorAction).toHaveCount(1)
  await sponsorAction.evaluate(button => button.click())
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await expect(video).toHaveJSProperty('paused', false)
  await expect(page.locator('.dockedSheet[open] .mobileSheetHeader .sponsorBlockHeader')).toHaveCount(1)
  await expect(page.locator('.shortsAuxPanelOpen')).toHaveCount(0)
  await page.locator('.dockedSheet[open] .mobileSheetHeader').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.dockedSheet[open]')).toHaveCount(0)
  await sponsorAction.evaluate(button => button.click())
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await watch.evaluate(vm => vm.$store.dispatch('updateUseSponsorBlock', false))
  await expect(page.locator('.dockedSheet[open]')).toHaveCount(0)
  expect(await watch.evaluate(vm => vm.mobilePanel)).toBeNull()

  await watch.evaluate(vm => {
    vm.videoChapters = [{ title: 'Chapter one', timestamp: '0:00', startSeconds: 0 }]
    vm.openShortsPhonePanel('chapters')
  })
  const chaptersSheet = page.locator('.dockedSheet[open]')
  await expect(chaptersSheet).toBeVisible()
  await expect(chaptersSheet).toContainText('Chapter one')
  await expect(video).toHaveJSProperty('paused', false)
  await chaptersSheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close' }).click()
  await expect(chaptersSheet).toHaveCount(0)
  expect(await watch.evaluate(vm => vm.showSidebarChapters)).toBe(false)

  await setPlayerFullscreen(page, true)
  await page.locator('.playerFullscreenTitleOverlay').evaluate(title => title.click())
  await expect.poll(() => page.locator('.ftVideoPlayer').evaluate(player => document.fullscreenElement === player)).toBe(false)
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await expect(page.locator('.fullscreenMetadataOverlay.open')).toHaveCount(0)
})

for (const zoom of [1, 0.95]) {
  for (const mode of ['browser', 'pip']) {
    test(`phone panel survives ${mode} and clamps shorter content at ${zoom} UI scale`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 480, height: 800 })
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      if (mode === 'browser') await page.setViewportSize({ width: Math.round(480 / zoom), height: Math.round(800 / zoom) })
      const watch = await watchViewHandle(page)
      await watch.evaluate(vm => {
        vm.videoDescription = 'Description line\n'.repeat(100)
        vm.videoDescriptionHtml = ''
        vm.openPhonePanel('description')
      })
      const sheet = page.locator('.dockedSheet[open]')
      await expect(sheet).toBeVisible()
      const description = await sheet.locator('.description').elementHandle()
      await description.evaluate(el => { el.textContent = 'Description line\n'.repeat(100) })
      const viewport = sheet.locator('.phonePanelScroller')
      await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100)
      await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
      const position = await viewport.evaluate(el => el.scrollTop)
      const player = page.locator('.ftVideoPlayer')
      for (const shorten of [false, true]) {
        await player.evaluate((el, mode) => {
          if (mode === 'browser') return el.requestFullscreen()
          else document.body.classList.add('androidPictureInPicture')
        }, mode)
        await expect(sheet).toHaveCount(0)
        if (mode === 'pip') await setWindowSize(app, page, { width: 450, height: 270 })
        if (shorten) await description.evaluate(el => { el.textContent = 'Short description' })
        if (mode === 'pip') await setWindowSize(app, page, { width: 480, height: 800 })
        await player.evaluate((el, mode) => {
          if (mode === 'browser') return document.exitFullscreen()
          else document.body.classList.remove('androidPictureInPicture')
        }, mode)
        await expect(sheet).toBeVisible()
        await expect.poll(async () => {
          const panel = await sheet.boundingBox()
          const video = await player.boundingBox()
          return Math.abs(panel.y - video.y - video.height)
        }).toBeLessThan(2)
        if (!shorten) {
          await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeCloseTo(position, 0)
        } else {
          await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(0)
          await expect(viewport.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
          await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
        }
      }
    })
  }
}

test('comments retain their inner scroll position through fullscreen rotation and clamp on PiP return', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.setViewportSize({ width: 480, height: 800 })
  await page.locator('.phoneCommentsButton').click()
  const sheet = page.locator('.dockedSheet[open]')
  const viewport = sheet.locator('.commentsContentWrapper')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(800)
  await viewport.evaluate(el => { el.scrollTop = 800 })
  const player = page.locator('.ftVideoPlayer')
  await player.evaluate(el => el.requestFullscreen())
  await expect(sheet).toHaveCount(0)
  await page.setViewportSize({ width: 800, height: 480 })
  await page.evaluate(() => document.exitFullscreen())
  await page.setViewportSize({ width: 480, height: 800 })
  await expect(sheet).toBeVisible()
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeCloseTo(800, 0)
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
  const comments = await sheet.locator('.comment').first().locator('..').elementHandle()
  await page.evaluate(() => document.body.classList.add('androidPictureInPicture'))
  await expect(sheet).toHaveCount(0)
  await comments.evaluate(el => { el.textContent = 'Only remaining comment' })
  await page.evaluate(() => document.body.classList.remove('androidPictureInPicture'))
  await expect(sheet).toBeVisible()
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(0)
  await expect(viewport.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
})

test('fullscreen playlist action opens above a suspended phone panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.setViewportSize({ width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  const panel = page.locator('.dockedSheet[open]')
  await expect(panel).toBeVisible()
  const player = page.locator('.ftVideoPlayer')
  await player.evaluate(el => el.requestFullscreen())
  await expect(panel).toHaveCount(0)
  await player.locator('.fullscreenPlaylistAction > button').click({ force: true })
  const picker = page.locator('.mobileSheet[open]')
  await expect(picker.locator('.playlistSearch')).toBeVisible()
  expect(await picker.evaluate(el => el.matches(':modal'))).toBe(true)
  await picker.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await page.evaluate(() => document.exitFullscreen())
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Description')
  await expect(page.locator('.playlistSearch')).toHaveCount(0)
})
