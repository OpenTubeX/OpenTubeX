import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const uiScale of [100, 95]) {
  test.describe(`SponsorBlock submission at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          useSponsorBlock: true,
          sponsorBlockEnableSubmission: true
        }
      }
    })

    test('keeps timestamp inputs and outlined select labels compact', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await page.route('**/api/skipSegments/**', route => route.fulfill({
        body: JSON.stringify([]),
        contentType: 'application/json'
      }))
      await openMockedVideo(page)
      const video = page.locator('.ftVideoPlayer video')
      await video.evaluate(element => {
        element.pause()
        element.currentTime = 0
      })
      await page.locator('.sponsorblock-start-button').click({ force: true })
      await video.evaluate(element => { element.currentTime = 10 })
      await page.locator('.sponsorblock-end-button').click({ force: true })

      const menu = page.locator('.sponsorBlockSubmissionMenu')
      await expect(menu).toBeVisible()
      for (const size of [{ width: 1200, height: 860 }, { width: 450, height: 850 }]) {
        await setWindowSize(app, page, size)
        await menu.screenshot({ path: testInfo.outputPath(`submission-${size.width}.png`) })
        await expect(menu.locator('.textInputLabelText')).toHaveCount(0)
        await expect(menu.getByRole('textbox', { name: 'Segment start time' })).toHaveValue('0:00.000')
        await expect(menu.getByRole('textbox', { name: 'Segment end time' })).toHaveValue('0:10.000')
        const labels = menu.locator('.select-label')
        await expect(labels).toHaveCount(2)
        for (const label of await labels.all()) {
          await expect(label).toHaveCSS('background-color', 'rgb(24, 24, 24)')
          await expect.poll(() => label.evaluate(element => {
            const labelBounds = element.getBoundingClientRect()
            const selectBounds = element.closest('.select').getBoundingClientRect()
            return Math.abs(labelBounds.top + labelBounds.height / 2 - selectBounds.top)
          })).toBeLessThan(1)
        }
        await expect.poll(() => menu.evaluate(element => {
          const selects = element.querySelectorAll('.sponsorBlockDraftCategory')
          const first = selects[0].getBoundingClientRect()
          const second = selects[1].getBoundingClientRect()
          const actions = element.querySelector('.sponsorBlockDraftActions').getBoundingClientRect()
          return Math.max(
            Math.abs(second.top - first.bottom - 16),
            Math.abs(actions.top - second.bottom - 8),
            Math.abs(element.querySelector('.sponsorBlockDraftTimes').getBoundingClientRect().height - 30)
          )
        })).toBeLessThan(1)
      }
    })
  })
}
