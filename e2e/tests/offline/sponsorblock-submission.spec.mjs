import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.describe('SponsorBlock submission', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        useSponsorBlock: true,
        sponsorBlockEnableSubmission: true
      }
    }
  })

  test('fills the video end with a timestamp within the duration', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([]),
      contentType: 'application/json'
    }))
    const video = await openMockedVideo(page)
    // A duration whose millisecond rounding goes up past the video end
    const seconds = await video.evaluate(element => {
      element.pause()
      element.currentTime = 10
      const seconds = Math.ceil(element.duration)
      Object.defineProperty(element, 'duration', { configurable: true, get: () => seconds + 0.0006 })
      return seconds
    })
    await page.locator('.ftVideoPlayer').hover()
    await page.locator('.sponsorblock-start-button').click()
    await video.evaluate(element => {
      Object.defineProperty(element, 'currentTime', { configurable: true, get: () => element.duration })
    })
    await page.locator('.ftVideoPlayer').hover()
    await page.locator('.sponsorblock-end-button').click()

    const menu = page.locator('.sponsorBlockSubmissionMenu')
    const endTime = menu.getByRole('textbox', { name: 'Segment end time' })
    await expect(endTime).toHaveValue(`0:${seconds}.000`)
    await menu.getByRole('button', { name: '(End)', exact: true }).click()
    await expect(endTime).toHaveValue(`0:${seconds}.000`)
    await expect(menu.locator('.sponsorBlockSubmissionError')).toHaveCount(0)

    // Shaka's seek range can know the length before the media element does
    await video.evaluate(element => {
      Object.defineProperty(element, 'duration', { configurable: true, get: () => NaN })
    })
    await endTime.fill('')
    await menu.getByRole('button', { name: '(End)', exact: true }).click()
    await expect(endTime).toHaveValue(/^0:[1-3]\d\.\d{3}$/)
    await expect(menu.locator('.sponsorBlockSubmissionError')).toHaveCount(0)
  })

  test('keeps the draft list scrollbar at the panel edge beside its content', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([]),
      contentType: 'application/json'
    }))
    await openMockedVideo(page)
    await page.evaluate(async () => {
      await window.$store.dispatch('updateSponsorBlockDraftSegmentsByVideoId', {
        jNQXAC9IVRw: [4, 8, 12, 16].map(startTime => ({
          id: `draft-${startTime}`,
          startTime,
          endTime: startTime + 2,
          category: 'sponsor',
          actionType: 'skip'
        }))
      })
    })
    await page.locator('.ftVideoPlayer').hover()
    await page.locator('.sponsorblock-open-menu-button').click({ force: true })

    const menu = page.locator('.sponsorBlockSubmissionMenu')
    const scrollbar = menu.locator('.sponsorBlockSubmissionSegments > .os-scrollbar-vertical')
    for (const size of [{ width: 1200, height: 700 }, { width: 450, height: 850 }]) {
      await setWindowSize(app, page, { ...size, width: Math.round(size.width * uiScale / 100) })
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      await menu.locator('.sponsorBlockSubmissionSegments').hover()
      await menu.screenshot({ path: testInfo.outputPath(`submission-scrollbar-${size.width}.png`) })
      await expect.poll(() => menu.evaluate(element => {
        const track = element.querySelector('.sponsorBlockSubmissionSegments > .os-scrollbar-vertical')
          .getBoundingClientRect()
        const panelEdge = element.getBoundingClientRect().right - element.clientLeft
        const contentEdge = Math.max(...[...element.querySelectorAll(
          '.sponsorBlockDraftCategory .select, .sponsorBlockDraftActions, .sponsorBlockDraftTimes'
        )].map(child => child.getBoundingClientRect().right))
        return {
          gapToPanelEdge: Math.abs(panelEdge - track.right) < 1,
          clearOfContent: track.left >= contentEdge - 0.5
        }
      })).toEqual({ gapToPanelEdge: true, clearOfContent: true })
    }
  })
})
