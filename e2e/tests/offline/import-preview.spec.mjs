import { strToU8, zipSync } from 'fflate'
import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'
import { createUnifiedBackup } from '../../../src/renderer/helpers/unifiedBackup.js'

async function chooseArchive(page, dataSection, archive, action, previewSelected = true) {
  await page.evaluate(bytes => {
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([new Uint8Array(bytes)], 'preview.zip', { type: 'application/zip' }) }]
  }, [...archive])
  await dataSection.getByRole('button', { name: action, exact: true }).click()
  if (action === 'Import YouTube Takeout ZIP' && previewSelected) {
    await page.getByRole('button', { name: 'Preview changes', exact: true }).click()
  }
  return page.getByRole('region', { name: 'Preview changes', exact: true })
}

async function savedData(page) {
  return page.evaluate(() => {
    const store = window.$store
    return {
      profiles: store.getters.getProfileList,
      playlists: store.getters.getAllPlaylists,
      history: store.getters.getHistoryCacheById,
      searchHistory: store.getters.getSearchHistoryEntries,
      uiScale: store.getters.getUiScale,
    }
  })
}

test('previews backup counts and replacement effects, updates selection, and leaves data untouched on cancel', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const before = await savedData(page)
  const archive = await createUnifiedBackup({
    settings: { uiScale: 125, syncServerToken: 'private', unknown: true },
    profiles: [{ ...before.profiles[0], subscriptions: [{ id: 'UCpreviewxxxxxxxxxxxxxxx', name: 'Preview channel' }] }],
    playlists: [{ ...before.playlists[0], description: 'Imported details', videos: [] }],
    history: [{ videoId: 'abcdefghijk', timeWatched: 100 }],
    searchHistory: [{ _id: 'preview', query: 'preview search', lastUpdatedAt: 100 }],
    watchStats: { records: [{ date: '2026-10-01', seconds: 60 }], adjustment: null },
  })
  const preview = await chooseArchive(page, dataSection, new Uint8Array(await archive.arrayBuffer()), 'Import backup')
  await expect(preview).toHaveCSS('text-align', 'center')
  await expect(preview.locator('[data-category="settings"]')).toContainText('Existing: 1')
  await expect(preview.locator('[data-category="settings"]')).toContainText('Skipped: 2')
  await expect(preview.locator('[data-category="settings"]')).toContainText('Matching settings are replaced')
  await expect(preview.locator('[data-category="profiles"]').filter({ has: page.getByRole('heading', { name: 'Profiles and subscriptions', exact: true }) })).toContainText('Existing: 1')
  await expect(preview.locator('[data-category="profiles"]').filter({ has: page.getByRole('heading', { name: 'Subscriptions', exact: true }) })).toContainText('New: 1')
  expect(await savedData(page)).toEqual(before)
  await page.getByRole('checkbox', { name: 'History', exact: true }).locator('+ label').click()
  await expect(preview.locator('[data-category="history"]')).toHaveCount(0)
  await page.locator('.settingsBackButton').click()
  await expect(preview).toBeHidden()
  expect(await savedData(page)).toEqual(before)

  const refreshed = await chooseArchive(page, dataSection, new Uint8Array(await archive.arrayBuffer()), 'Import backup')
  await expect(refreshed.locator('[data-category="history"]')).toContainText('New: 1')
  for (const checkbox of await page.locator('.takeoutSelectionCentered').getByRole('checkbox').all()) {
    if (await checkbox.getAttribute('value') !== 'history') await checkbox.locator('+ label').click()
  }
  await page.getByRole('button', { name: 'Import selected data', exact: true }).click()
  await expect.poll(async () => Boolean((await savedData(page)).history.abcdefghijk)).toBe(true)
  const after = await savedData(page)
  expect(after.profiles).toEqual(before.profiles)
  expect(after.playlists).toEqual(before.playlists)
  expect(after.uiScale).toEqual(before.uiScale)
})

test('Takeout preview shows matching and new records and remains usable when its scroll range shrinks', { tag: '@scale' }, async ({ page }, testInfo) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const before = await savedData(page)
  const archive = zipSync({
    'Takeout/YouTube/subscriptions/subscriptions.csv': strToU8('Channel Id,Channel Url,Channel Title\nUCpreviewxxxxxxxxxxxxxxx,http://www.youtube.com/channel/UCpreviewxxxxxxxxxxxxxxx,Preview Channel\nUCpreviewxxxxxxxxxxxxxxx,http://www.youtube.com/channel/UCpreviewxxxxxxxxxxxxxxx,Duplicate\n'),
    'Another/subscriptions/subscriptions.json': strToU8(JSON.stringify([{ snippet: { resourceId: { channelId: 'UCpreviewxxxxxxxxxxxxxxx' }, title: 'Preview Channel', thumbnails: { default: { url: '' } } } }])),
    'Another/subscriptions/subscriptions.opml': strToU8('<opml version="2.0"><body><outline title="Preview Channel" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=UCpreviewxxxxxxxxxxxxxxx" /></body></opml>'),
    'Takeout/YouTube/history/watch-history.json': strToU8(JSON.stringify([
      { products: ['YouTube'], title: 'Watched Example', titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk', time: '2026-01-01T00:00:00Z' },
      { products: ['YouTube'], title: 'Deleted video' },
      { products: ['YouTube'], title: 'Watched Example', titleUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv', time: 'invalid' },
    ])),
    'Takeout/YouTube/history/search-history.json': strToU8(JSON.stringify([{ products: ['YouTube'], titleUrl: 'https://www.youtube.com/results?search_query=preview', time: '2026-01-01T00:00:00Z' }])),
    'Takeout/YouTube/playlists/playlists.csv': strToU8('Playlist ID,Playlist Title (Original)\nPLfavorites,Favorites\nPLnew,New playlist\n'),
  })
  const preview = await chooseArchive(page, dataSection, archive, 'Import YouTube Takeout ZIP')
  await expect(preview.locator('[data-category="subscriptions"]')).toContainText('New: 1')
  await expect(preview.locator('[data-category="history"]')).toContainText('Skipped: 1')
  await expect(preview.locator('[data-category="history"]')).toContainText('Watch history for matching videos is replaced')
  await expect(preview.locator('[data-category="playlists"]')).toContainText('New: 1')
  await expect(preview.locator('[data-category="playlists"]')).toContainText('Existing: 1')
  expect(await savedData(page)).toEqual(before)

  await page.setViewportSize({ width: 1200, height: 1000 })
  await page.locator('.settingsWindow').getByRole('button', { name: 'Maximize', exact: true }).click()
  await expect(preview).toHaveCSS('text-align', 'center')
  await expect(preview.locator('.previewCounts').first()).toHaveCSS('justify-content', 'center')
  await expect.poll(() => page.locator('.takeoutSelectionCentered').evaluate(element => {
    const content = element.closest('.settingsSubpageContent').getBoundingClientRect()
    const form = element.getBoundingClientRect()
    return Math.max(Math.abs((form.left + form.right - content.left - content.right) / 2), Math.abs((form.top + form.bottom - content.top - content.bottom) / 2))
  })).toBeLessThanOrEqual(1)
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(scheme))
    await page.locator('.takeoutSelectionCentered').screenshot({ path: testInfo.outputPath(`import-preview-${scheme}.png`) })
  }
  const choices = page.locator('.takeoutSelectionCentered')
  const viewport = page.locator('.settingsSubpageScroll').visible()
  async function scrollToBottom() {
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  }
  async function validScroll() {
    await expect.poll(() => viewport.evaluate(element => {
      const content = element.querySelector('.settingsSubpageContent')
      const style = getComputedStyle(element)
      const bottom = content.getBoundingClientRect().bottom + Number.parseFloat(style.paddingBottom) - element.getBoundingClientRect().top
      const validOffset = element.scrollTop >= 0 && (element.scrollTop <= 1 || bottom >= element.clientHeight - 1) && element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1
      const scrollbar = element.querySelector('.os-scrollbar-vertical')
      if (element.scrollHeight <= element.clientHeight + 1) return validOffset && scrollbar.classList.contains('os-scrollbar-unusable')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return validOffset && !scrollbar.classList.contains('os-scrollbar-unusable') && Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
    })).toBe(true)
  }
  await page.setViewportSize({ width: 375, height: 800 })
  await scrollToBottom()
  await page.setViewportSize({ width: 900, height: 600 })
  await validScroll()
  await scrollToBottom()
  await page.setViewportSize({ width: 1600, height: 900 })
  await validScroll()
  await page.setViewportSize({ width: 375, height: 800 })
  await expect.poll(() => choices.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await scrollToBottom()
  // Avoid pointer action auto-scrolling: shrink the content from the bottom position.
  await choices.getByRole('checkbox', { name: 'History', exact: true }).evaluate(element => element.nextElementSibling.click())
  await expect(preview.locator('[data-category="history"]')).toHaveCount(0)
  await validScroll()
  await choices.getByRole('checkbox', { name: 'History', exact: true }).evaluate(element => element.nextElementSibling.click())
  await scrollToBottom()
  for (const checkbox of await choices.getByRole('checkbox').all()) await checkbox.evaluate(element => element.nextElementSibling.click())
  await expect(preview).toBeHidden()
  await expect(page.getByRole('button', { name: 'Import selected data', exact: true })).toHaveCount(0)
  await validScroll()
  for (const checkbox of await choices.getByRole('checkbox').all()) await checkbox.evaluate(element => element.nextElementSibling.click())
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.getByRole('button', { name: 'Import selected data', exact: true }).click()
  await expect.poll(async () => (await savedData(page)).playlists.some(list => list.playlistName === 'New playlist')).toBe(true)
  const again = await chooseArchive(page, dataSection, archive, 'Import YouTube Takeout ZIP')
  await expect(again.locator('[data-category="subscriptions"]')).toContainText('New: 0')
  await expect(again.locator('[data-category="subscriptions"]')).toContainText('Existing: 1')
  await expect(again.locator('[data-category="history"]')).toContainText('Existing: 1')
  await expect(again.locator('[data-category="playlists"]')).toContainText('Existing: 2')
})

test('offers smaller Takeout categories when history exceeds the import size limit', async ({ page }, testInfo) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const archive = zipSync({
    'Takeout/YouTube/history/watch-history.json': strToU8('[{"titleUrl": "https://www.youtube.com/watch?v=abcdefghijk"}]'),
    'Takeout/YouTube/subscriptions/subscriptions.csv': strToU8('Channel Id,Channel Url,Channel Title\nUCsmallpreviewxxxxxxxxxx,http://www.youtube.com/channel/UCsmallpreviewxxxxxxxxxx,Small channel\n'),
  })
  new DataView(archive.buffer).setUint32(22, 256 * 1024 * 1024 + 1, true)
  const before = await savedData(page)
  const preview = await chooseArchive(page, dataSection, archive, 'Import YouTube Takeout ZIP')
  await expect(preview.locator('[data-category="history"]')).toContainText('Unreadable files: 1')
  await page.locator('.takeoutSelectionCentered').screenshot({ path: testInfo.outputPath('oversized-takeout-preview.png') })
  await expect(preview.locator('[data-category="subscriptions"]')).toContainText('New: 1')
  expect(await savedData(page)).toEqual(before)
  await page.getByRole('checkbox', { name: 'History', exact: true }).locator('+ label').click()
  await page.getByRole('button', { name: 'Import selected data', exact: true }).click()
  await expect.poll(async () => (await savedData(page)).profiles[0].subscriptions.some(channel => channel.id === 'UCsmallpreviewxxxxxxxxxx')).toBe(true)
})

test('chooses and previews subscriptions without parsing an unselected large Takeout history', async ({ page }, testInfo) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const before = await savedData(page)
  const archive = zipSync({
    'Takeout/YouTube/history/watch-history.json': strToU8(JSON.stringify([{
      products: ['YouTube'],
      title: 'Watched Example',
      titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      time: '2026-01-01T00:00:00Z',
      description: 'x'.repeat(2 * 1024 * 1024),
    }])),
    'Takeout/YouTube/subscriptions/subscriptions.csv': strToU8('Channel Id,Channel Url,Channel Title\nUCselectedpreviewxxxxxxx,http://www.youtube.com/channel/UCselectedpreviewxxxxxxx,Selected channel\n'),
  })
  await page.evaluate(() => {
    window.largeHistoryParseCount = 0
    const parse = JSON.parse
    JSON.parse = (...args) => {
      if (typeof args[0] === 'string' && args[0].length > 1024 * 1024) window.largeHistoryParseCount++
      return parse(...args)
    }
  })
  const preview = await chooseArchive(page, dataSection, archive, 'Import YouTube Takeout ZIP', false)
  const choices = page.locator('.takeoutSelectionCentered')
  await expect(choices.getByRole('checkbox')).toHaveCount(2)
  await expect(preview).toBeHidden()
  await expect(choices.getByRole('button', { name: 'Import selected data', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.largeHistoryParseCount)).toBe(0)
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(scheme))
    await choices.screenshot({ path: testInfo.outputPath(`takeout-selection-${scheme}.png`) })
  }
  await choices.getByRole('checkbox', { name: 'History', exact: true }).locator('+ label').click()
  await choices.getByRole('button', { name: 'Preview changes', exact: true }).click()
  await expect(preview.locator('[data-category="subscriptions"]')).toContainText('New: 1')
  await expect(preview.locator('[data-category="history"]')).toHaveCount(0)
  await choices.getByRole('checkbox', { name: 'History', exact: true }).locator('+ label').click()
  await expect(choices.getByRole('button', { name: 'Import selected data', exact: true })).toHaveCount(0)
  await expect(choices.getByRole('button', { name: 'Preview changes', exact: true })).toBeVisible()
  await choices.getByRole('checkbox', { name: 'History', exact: true }).locator('+ label').click()
  await choices.getByRole('button', { name: 'Import selected data', exact: true }).click()
  await expect.poll(async () => (await savedData(page)).profiles[0].subscriptions.some(channel => channel.id === 'UCselectedpreviewxxxxxxx')).toBe(true)
  expect(await page.evaluate(() => window.largeHistoryParseCount)).toBe(0)
  expect((await savedData(page)).history).toEqual(before.history)
})
