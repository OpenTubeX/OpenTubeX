import { mkdtempSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

// The renderer cannot set the folder, which only the native picker chooses.
const screenshotFolder = mkdtempSync(path.join(tmpdir(), 'opentubex-e2e-screenshots-'))

test.use({
  seed: {
    settings: {
      ...WATCH_PAGE_SEED,
      enableScreenshot: true,
      screenshotMode: 'default_folder',
      screenshotFormat: 'jxl',
      screenshotFolderPath: screenshotFolder,
      screenshotFilenamePattern: 'frame'
    }
  }
})

test.afterAll(() => rm(screenshotFolder, { recursive: true, force: true }))

test('saves JPEG XL screenshots', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await waitForPlayback(page)

  await page.locator('body').press('u')

  await expect(page.locator('.toast', { hasText: 'Saved screenshot' })).toBeVisible({ timeout: 30_000 })
  expect(await readdir(screenshotFolder)).toEqual(['frame.jxl'])
  const file = await readFile(path.join(screenshotFolder, 'frame.jxl'))
  // A bare JPEG XL codestream starts with 0xFF 0x0A.
  expect([...file.subarray(0, 2)]).toEqual([0xFF, 0x0A])
})

test('takes one screenshot while the shortcut key is held', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await waitForPlayback(page)
  await page.evaluate(() => {
    window.__e2eJxlWorkers = 0
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        if (options?.name === 'jxl-encoder') window.__e2eJxlWorkers++
      }
    }
  })

  await page.evaluate(() => document.activeElement?.blur())
  // Pressing an already pressed key sends a keydown with `repeat` set, like holding it.
  for (let i = 0; i < 4; i++) await page.keyboard.down('u')
  await page.keyboard.up('u')

  await expect(page.locator('.toast', { hasText: 'Saved screenshot' }).first()).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => window.__e2eJxlWorkers)).toBe(1)
})
