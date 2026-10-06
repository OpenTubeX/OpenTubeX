import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

async function expectMatchingLabelSurfaces(page) {
  const screenshot = await page.screenshot()
  const difference = await page.evaluate(async screenshotBase64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${screenshotBase64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    // Electron captures retain native zoom; DOM bounds need device-pixel coordinates.
    const scale = window.devicePixelRatio
    const sample = (x, y) => context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data
    return Math.max(...[...document.querySelectorAll('.sponsorBlockDraftCategory .select-label')].flatMap(label => {
      const bounds = label.getBoundingClientRect()
      // Sample the label's empty padding and the panel just above its cutout.
      const cutout = sample(bounds.left + 2, bounds.top + bounds.height / 2)
      const panel = sample(bounds.left + 2, bounds.top - 2)
      return [0, 1, 2].map(channel => Math.abs(cutout[channel] - panel[channel]))
    }))
  }, screenshot.toString('base64'))
  expect(difference).toBeLessThanOrEqual(1)
}

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
      await page.locator('.ftVideoPlayer').hover()
      await page.locator('.sponsorblock-start-button').click()
      await video.evaluate(element => { element.currentTime = 10 })
      await page.locator('.ftVideoPlayer').hover()
      await page.locator('.sponsorblock-end-button').click()
      await video.evaluate(element => { element.style.filter = 'brightness(0) invert(1)' })

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
        if (size.width === 1200) await expectMatchingLabelSurfaces(page)
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
