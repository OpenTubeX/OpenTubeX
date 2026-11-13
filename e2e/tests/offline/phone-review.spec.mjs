import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('Escape closes a foreground prompt above a docked phone panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await page.evaluate(() => window.$store.dispatch('showSearchFilters'))
  const prompt = page.locator('.searchFiltersCard')
  await expect(prompt).toBeVisible()
  await prompt.press('Escape')
  await expect(prompt).toHaveCount(0)
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
})

test('Escape closes only the latest of multiple prompts', async ({ page }) => {
  await page.evaluate(() => {
    const store = window.$store
    return store.dispatch('showSearchFilters')
  })
  const searchFilters = page.locator('.searchFiltersCard')
  await expect(searchFilters).toBeVisible()
  await page.evaluate(() => {
    const store = window.$store
    return store.dispatch('showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null })
  })
  const createPlaylist = page.locator('.playlistNameInput')
  await expect(createPlaylist).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(createPlaylist).toHaveCount(0)
  await expect(searchFilters).toBeVisible()
})

test('reopens a watch sheet after switching fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.setViewportSize({ width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toHaveClass(/dockedSheet/)
  await sheet.press('Escape')
  await expect(sheet).toHaveCount(0)
  await page.locator('.ftVideoPlayer').evaluate(el => el.requestFullscreen())
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  await expect(sheet).toHaveCount(0)
  await page.evaluate(() => document.exitFullscreen())
  await expect(sheet).toHaveClass(/dockedSheet/)
  await sheet.press('Escape')
  await expect(sheet).toHaveCount(0)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  await expect(sheet).toHaveClass(/dockedSheet/)
})

test('description preview opens the description sheet as one button', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const preview = page.locator('.phoneDescriptionPreview')
  await expect(preview).toHaveRole('button')
  await expect(preview).toHaveAccessibleName('Description')
  await expect(preview).toHaveAttribute('aria-expanded', 'false')
  await expect(preview.locator('a, button')).toHaveCount(0)
  await preview.press('Enter')
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toContainText('Description')
  await expect(preview).toHaveAttribute('aria-expanded', 'true')
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)

  // Space activates the button instead of reaching the player's shortcut.
  const video = page.locator('.ftVideoPlayer video')
  const paused = await video.evaluate(element => element.paused)
  await preview.press('Space')
  await expect(sheet).toContainText('Description')
  expect(await video.evaluate(element => element.paused)).toBe(paused)
})

test('phone panel buttons open their sheets with Space instead of toggling playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await page.evaluate(() => window.$store.commit('addVideoToWatchQueue', {
    video: { videoId: 'jNQXAC9IVRw', title: 'Queue item', author: 'Test channel' }
  }))
  await setWindowSize(app, page, { width: 480, height: 800 })
  const sheet = page.locator('.mobileSheet[open]')
  for (const [button, title] of [['.phoneCommentsOpen', 'Comments'], ['.phoneQueueButton', 'Queue']]) {
    const paused = await video.evaluate(element => element.paused)
    await page.locator(button).press('Space')
    await expect(sheet.locator('.mobileSheetHeader')).toContainText(title)
    expect(await video.evaluate(element => element.paused), button).toBe(paused)
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
  }
})

test('description preview summarizes metadata as chips', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  const preview = page.locator('.phoneDescriptionPreview')
  const disclosure = { label: 'Altered or synthetic content', description: 'Edited', attribution: '' }
  await watch.evaluate(async (vm, disclosure) => {
    vm.videoDescription = ''
    vm.videoDescriptionHtml = '<p>Remote <a href="https://example.com">HTML</a> description</p>'
    vm.videoTags = Array.from({ length: 12 }, (_, index) => `tag-${index}`)
    vm.videoGames = [{ title: 'Example game', subtitle: '2026' }]
    vm.videoMusicTracks = [{ title: 'Track one' }, { title: 'Track two' }]
    vm.contentDisclosures = [disclosure, disclosure]
    vm.license = null
    await vm.$nextTick()
  }, disclosure)

  await expect(preview.locator('.phoneDescriptionExcerpt')).toHaveText('Remote HTML description')
  await expect(preview.locator('.phoneDescriptionChip')).toHaveText([
    disclosure.label,
    'Music2',
    'Games1',
    'Video Tags12',
  ])
  await expect(preview).toHaveAccessibleDescription(`Remote HTML description ${disclosure.label} Music 2 Games 1 Video Tags 12`)

  // Local API descriptions are formatted text runs, so they contain markup too.
  await watch.evaluate(vm => { vm.videoDescriptionHtml = ''; vm.videoDescription = '<b>Music &amp; games</b> by <a href="https://www.youtube.com/channel/UC1">Channel</a>' })
  await expect(preview.locator('.phoneDescriptionExcerpt')).toHaveText('Music & games by Channel')

  // Invidious sends plain text alongside escaped HTML, so literal angle brackets survive.
  await watch.evaluate(vm => { vm.videoDescription = 'Press <Ctrl>'; vm.videoDescriptionHtml = 'Press &lt;Ctrl&gt;' })
  await expect(preview.locator('.phoneDescriptionExcerpt')).toHaveText('Press <Ctrl>')

  // Yattee joins lines with <br>, so line and block boundaries become spaces.
  await watch.evaluate(vm => { vm.videoDescriptionHtml = 'First line<br>Second line<p>Third</p><p>Fourth</p>' })
  await expect(preview.locator('.phoneDescriptionExcerpt')).toHaveText('First line Second line Third Fourth')

  // Long descriptions keep a short accessible description; the sheet has the full text.
  await watch.evaluate(vm => { vm.videoDescriptionHtml = ''; vm.videoDescription = 'word '.repeat(200) })
  await expect.poll(() => preview.locator('.phoneDescriptionExcerpt').evaluate(element => element.textContent.length)).toBeLessThanOrEqual(300)

  // Metadata alone still offers the description sheet, even without any description value.
  await watch.evaluate(vm => { vm.videoDescription = null; vm.videoDescriptionHtml = ''; vm.videoMusicTracks = []; vm.videoTags = []; vm.contentDisclosures = [] })
  await expect(preview.locator('.phoneDescriptionExcerpt')).toHaveCount(0)
  await expect(preview.locator('.phoneDescriptionChip')).toHaveText(['Games1'])
  await preview.click()
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toContainText('Example game')
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)

  // A description of only custom emoji has no excerpt text but still opens the sheet.
  await watch.evaluate(vm => { vm.videoGames = []; vm.videoDescription = '<img src="https://yt3.ggpht.com/emoji" alt="Custom emoji" width="16" height="16">' })
  await expect(preview.locator('.phoneDescriptionExcerpt')).toHaveCount(0)
  await expect(preview.locator('.phoneDescriptionChip')).toHaveCount(0)
  await preview.click()
  await expect(sheet.locator('.description')).not.toBeEmpty()
})

test('phone transcript language menu stays inside the viewport', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.captions = [...vm.captions, { ...vm.captions[0], label: 'Second language' }]
    vm.openPhonePanel('transcript')
  })
  const sheet = page.locator('.mobileSheet[open]')
  await sheet.getByRole('button', { name: 'Language' }).click()
  const bounds = await sheet.locator('.transcriptLanguageMenu').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
})

test('closing the phone chapters panel clears its desktop state', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('chapters'))
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toBeVisible()
  expect(await watch.evaluate(vm => vm.showSidebarChapters)).toBe(true)
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  expect(await watch.evaluate(vm => ({
    flag: vm.showSidebarChapters,
    mobilePanel: vm.mobilePanel
  }))).toEqual({ flag: false, mobilePanel: null })
})

test('leaving the phone layout clears an open watch panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()

  await setWindowSize(app, page, { width: 1000, height: 700 })
  await expect.poll(() => watch.evaluate(vm => ({
    mobilePanel: vm.mobilePanel,
    showTranscript: vm.showTranscript
  }))).toEqual({ mobilePanel: null, showTranscript: false })
})

for (const panel of ['description', 'transcript']) {
  test(`landscape ${panel} panel opens maximized`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 1000, height: 480 })
    const video = page.locator('video')
    await video.evaluate(el => el.play())
    const watch = await watchViewHandle(page)
    await watch.evaluate((vm, panel) => vm.openPhonePanel(panel), panel)
    const sheet = page.locator('.mobileSheet[open]')
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    expect((await sheet.boundingBox()).y).toBeLessThan(5)
    expect((await sheet.boundingBox()).height).toBeGreaterThan(450)
    expect(await video.evaluate(el => el.paused)).toBe(false)
    await sheet.press('Escape')
    await expect(sheet).toHaveCount(0)
    expect(await video.evaluate(el => el.paused)).toBe(false)
  })
}
