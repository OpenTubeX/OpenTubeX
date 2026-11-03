import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 25, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

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

test('playlist prompts preserve their desktop sizing and heading alignment', async ({ page }) => {
  await page.evaluate(() => window.$store.dispatch(
    'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
  ))
  const nameInput = page.locator('.playlistNameInput')
  await expect(nameInput).toBeVisible()
  expect((await nameInput.boundingBox()).width).toBeGreaterThan(500)
  await page.keyboard.press('Escape')

  await page.evaluate(() => window.$store.dispatch(
    'showAddToPlaylistPromptForManyVideos', {
      videos: [{ videoId: 'test', title: 'Test', lengthSeconds: 10 }]
    }
  ))
  const heading = page.locator('.playlistPromptHeading')
  await expect(heading).toBeVisible()
  await expect(heading).toHaveCSS('text-align', 'center')
})

test('docked phone panel animations respect the configured animation speed', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.openPhonePanel('description')
    await vm.$nextTick()
    await new Promise(resolve => requestAnimationFrame(resolve))
    const animation = document.querySelector('.dockedSheet[open]').getAnimations()[0]
    await animation.ready
    window.__panelOpeningRate = animation.playbackRate
  })
  expect(await page.evaluate(() => window.__panelOpeningRate)).toBe(0.25)
  const sheet = page.locator('.dockedSheet[open]')
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  // Under load, the expansion animation can finish before a later evaluation
  // could find it through getAnimations(), so keep the one the drag creates.
  await sheet.evaluate(el => {
    const animate = el.animate
    el.animate = (...args) => (window.__panelDragAnimation = animate.apply(el, args))
  })
  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  await page.mouse.move(20, header.y + 5)
  await page.mouse.down()
  await page.mouse.move(20, 5, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate(async () => {
    const animation = window.__panelDragAnimation
    await animation.ready
    return animation.playbackRate
  })).toBe(0.25)
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
  await expect(page.locator('.mobileSheet[open]')).toContainText('Description')
  await expect(preview).toHaveAttribute('aria-expanded', 'true')
})

test('description preview clamps its excerpt to two lines on phones', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  const description = Array.from({ length: 8 }, (_, index) => `Description line ${index + 1}`).join('\n')
  await watch.evaluate(async (vm, description) => {
    vm.videoDescription = description
    vm.videoDescriptionHtml = ''
    vm.videoTags = []
    vm.videoGames = []
    vm.license = null
    await vm.$nextTick()
  }, description)

  const preview = page.locator('.phoneDescriptionPreview')
  const excerpt = preview.locator('.phoneDescriptionExcerpt')
  await setWindowSize(app, page, { width: 375, height: 800 })
  for (const width of [375, 480]) {
    await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(800 * uiScale / 100) })
    await expect(excerpt).toContainText(description.replaceAll('\n', ' '))
    await expect(preview.locator('.phoneDescriptionChip')).toHaveCount(0)
    const { height, lineHeight, overflows } = await excerpt.evaluate(element => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      overflows: element.scrollHeight > element.clientHeight
    }))
    expect(height / lineHeight).toBeCloseTo(2, 1)
    expect(overflows).toBe(true)
    await preview.click()
    const sheet = page.locator('.mobileSheet[open]')
    await expect(sheet.locator('.description')).toHaveText(description)
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
  await expect(page.locator('.mobileSheet[open]')).toContainText('Example game')
})

test('phone comments keep their inset and hide unavailable visibility actions', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const button = page.locator('.phoneCommentsButton')
  const bounds = await button.boundingBox()
  expect(bounds.x).toBeGreaterThan(0)
  expect(bounds.x + bounds.width).toBeLessThan(await page.evaluate(() => innerWidth))

  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.commentsDisabled = true
    vm.openPhonePanel('comments')
  })
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: /View Comments/ })).toHaveCount(0)
})

test('phone panel content remains rendered through its close animation', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  const sheet = page.locator('.mobileSheet[open]')
  const descriptionHost = page.locator('.phoneDescriptionPanel:not(.hiddenPanel)')
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(descriptionHost).toHaveCount(1)
  await expect(sheet).toHaveCount(0)
  await expect(descriptionHost).toHaveCount(0)
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

test('fullscreen dropdowns close when browser fullscreen ends', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const button = page.getByRole('button', { name: 'Share Video' }).first()
  const presentation = button.locator('xpath=ancestor::*[contains(@class, "videoLayout")]')
  await presentation.evaluate(el => el.requestFullscreen())
  await button.click()
  const layer = page.locator('.fullscreenDropdownLayer')
  await expect(layer).toBeVisible()
  await expect(layer).toHaveCSS('z-index', '100')
  await layer.locator('.iconDropdown').focus()
  await page.evaluate(() => document.exitFullscreen())
  await expect(layer).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('Settings consumes Escape after closing', async ({ page }) => {
  await page.evaluate(() => window.$store.dispatch('toggleSettingsWindow'))
  const settings = page.locator('.settingsWindow')
  await expect(settings).toBeVisible()
  expect(await settings.evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true
  })))).toBe(true)
  await expect(settings).toHaveCount(0)
})

for (const [panel, flag] of [
  ['chapters', 'showSidebarChapters'],
  ['transcript', 'showTranscript'],
  ['chat', 'liveChatOpen']
]) {
  test(`closing the phone ${panel} panel clears its desktop state`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    const watch = await watchViewHandle(page)
    await watch.evaluate((vm, panel) => vm.openPhonePanel(panel), panel)
    const sheet = page.locator('.mobileSheet[open]')
    await expect(sheet).toBeVisible()
    expect(await watch.evaluate((vm, flag) => vm[flag], flag)).toBe(true)
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    expect(await watch.evaluate((vm, flag) => ({
      flag: vm[flag],
      mobilePanel: vm.mobilePanel
    }), flag)).toEqual({ flag: false, mobilePanel: null })
  })
}

test('a new watch load closes the current phone panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  expect(await watch.evaluate(vm => {
    vm.mobilePanel = 'description'
    vm.resetVideoState()
    return vm.mobilePanel
  })).toBeNull()
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

test('phone key-moment panels use the matching title', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.videoChaptersKind = 'keyMoments'
    vm.videoChapters = [{ title: 'Moment', timestamp: '0:00', startSeconds: 0 }]
    vm.openPhonePanel('chapters')
    await vm.$nextTick()
  })
  await expect(page.locator('.mobileSheet[open]')).toHaveAttribute('aria-label', 'Key Moments')
})

test('player options stop updating their scrollbars when idle', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  await expect(page.locator('.phonePlayerOptionsClose')).toBeFocused()
  const menu = page.locator('.phonePlayerOptions[open] .shaka-overflow-menu')
  await expect(menu).toBeVisible()
  await page.locator('.phonePlayerOptions[open]').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const mutations = await menu.evaluate(el => new Promise(resolve => {
    let count = 0
    const targets = {}
    const observer = new MutationObserver(records => {
      count += records.length
      for (const record of records) {
        const key = record.target.className
        targets[key] = (targets[key] ?? 0) + 1
      }
    })
    observer.observe(el, { subtree: true, attributes: true, attributeFilter: ['class'] })
    setTimeout(() => { observer.disconnect(); resolve({ count, targets }) }, 300)
  }))
  expect(mutations.count, JSON.stringify(mutations.targets)).toBeLessThan(20)
})

for (const panel of ['description', 'comments', 'chapters', 'transcript', 'queue']) {
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

test('panel scrollbar stays aligned with its viewport while scrolling', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  const cues = Array.from({ length: 30 }, (_, index) => (
    `00:00:${String(index).padStart(2, '0')}.000 --> 00:00:${String(index + 1).padStart(2, '0')}.000\nCaption ${index + 1}`
  ))
  await page.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({
    contentType: 'text/vtt',
    body: `WEBVTT\n\n${cues.join('\n\n')}\n`,
  }))
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  const segments = page.locator('.mobileSheet[open] .transcriptSegments')
  await expect(segments.getByRole('listitem')).toHaveCount(30)
  await expect.poll(() => segments.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  const track = segments.locator(':scope > .os-scrollbar-vertical')
  await expect(track).toBeAttached()
  await segments.hover()
  const measureAlignment = () => segments.evaluate(element => {
    const scrollbarTrack = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track')
    const handle = scrollbarTrack.querySelector('.os-scrollbar-handle')
    return {
      trackOffset: scrollbarTrack.getBoundingClientRect().top - element.getBoundingClientRect().top,
      handleOffset: handle.getBoundingClientRect().top - scrollbarTrack.getBoundingClientRect().top,
    }
  })
  const initial = await measureAlignment()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => segments.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const alignment = await measureAlignment()
  expect(Math.abs(alignment.trackOffset - initial.trackOffset)).toBeLessThan(1)
  expect(alignment.handleOffset).toBeGreaterThan(initial.handleOffset)
})
