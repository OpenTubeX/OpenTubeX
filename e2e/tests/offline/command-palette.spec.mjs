import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const mainProfile = {
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#d50000',
  textColor: '#FFFFFF',
  subscriptions: []
}

const secondProfile = {
  _id: 'e2eprofile',
  name: 'Second profile',
  bgColor: '#558B2F',
  textColor: '#FFFFFF',
  icon: {
    type: 'emoji',
    value: '🦊'
  },
  subscriptions: []
}

test('opens with the configured shortcut and supports accessible fuzzy keyboard search', async ({ page }) => {
  await page.keyboard.press('Control+k')

  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await expect(dialog).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('placeholder', 'Search commands and settings…')
  await expect(dialog.locator('.commandPaletteTitle')).toHaveCount(0)
  const [searchBounds, closeBounds] = await Promise.all([
    dialog.locator('.commandPaletteSearch').boundingBox(),
    dialog.getByRole('button', { name: 'Close' }).boundingBox()
  ])
  expect(searchBounds).not.toBeNull()
  expect(closeBounds).not.toBeNull()
  expect(Math.abs(searchBounds.y - closeBounds.y)).toBeLessThanOrEqual(4)
  expect(closeBounds.x).toBeGreaterThan(searchBounds.x + searchBounds.width)
  await expect(page.locator('.commandPaletteResults')).toHaveAttribute(
    'data-overlayscrollbars-viewport'
  )
  await expect(page.locator('.topNav')).toHaveAttribute('inert', '')

  await input.fill('tab')
  await expect(page.getByRole('option', { name: 'Create a new tab' }).locator('strong'))
    .toHaveText('tab')

  await input.fill('captions')
  const captions = page.getByRole('option', { name: /Toggle captions ON\/OFF/ })
  await expect(captions).toHaveAttribute('aria-disabled', 'true')
  await expect(captions).toContainText('Open a video first')
  await input.press('Enter')
  await expect(dialog).toBeVisible()

  await input.fill('trnding')
  await expect(page.getByRole('option', { name: 'Trending', exact: true })).toBeVisible()
  await input.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/#\/trending/)
})

test('clamps the results scroll position after filtering to a shorter list', async ({ page }) => {
  await page.keyboard.press('Control+k')

  const input = page.getByRole('combobox', { name: 'Search commands' })
  const results = page.locator('.commandPaletteResults')
  const scrollbar = results.locator(':scope > .os-scrollbar-vertical')

  await results.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  await input.fill('toggle captions on off')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect.poll(() => results.evaluate(element => {
    const content = element.querySelector('.commandPaletteResultsContent')
    const contentRect = content.getBoundingClientRect()
    const viewportRect = element.getBoundingClientRect()

    return {
      scrollTop: element.scrollTop,
      hasOverflow: element.scrollHeight > element.clientHeight + 1,
      contentStartsInViewport: contentRect.top >= viewportRect.top - 1,
      contentEndsInViewport: contentRect.bottom <= viewportRect.bottom + 1
    }
  })).toEqual({
    scrollTop: 0,
    hasOverflow: false,
    contentStartsInViewport: true,
    contentEndsInViewport: true
  })
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})

test('uses arrow keys and opens a specific settings section', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('appearance')

  const activeOptionId = await input.getAttribute('aria-activedescendant')
  await expect(page.locator(`#${activeOptionId}`)).toContainText('Appearance')
  await input.press('Enter')

  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(settings.locator('.settingsMenu .active')).toContainText('Appearance')
})

test('finds and highlights an individual setting', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('thumbnail preference')

  const setting = page.getByRole('option', { name: /Thumbnail Preference/ })
  await expect(setting).toContainText('Appearance')
  await input.press('Enter')

  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(settings.locator('.settingsMenu .active')).toContainText('Appearance')
  await expect(settings.locator('.settingsSearchTarget'))
    .toContainText('Thumbnail Preference')
})

test('transfers focus to Find in Page', async ({ page }) => {
  const navigationSearch = page.locator('.topNav .searchInput input.ft-input')
  await navigationSearch.focus()
  await expect(navigationSearch).toBeFocused()

  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('find text on the current page')
  await input.press('Enter')

  await expect(page.locator('.findbarInput')).toBeFocused()
})

test('restores prior focus when dismissed', async ({ page }) => {
  const navigationSearch = page.locator('.topNav .searchInput input.ft-input')
  await navigationSearch.focus()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search commands' }).press('Escape')

  await expect(navigationSearch).toBeFocused()
})

test('hides pages that are unavailable without an Invidious instance', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })

  await input.fill('most popular')
  await expect(page.getByRole('option', { name: 'Most Popular', exact: true })).toHaveCount(0, { timeout: 1000 })
})

test.describe('Invidious navigation commands', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        defaultInvidiousInstance: 'https://invidious.test'
      }
    }
  })

  test('hides Trending without Local API fallback', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })

    await input.fill('most popular')
    await expect(page.getByRole('option', { name: 'Most Popular', exact: true })).toBeVisible()
    await input.fill('trending')
    await expect(page.getByRole('option', { name: 'Trending', exact: true })).toHaveCount(0, { timeout: 1000 })
  })
})

test.describe('fallback navigation commands', () => {
  test.use({
    seed: {
      settings: {
        backendFallback: true,
        hidePopularVideos: true,
        hideTrendingVideos: true
      }
    }
  })

  test('ignores distraction-free visibility settings', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })

    await input.fill('most popular')
    await expect(page.getByRole('option', { name: 'Most Popular', exact: true })).toBeVisible()
    await input.fill('trending')
    await expect(page.getByRole('option', { name: 'Trending', exact: true })).toBeVisible()
  })
})

test('shows each tab page icon in switch commands', async ({ page }) => {
  const historyTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/history',
    title: 'History tab',
    makeActive: false,
    lazyLoad: true
  }))
  const tabIcon = page.locator(`.tab[data-tab-id="${historyTab.id}"] .tabPageIcon`)
  await expect(tabIcon).toBeVisible()
  const iconName = await tabIcon.getAttribute('data-icon')

  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('switch to tab history tab')

  const command = page.getByRole('option', { name: /Switch to tab: History tab/ })
  await expect(command.locator(`[data-icon="${iconName}"]`)).toBeVisible()
  await expect(command.locator('[data-icon="clone"]')).toHaveCount(0)
})

test.describe('playlist commands', () => {
  test.use({
    seed: {
      playlists: [{
        _id: 'palette-playlist',
        playlistName: 'Palette playlist',
        protected: false,
        description: '',
        videos: [],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('resolves the tab title after opening a local playlist', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('open playlist palette playlist')
    await page.getByRole('option', { name: 'Open playlist: Palette playlist' }).click()

    await expect(page).toHaveURL(/#\/playlist\/palette-playlist/)
    await expect(page.locator('.playlistTitle')).toHaveText('Palette playlist')
    await expect(page.locator('.tabBar .tab.active')).toContainText('Palette playlist')
  })
})

test.describe('profile commands', () => {
  test.use({ seed: { profiles: [mainProfile, secondProfile] } })

  test('moves through filtered options in their visual order', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('profile')

    const optionIds = await page.getByRole('option').evaluateAll(options => (
      options.map(option => option.id)
    ))

    for (const optionId of optionIds) {
      await expect(input).toHaveAttribute('aria-activedescendant', optionId)
      await input.press('ArrowDown')
    }
    await expect(input).toHaveAttribute('aria-activedescendant', optionIds[0])
  })

  test('shows each configured profile icon', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('second profile')

    const command = page.getByRole('option', { name: /Second profile/ })
    const profileIcon = command.locator('.commandPaletteOptionProfileIcon')
    await expect(profileIcon).toHaveText('🦊')
    await expect(profileIcon).toHaveCSS('background-color', 'rgb(85, 139, 47)')
    await expect(profileIcon).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(command.locator('[data-icon="circle-user"]')).toHaveCount(0)
  })

  test('uses the profile switcher action and shows its toast', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('second profile')
    await page.getByRole('option', { name: /Second profile/ }).click()

    await expect(page.locator('.toast', { hasText: 'Second profile' })).toBeVisible()
  })
})

test.describe('custom command palette shortcut', () => {
  test.use({
    seed: {
      settings: {
        keyboardShortcuts: JSON.stringify({
          APP: { GENERAL: { OPEN_COMMAND_PALETTE: 'ctrl+shift+p' } }
        })
      }
    }
  })

  test('opens only with the saved binding', async ({ page }) => {
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)

    await page.keyboard.press('Control+Shift+p')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })
})

test.describe('contextual playback commands', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true
      }
    }
  })

  test('runs the existing player action on a watch page', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('toggle play pause')
    await input.press('Enter')

    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  })
})

test.describe('responsive command palette', () => {
  test.use({
    seed: {
      settings: {
        reducedMotion: 'on',
        uiScale: 125
      }
    }
  })

  test('fits a compact window at fractional UI scale and removes motion', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 520, height: 640 })
    await page.keyboard.press('Control+k')

    const backdrop = page.locator('.commandPaletteBackdrop')
    const dialog = page.locator('.commandPalette')
    await expect(backdrop).toHaveCSS('animation-name', 'none')
    await expect(dialog).toHaveCSS('animation-name', 'none')

    const [viewport, bounds] = await Promise.all([
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      dialog.boundingBox()
    ])
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    await expect(page.locator('.commandPaletteFooter')).toBeHidden()
  })
})
