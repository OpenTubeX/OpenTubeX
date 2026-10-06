import { setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

async function openSponsorBlockPrompt(app, page, mobile = true) {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/skipSegments/**', route => route.fulfill({
    body: JSON.stringify([{
      videoID: 'jNQXAC9IVRw',
      segments: [{
        UUID: 'mobile-sponsor',
        actionType: 'skip',
        category: 'sponsor',
        description: '',
        locked: 0,
        segment: [15, 20],
        videoDuration: 30,
        votes: 1
      }]
    }]),
    contentType: 'application/json'
  }))
  await page.evaluate(mobile => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setUseSponsorBlock', true)
    store.commit('setSponsorBlockSponsor', { color: '#00d400', skip: 'promptToSkip' })
    if (mobile) {
      const app = document.querySelector('.app')
      const applyMobileClass = () => {
        if (!app.classList.contains('capacitorTabs')) app.classList.add('capacitorTabs')
      }
      new MutationObserver(applyMobileClass).observe(app, { attributeFilter: ['class'] })
      applyMobileClass()
    }
  }, mobile)
  await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')
  await expect(player.locator('.sponsorBlockMarker')).toHaveCount(1)
  await player.locator('video').evaluate(video => {
    video.pause()
    video.currentTime = 16
    video.dispatchEvent(new Event('timeupdate'))
  })
  await expect(player.locator('.skippedSegment')).toBeVisible()
  return player
}

for (const uiScale of [100, 95]) {
  test.describe(`mobile SponsorBlock at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          showFullscreenActionsWhenPaused: true
        }
      }
    })

    test('only lifts notices for the visible fullscreen action dock', async ({ app, page }) => {
      const player = await openSponsorBlockPrompt(app, page)
      await setWindowSize(app, page, { width: 450, height: 850 })
      const notice = player.locator('.skippedSegmentsWrapper')
      const expectDefaultNoticePosition = () => expect.poll(() => player.evaluate(element => {
        const height = element.getBoundingClientRect().height
        const bottom = parseFloat(getComputedStyle(element.querySelector('.skippedSegmentsWrapper')).bottom)
        return Math.abs(bottom - Math.max(height * 0.15, 46 + height * 0.055))
      })).toBeLessThan(1)
      const expectInlinePosition = async () => {
        await player.hover()
        await expect(player).toHaveAttribute('data-action-dock-visible', 'true')
        await expectDefaultNoticePosition()
      }
      await expectInlinePosition()

      for (const mode of ['fullwindow', 'fullscreen']) {
        if (mode === 'fullscreen') await setPlayerFullscreen(page, true)
        else await page.locator('body').press('s')
        await player.hover()
        await expect(player).toHaveAttribute('data-action-dock-visible', 'true')
        await expect.poll(async () => {
          const noticeBox = await notice.boundingBox()
          const dockBox = await player.locator('.fullscreenActions').boundingBox()
          return Math.abs(dockBox.y - noticeBox.y - noticeBox.height - 8)
        }).toBeLessThan(1)

        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('addVideoToWatchQueue', {
            video: { videoId: 'queued00000', title: 'Queued video', author: 'Queue channel' }
          })
        })
        await player.locator('.fullscreenActions').getByRole('button', { name: 'Queue', exact: true }).click()
        await expect(player.locator('.fullscreenQueueOverlay.open')).toBeVisible()
        await expect.poll(() => player.locator('.fullscreenActions').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(50)
        await expect.poll(async () => {
          const noticeBox = await notice.boundingBox()
          const dockBox = await player.locator('.fullscreenActions').boundingBox()
          return Math.abs(dockBox.y - noticeBox.y - noticeBox.height - 8)
        }).toBeLessThan(1)
        await player.locator('.fullscreenQueueOverlay.open').getByRole('button', { name: 'Close', exact: true }).click()
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('clearWatchQueue'))

        // Hidden controls remove the dock offset even while a notice is showing.
        await player.locator('.shaka-controls-container').evaluate(element => element.removeAttribute('shown'))
        await expect(player).toHaveAttribute('data-action-dock-visible', 'false')
        await expectDefaultNoticePosition()
        if (mode === 'fullscreen') await setPlayerFullscreen(page, false)
        else await page.locator('body').press('s')
        await expectInlinePosition()
      }
    })

    test('updates prompt and undo shortcut hints when a keyboard connects or disconnects', async ({ app, page }) => {
      const player = await openSponsorBlockPrompt(app, page)
      const action = player.locator('.unskipButton')
      const setKeyboardAttached = attached => page.evaluate(value => {
        const app = document.querySelector('#app').__vue_app__
        app._container._vnode.component.provides.hardwareKeyboardAttached.value = value
      }, attached)
      await expect(action).toHaveText('Skip (Enter)')
      await setKeyboardAttached(false)
      await expect(action).toHaveText('Skip')
      await expect(action).toHaveAttribute('title', 'Skip')
      await setKeyboardAttached(true)
      await expect(action).toHaveText('Skip (Enter)')
      await setKeyboardAttached(false)
      await action.click()
      await expect(action).toHaveText('Unskip')
      await setKeyboardAttached(true)
      await expect(action).toHaveText('Unskip (Enter)')
      await setKeyboardAttached(false)
      await expect(action).toHaveText('Unskip')
    })
  })
}

for (const uiScale of [100, 125]) {
  for (const mobile of [false, true]) {
    test.describe(`minimum fullscreen with SponsorBlock at ${uiScale}% (${mobile ? 'mobile' : 'desktop'})`, () => {
      test.use({
        seed: {
          settings: {
            uiScale,
            videoPlaybackEngine: 'built-in',
            ytDlpPlaybackEngineDefaultMigration: true,
            showFullscreenActionsWhenPaused: true,
            alwaysShowScrollbars: true,
          }
        }
      })

      test('keeps the notice and scrollable actions inside the player', async ({ app, page }) => {
        const player = await openSponsorBlockPrompt(app, page, mobile)
        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('addVideoToWatchQueue', { video: { videoId: 'queued00000', title: 'Queue test' } })
          store.commit('setFullscreenActions', ['queue', 'sponsorBlock', 'comments', 'share', 'addToPlaylist', 'quickBookmark'])
        })
        await setWindowSize(app, page, { width: 340, height: 380 })
        await setPlayerFullscreen(page, true)
        await player.locator('.fullscreenActions').getByRole('button', { name: 'Queue', exact: true }).click()
        const actions = player.locator('.fullscreenActions')
        const notice = player.locator('.skippedSegmentsWrapper')
        await expect.poll(() => player.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const notice = element.querySelector('.skippedSegmentsWrapper').getBoundingClientRect()
          const actions = element.querySelector('.fullscreenActions').getBoundingClientRect()
          return notice.top >= bounds.top && notice.left >= bounds.left && notice.right <= bounds.right &&
            actions.top >= notice.bottom + 7 && actions.bottom <= bounds.bottom
        })).toBe(true)
        await actions.getByRole('button', { name: 'Comments', exact: true }).scrollIntoViewIfNeeded()
        await notice.getByRole('button', { name: 'Skip (Enter)', exact: true }).click()
        await expect(notice.getByRole('button', { name: 'Unskip (Enter)', exact: true })).toBeVisible()
        await actions.evaluate(element => { element.scrollTop = element.scrollHeight })
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSponsorBlockShowSkippedToast', false))
        await expect(notice).toHaveCount(0)
        await expect.poll(() => actions.evaluate(element => {
          const contentEnd = element.querySelector('.fullscreenActionsContent').getBoundingClientRect().bottom
          const viewportEnd = element.getBoundingClientRect().bottom - parseFloat(getComputedStyle(element).paddingBottom)
          return element.scrollTop === 0 || contentEnd >= viewportEnd - 2 / devicePixelRatio
        })).toBe(true)
        await expect(actions.getByRole('button', { name: 'Queue', exact: true })).toBeVisible()
      })
    })
  }
}
