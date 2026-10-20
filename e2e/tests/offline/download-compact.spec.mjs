import path from 'node:path'
import { chooseDownloadAction } from '../../helpers/downloads.mjs'
import { readFileSync } from 'node:fs'

import { test, expect, goTo, repoRoot, setWindowSize } from '../../helpers/app.mjs'

const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
const title = 'A walk through the mountains with a very long video title that remains available in Details'

test.describe('compact downloads', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: { enableDownloads: true },
      downloads: [{
        id: 1,
        title,
        thumbnail: `data:image/jpeg;base64,${readFileSync(path.join(repoRoot, 'e2e/fixtures/images/opentubex-playlist.jpg')).toString('base64')}`,
        status: 'completed',
        mode: 'video',
        template: 'template:Research',
        titleTruncated: true,
        destination: mediaPath,
        destinations: [mediaPath],
        files: [{ videoId: 'offline0001', path: mediaPath, extension: 'webm', author: 'Mountain Channel' }]
      }]
    }
  })

  test('keeps the mode visible until an output format is known', async ({ page }, testInfo) => {
    await goTo(page, 'downloads')
    for (const status of ['queued', 'preparing']) {
      for (const [mode, label] of [['video', 'Video'], ['audio', 'Audio'], ['subtitles', 'Subtitles']]) {
        await page.evaluate(({ status, mode }) => {
          window.$store.commit('upsertYtDlpDownload', {
            id: 2,
            title: 'Pending output',
            status,
            mode,
            destination: null,
            destinations: [],
            files: []
          })
        }, { status, mode })
        const row = page.locator('.downloadRow').filter({ hasText: 'Pending output' })
        await expect(row.locator('.downloadSummary')).toHaveText(label)
      }
    }
    await page.locator('.downloadRow').filter({ hasText: 'Pending output' }).screenshot({ path: testInfo.outputPath('pending-download-mode.png') })
    await page.evaluate(() => {
      window.$store.commit('upsertYtDlpDownload', {
        id: 2,
        title: 'Pending output',
        status: 'downloading',
        mode: 'audio',
        destination: '/downloads/audio.opus',
        destinations: [],
        files: [],
        sizeBytes: 1024
      })
    })
    await expect(page.locator('.downloadRow').filter({ hasText: 'Pending output' }).locator('.downloadSummary')).toHaveText('OPUS | 1 KiB')
  })

  test('uses comfortable touch targets in the downloads menu', async ({ app, page }, testInfo) => {
    await setWindowSize(app, page, { width: 375, height: 650 })
    await page.getByRole('button', { name: 'Quick settings', exact: true }).click()
    await page.getByRole('button', { name: 'Downloads', exact: true }).click()
    await expect(page.locator('.settings-window-enter-active')).toHaveCount(0)
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    try {
      expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
      await page.locator('.downloadRow').getByRole('button', { name: 'More options', exact: true }).click()
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      const actions = menu.getByRole('menuitem')
      await expect(actions).toHaveCount(5)
      for (const action of await actions.all()) {
        expect(await action.evaluate(element => element.offsetHeight)).toBeGreaterThanOrEqual(48)
        await expect(action).toHaveCSS('font-size', '16px')
      }
      const bounds = await menu.boundingBox()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
      await menu.screenshot({ path: testInfo.outputPath('touch-download-menu.png') })
      await menu.getByRole('menuitem', { name: 'Details', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Details', exact: true })).toBeVisible()
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await session.detach()
    }
  })

  for (const width of [1200, 500, 375]) {
    test(`shows compact metadata and keyboard-accessible details at ${width}px`, async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width, height: 850 })
      if (width < 600) {
        await page.getByRole('button', { name: 'Quick settings', exact: true }).click()
        await page.getByRole('button', { name: 'Downloads', exact: true }).click()
      } else {
        await goTo(page, 'downloads')
      }
      await expect(page.locator('.settings-window-enter-active')).toHaveCount(0)
      const row = page.locator('.downloadRow')
      await expect(row.getByRole('heading')).toHaveText(title)
      await expect(row.locator('.downloadChannel')).toHaveText('Mountain Channel')
      await expect(row.locator('.downloadSummary')).toHaveText(/^WEBM \| [\d.]+ (?:[KMGT]i)?B$/)
      await expect(row.locator('.destinationList, .downloadWarning')).toHaveCount(0)
      const thumbnail = row.locator('.downloadThumbnail')
      await expect(thumbnail).toBeVisible()
      await expect.poll(() => thumbnail.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
      const thumbnailBounds = await thumbnail.boundingBox()
      const detailsBounds = await row.locator('.downloadDetails').boundingBox()
      expect(thumbnailBounds.x + thumbnailBounds.width).toBeLessThanOrEqual(detailsBounds.x)
      expect(thumbnailBounds.y).toBeLessThan(detailsBounds.y + detailsBounds.height)
      const actionsBounds = await row.locator('.downloadActions').boundingBox()
      expect(actionsBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width)
      expect(actionsBounds.y).toBeLessThan(detailsBounds.y + detailsBounds.height)
      await expect(row.getByRole('button')).toHaveCount(2)
      await expect(row).not.toContainText('Research')
      expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      expect((await row.boundingBox()).height).toBeLessThan(150)
      const details = row.getByRole('button', { name: 'More options', exact: true })
      await details.focus()
      await expect(details).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menuitem', { name: 'Details', exact: true })).toHaveCSS('min-block-size', '28px')
      await page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Details', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
      await expect(dialog).toContainText('Mountain Channel')
      await expect(dialog).toContainText('Research')
      await expect(dialog.locator('.destination')).toHaveText(mediaPath)
      await expect(dialog.locator('.downloadWarning')).toBeVisible()
      expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await dialog.screenshot({ path: testInfo.outputPath('download-details.png') })
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(details).toBeFocused()
      await page.getByRole('dialog', { name: 'Downloads', exact: true }).screenshot({ path: testInfo.outputPath('compact-downloads.png') })
      await chooseDownloadAction(page, row, 'Details')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(details).toBeFocused()
    })
  }
})
