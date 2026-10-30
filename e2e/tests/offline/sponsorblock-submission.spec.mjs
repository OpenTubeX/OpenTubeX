import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

// Playwright crops Electron screenshots to CSS-pixel dimensions above 100% zoom.
async function capture(app) {
  return app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
}

async function expectMatchingLabelSurfaces(app, page) {
  const screenshot = await capture(app)
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
  }, screenshot)
  expect(difference).toBeLessThanOrEqual(1)
}

test.describe('SponsorBlock submission', { tag: '@scale' }, () => {
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

  test('keeps draft seekbar ranges and points visible', async ({ app, page, uiScale }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([]),
      contentType: 'application/json'
    }))
    const video = await openMockedVideo(page)
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 7
    })
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateBaseTheme', 'system')
      await store.dispatch('updateSponsorBlockDraftSegmentsByVideoId', {
        jNQXAC9IVRw: [
          { id: 'range', startTime: 4, endTime: 10, category: 'sponsor', actionType: 'skip' },
          { id: 'point', startTime: 14, endTime: 14, category: 'poi_highlight', actionType: 'poi' }
        ]
      })
    })
    const markers = page.locator('.sponsorBlockDraftMarker')
    await expect(markers).toHaveCount(2)
    for (const size of [{ width: 1200, height: 860 }, { width: 450, height: 850 }]) {
      await setWindowSize(app, page, { ...size, width: Math.round(size.width * uiScale / 100) })
      for (const scheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: scheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
        await page.locator('.ftVideoPlayer').hover()
        await expect(page.locator('.shaka-seek-bar-container')).toHaveCSS('opacity', '1')
        const screenshot = await capture(app)
        const samples = await page.evaluate(async screenshotBase64 => {
          const image = new Image()
          image.src = `data:image/png;base64,${screenshotBase64}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return [...document.querySelectorAll('.sponsorBlockDraftMarker')].flatMap(marker => {
            const bounds = marker.getBoundingClientRect()
            // Sample both the played and buffered halves of the range, plus the point.
            const positions = marker.classList.contains('sponsorBlockPointMarker') ? [0.5] : [0.25, 0.75]
            return positions.map(position => [...context.getImageData(
              Math.floor((bounds.left + bounds.width * position) * devicePixelRatio),
              Math.floor((bounds.top + bounds.height / 2) * devicePixelRatio),
              1, 1
            ).data].slice(0, 3))
          })
        }, screenshot)
        for (const sample of samples) {
          expect(Math.min(...sample)).toBeGreaterThanOrEqual(240)
        }
        await page.locator('.ftVideoPlayer .shaka-bottom-controls').screenshot({
          path: testInfo.outputPath(`draft-markers-${size.width}-${scheme}.png`)
        })
      }
    }
  })

  test('keeps timestamp inputs and outlined select labels compact', async ({ app, page, uiScale }, testInfo) => {
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
      await setWindowSize(app, page, { ...size, width: Math.round(size.width * uiScale / 100) })
      await menu.screenshot({ path: testInfo.outputPath(`submission-${size.width}.png`) })
      await expect(menu.locator('.textInputLabelText')).toHaveCount(0)
      await expect(menu.getByRole('textbox', { name: 'Segment start time' })).toHaveValue('0:00.000')
      await expect(menu.getByRole('textbox', { name: 'Segment end time' })).toHaveValue('0:10.000')
      const labels = menu.locator('.select-label')
      await expect(labels).toHaveCount(2)
      for (const label of await labels.all()) {
        await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect.poll(() => label.evaluate(element => {
          const labelBounds = element.getBoundingClientRect()
          const selectBounds = element.closest('.select').getBoundingClientRect()
          return Math.abs(labelBounds.top + labelBounds.height / 2 - selectBounds.top)
        })).toBeLessThan(1)
      }
      if (size.width === 1200) await expectMatchingLabelSurfaces(app, page)
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
    await page.locator('.ftVideoPlayer').hover()
    await page.locator('.sponsorblock-open-menu-button').click({ force: true })

    const menu = page.locator('.sponsorBlockSubmissionMenu')
    await menu.getByRole('button', { name: '(End)' }).click()
    await expect(menu.getByRole('textbox', { name: 'Segment end time' })).toHaveValue(`0:${seconds}.000`)
    await expect(menu.locator('.sponsorBlockSubmissionError')).toHaveCount(0)
  })

  test('keeps the draft list scrollbar at the panel edge beside its content', async ({ app, page, uiScale }, testInfo) => {
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
