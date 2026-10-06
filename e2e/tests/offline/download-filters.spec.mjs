import path from 'node:path'

import { test, expect, expectScrollAtRenderedEnd, goTo, repoRoot, setWindowSize, updateInputWithoutScrolling } from '../../helpers/app.mjs'

const media = name => path.join(repoRoot, 'e2e/fixtures/media', name)
const now = Date.now()
const records = [
  { id: 1, title: 'Morning walk', author: 'North Channel', file: 'demo.webm', completedAt: now },
  { id: 2, title: 'Evening song', author: 'South Channel', file: 'demo-audio.mp3', completedAt: now },
  { id: 3, title: 'Old documentary', author: 'North Channel', file: 'hls-1080.mp4', completedAt: now - 8 * 86400000 }
].map(({ id, title, author, file, completedAt }) => ({
  id,
  title,
  completedAt,
  status: 'completed',
  mode: 'video',
  destination: media(file),
  destinations: [media(file)],
  files: [{ videoId: `filter${String(id).padStart(5, '0')}`, path: media(file), author, extension: file.split('.').at(-1) }]
}))

async function select(page, label, option) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.describe('completed download filters', () => {
  test.use({ seed: { settings: { enableDownloads: true }, downloads: records } })

  test('searches title and channel, filters format and date, and sorts by file size', async ({ app, page }) => {
    await goTo(page, 'downloads')
    const section = page.locator('.downloadSection').filter({ has: page.getByRole('heading', { name: 'Downloaded' }) })
    const rows = section.locator('.downloadRow')
    const search = page.getByRole('searchbox', { name: 'Search completed downloads by title or channel' })
    const filters = section.locator('.downloadFilterPanel')
    const toggleFilters = section.locator('.downloadSectionHeading').getByRole('button', { name: 'Search Filters' })
    await expect(rows).toHaveCount(3)
    await expect(filters).toHaveCount(0)
    await expect(toggleFilters).toHaveAttribute('aria-expanded', 'false')
    await toggleFilters.click()
    await expect(filters).toBeVisible()
    await expect(toggleFilters).toHaveAttribute('aria-expanded', 'true')

    await search.fill('south channel')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Evening song')
    await search.fill('documentary')
    await expect(rows.first()).toContainText('Old documentary')
    await search.fill('no match')
    await expect(page.locator('.downloadNoResults')).toContainText('No completed downloads match')
    await toggleFilters.click()
    await expect(filters).toHaveCount(0)
    await expect(rows).toHaveCount(0)
    await toggleFilters.click()
    await expect(search).toHaveValue('no match')
    await search.fill('')
    await expect(rows).toHaveCount(3)

    await select(page, 'Format', 'MP3')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Evening song')
    await select(page, 'Format', 'All formats')
    await select(page, 'Time', 'This week')
    await expect(rows).toHaveCount(2)
    await select(page, 'Time', 'Any time')
    await select(page, 'Sort by', 'Smallest first')
    await expect(rows.locator('h3')).toHaveText(['Old documentary', 'Evening song', 'Morning walk'])

    await toggleFilters.click()
    await page.getByRole('button', { name: 'Maximize' }).click()
    await setWindowSize(app, page, { width: 560, height: 800 })
    await expect(filters).toHaveCount(0)
    await expect.poll(() => section.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await toggleFilters.click()
    await expect(filters).toBeVisible()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const id of [1, 2, 3]) store.commit('removeYtDlpDownload', id)
    })
    await expect(filters).toHaveCount(0)
    await page.evaluate(download => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', download)
    }, records[0])
    await expect(toggleFilters).toBeVisible()
    await expect(filters).toHaveCount(0)
  })

  test('clamps the scrollbar after filters, resize, and removal shorten the list', async ({ app, page }) => {
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await goTo(page, 'downloads')
    await page.evaluate((file) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (let id = 4; id < 34; id++) {
        store.commit('upsertYtDlpDownload', {
          id,
          title: `Archive ${id}`,
          status: 'completed',
          mode: 'video',
          completedAt: Date.now() - 400 * 86400000,
          sizeBytes: 7767,
          destination: file,
          destinations: [file],
          files: [{ path: file, extension: 'mp4' }]
        })
      }
    }, media('hls-1080.mp4'))
    const scroller = page.locator('.settingsDownloadsPage')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    const search = page.getByRole('searchbox', { name: 'Search completed downloads by title or channel' })
    const toggleFilters = page.locator('.downloadSectionHeading').getByRole('button', { name: 'Search Filters' })
    await toggleFilters.click()
    const scrollDown = async () => {
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    }
    const expectClamped = async () => {
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    }
    const expectThumbAtEnd = async () => {
      await expectScrollAtRenderedEnd(scroller)
      await expect.poll(() => scroller.evaluate(element => {
        const track = element.querySelector('.os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
        const thumb = element.querySelector('.os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(track.bottom - thumb.bottom)
      })).toBeLessThanOrEqual(1)
    }

    await scrollDown()
    await toggleFilters.evaluate(button => button.click())
    await expect(page.locator('.downloadFilterPanel')).toHaveCount(0)
    await expectThumbAtEnd()
    await toggleFilters.evaluate(button => button.click())

    await scrollDown()
    await updateInputWithoutScrolling(search, 'Morning')
    await expectClamped()
    await updateInputWithoutScrolling(search, '')
    await page.getByRole('combobox', { name: 'Format' }).click()
    await scrollDown()
    // Keep the bottom offset under test instead of scrolling back to the filter.
    await page.getByRole('option', { name: 'WEBM', exact: true }).evaluate(option => option.click())
    await expectClamped()
    await select(page, 'Format', 'All formats')
    await page.getByRole('combobox', { name: 'Time' }).click()
    await scrollDown()
    await page.getByRole('option', { name: 'This week', exact: true }).evaluate(option => option.click())
    await expectThumbAtEnd()

    await select(page, 'Time', 'Any time')
    await page.getByRole('button', { name: 'Maximize' }).click()
    await setWindowSize(app, page, { width: 560, height: 800 })
    await scrollDown()
    await setWindowSize(app, page, { width: 1200, height: 1000 })
    await expectThumbAtEnd()

    await scrollDown()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (let id = 2; id < 34; id++) store.commit('removeYtDlpDownload', id)
    })
    await expectClamped()
  })
})
