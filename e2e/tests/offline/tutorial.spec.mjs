import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ showTutorial: true })

async function expectHighlightCenteredOn(page, targetSelector) {
  await expect.poll(async () => {
    const [highlight, target] = await Promise.all([
      page.locator('.tutorialHighlight').evaluate(element => element.getBoundingClientRect().toJSON()),
      page.locator(`${targetSelector}:visible`).evaluate(element => element.getBoundingClientRect().toJSON())
    ])

    return {
      x: Math.round(Math.abs(highlight.x + highlight.width / 2 - (target.x + target.width / 2))),
      y: Math.round(Math.abs(highlight.y + highlight.height / 2 - (target.y + target.height / 2)))
    }
  }).toEqual({ x: 0, y: 0 })
}

async function clickAppMenuItem(app, menuLabel, itemLabel) {
  await app.electronApp.evaluate(({ BrowserWindow, Menu }, { menuLabel, itemLabel }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const menu = Menu.getApplicationMenu().items.find(item => item.label === menuLabel)
    menu.submenu.items.find(item => item.label === itemLabel).click(undefined, browserWindow)
  }, { menuLabel, itemLabel })
}

for (const [name, settings] of [
  ['without saved tutorial state', {}],
  ['with the retired notice pending', { tutorialAudience: 'existing' }]
]) {
  test.describe(`returning users ${name}`, () => {
    test.use({ seed: { settings } })

    test('start without onboarding and can open settings immediately', async ({ app, page }) => {
      await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => localStorage.getItem('opentubex.lastUsedVersion')))
        .toMatch(/^\d+\.\d+\.\d+(?:-|$)/)

      const tabCount = await page.locator('.tabBar .tab').count()
      await clickAppMenuItem(app, 'Tabs', 'New Tab')
      await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount + 1)
      await clickAppMenuItem(app, 'File', 'Preferences')
      await expect(page.locator('.settingsContent')).toBeVisible()
      await page.reload()
      await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    })
  })
}

test('blocks app shortcuts during the new-user tutorial and restores them after skipping', async ({ app, page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.getByRole('dialog', { name: 'Welcome to OpenTubeX' })
  await expect(tutorial).toBeVisible()

  const tabCount = await page.locator('.tabBar .tab').count()
  await page.keyboard.press('Control+t')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount)

  await clickAppMenuItem(app, 'Tabs', 'New Tab')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount)

  const currentUrl = page.url()
  await clickAppMenuItem(app, 'File', 'Preferences')
  await clickAppMenuItem(app, 'Navigate', 'History')
  expect(page.url()).toBe(currentUrl)

  const initialWindowState = await app.electronApp.evaluate(({ BrowserWindow }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      zoom: browserWindow.webContents.getZoomLevel()
    }
  })
  await clickAppMenuItem(app, 'File', 'New Window')
  await clickAppMenuItem(app, 'View', 'Toggle Developer Tools')
  await clickAppMenuItem(app, 'View', 'Zoom In')
  await clickAppMenuItem(app, 'View', 'Toggle Full Screen')
  await clickAppMenuItem(app, 'Window', 'Minimize')
  await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      devToolsOpen: browserWindow.webContents.isDevToolsOpened(),
      fullscreen: browserWindow.isFullScreen(),
      minimized: browserWindow.isMinimized(),
      zoom: browserWindow.webContents.getZoomLevel()
    }
  })).toEqual({
    ...initialWindowState,
    devToolsOpen: false,
    fullscreen: false,
    minimized: false
  })

  await expect(tutorial.getByRole('button', { name: 'Start fresh' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const skipAction = tutorial.getByRole('button', { name: 'Skip', exact: true })
  await expect(skipAction).toBeFocused()

  await skipAction.click()
  await expect(tutorial).toBeHidden()

  await clickAppMenuItem(app, 'Tabs', 'New Tab')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount + 1)

  await page.reload()
  await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
})

test('keeps the tutorial actions reachable in a short window', async ({ app, page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(800, 320)
  })

  const tutorial = page.getByRole('dialog', { name: 'Welcome to OpenTubeX' })
  await expect(tutorial.getByRole('button', { name: 'Start fresh' })).toBeVisible()
  await expect.poll(() => tutorial.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight
  })).toBe(true)

  // Short windows open long selects as a modal picker inside the card, which keeps Tab to itself
  await tutorial.getByRole('button', { name: 'Start fresh' }).click()
  await page.locator('.tutorialCard').getByRole('combobox', { name: 'Region for Trending' }).click()
  const picker = page.getByRole('listbox', { name: 'Region for Trending' })
  await expect(picker).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(picker.getByRole('option').first()).toBeFocused()
})

test.describe('translated welcome choices', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('fit inside the card in a narrow window', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(340, 600)
    })
    await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
    await page.reload()
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.05))

    const tutorial = page.locator('.tutorialCard')
    await expect(tutorial).toHaveAccessibleName('Willkommen bei OpenTubeX')
    const actions = ['Überspringen', 'Neu starten', 'Daten importieren'].map(name => {
      return tutorial.getByRole('button', { name, exact: true })
    })
    await Promise.all(actions.map(action => expect(action).toBeVisible()))
    await expect.poll(async () => {
      const [cardBounds, ...actionBounds] = await Promise.all([
        tutorial.evaluate(element => element.getBoundingClientRect().toJSON()),
        ...actions.map(action => action.evaluate(element => element.getBoundingClientRect().toJSON()))
      ])
      return actionBounds.every(bounds => {
        return bounds.left >= cardBounds.left && bounds.right <= cardBounds.right &&
          bounds.top >= cardBounds.top && bounds.bottom <= cardBounds.bottom
      })
    }).toBe(true)
    const actionWidths = await Promise.all(actions.slice(1).map(action => {
      return action.evaluate(element => {
        const contentRange = document.createRange()
        contentRange.selectNodeContents(element)
        const styles = getComputedStyle(element)
        return {
          availableWidth: element.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight),
          contentWidth: contentRange.getBoundingClientRect().width
        }
      })
    }))
    expect(
      actionWidths.every(({ availableWidth, contentWidth }) => contentWidth <= availableWidth),
      JSON.stringify(actionWidths)
    ).toBe(true)
  })
})

test('resets the managed content viewport after a shorter step replaces it', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(800, 420)
  })
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await tutorial.getByRole('button', { name: 'Start fresh' }).click()
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Playback and privacy')

  const scrollViewport = tutorial.locator('.tutorialScroll')
  const scrollbar = scrollViewport.locator(':scope > .os-scrollbar-vertical')
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  await scrollViewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scrollViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')
  await expect.poll(() => scrollViewport.evaluate(element => ({
    scrollTop: element.scrollTop,
    scrollRange: element.scrollHeight - element.clientHeight
  }))).toEqual({ scrollTop: 0, scrollRange: 0 })
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})

test('walks new users through setup and the essential controls', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')
  await expect(tutorial.locator('.tutorialProgress span')).toHaveCount(7)
  await expect(tutorial.getByRole('button', { name: 'Import data' })).toBeVisible()
  await expect(tutorial.getByRole('button', { name: 'Back' })).toHaveCount(0)

  await tutorial.getByRole('button', { name: 'Start fresh' }).click()
  await expect(tutorial).toHaveAccessibleName('Make it yours')
  await expect(tutorial.getByRole('heading', { name: 'Make it yours' })).toBeFocused()
  await expect(page.locator('.tutorialHighlight')).toHaveCount(0)

  await tutorial.getByRole('button', { name: 'Back' }).click()
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')
  await tutorial.getByRole('button', { name: 'Start fresh' }).click()
  await expect(tutorial).toHaveAccessibleName('Make it yours')

  const themeModes = tutorial.getByRole('radiogroup', { name: 'Base Theme' })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(themeModes.getByRole('radio', { name: 'System default' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(themeModes.getByRole('radio', { name: 'Light' })).toBeChecked()
  await expect(page.locator('body')).toHaveClass(/light/)

  await expect(tutorial.getByRole('combobox', { name: 'Default Landing Page' })).toBeVisible()
  await expect(tutorial.getByRole('combobox', { name: 'Region for Trending' })).toBeVisible()

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Playback and privacy')
  const quality = tutorial.getByRole('combobox', { name: 'Default Quality' })
  await quality.click()
  await page.locator(`#${await quality.getAttribute('aria-controls')}`)
    .getByRole('option', { name: '480p', exact: true }).click()
  await expect(quality).toHaveText('480p')
  const toggles = {
    playNextVideo: 'Autoplay Recommended Videos',
    enableSubtitlesByDefault: 'Enable Subtitles by Default',
    rememberHistory: 'Remember Watch History',
    useSponsorBlock: 'Enable SponsorBlock',
    useDeArrowTitles: 'Use DeArrow Video Titles',
    useDeArrowThumbnails: 'Use DeArrow for thumbnails'
  }
  for (const label of Object.values(toggles)) {
    await tutorial.locator('label.switch-label').filter({ hasText: label }).click()
  }
  // Each switch saves its own setting; history starts on, the others off.
  await expect.poll(() => page.evaluate(async (keys) => {
    const settings = await window.ftElectron.dbSettings(1)
    return Object.fromEntries(keys.map(key => [key, settings.find(({ _id }) => _id === key)?.value]))
  }, Object.keys(toggles))).toEqual({
    playNextVideo: true,
    enableSubtitlesByDefault: true,
    rememberHistory: false,
    useSponsorBlock: true,
    useDeArrowTitles: true,
    useDeArrowThumbnails: true
  })

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')
  await expect(tutorial).toContainText('Use the navigation to reach subscriptions, playlists, history, and more.')
  await expect(tutorial.getByRole('heading', { name: 'Your library is always nearby' })).toBeFocused()
  await expect(tutorial.getByRole('button', { name: 'Skip', exact: true })).toBeVisible()
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Search or paste a link')
  await expectHighlightCenteredOn(page, '.searchContainer[data-tutorial="search"] .ft-input')
  const highlightStyles = await page.locator('.tutorialHighlight').evaluate(element => {
    const styles = getComputedStyle(element)
    return { borderRadius: Number.parseFloat(styles.borderRadius), boxShadow: styles.boxShadow }
  })
  expect(highlightStyles.borderRadius).toBeGreaterThan(0)
  expect(highlightStyles.boxShadow).toContain('inset')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Keep pages open in tabs')
  const layout = tutorial.getByRole('combobox', { name: 'Tab Layout' })
  await layout.focus()
  await page.keyboard.press('Enter')
  await expect(layout).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.selectDropdown:visible')).toHaveCSS('text-align', 'start')
  await page.keyboard.press('Escape')
  await expect(layout).toHaveAttribute('aria-expanded', 'false')
  await expect(tutorial).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(layout).toHaveText('Horizontal at bottom')
  await expect(page.locator('.tabBar.position-bottom')).toBeVisible()
  for (const [label, className] of [
    ['Vertical on left', 'position-left'],
    ['Vertical on right', 'position-right'],
    ['Horizontal at top', 'position-top']
  ]) {
    await layout.click()
    await page.locator(`#${await layout.getAttribute('aria-controls')}`)
      .getByRole('option', { name: label, exact: true }).click()
    await expect(page.locator(`.tabBar.${className}`)).toBeVisible()
    await expectHighlightCenteredOn(page, '[data-tutorial="tabs"]')
    await expect.poll(async () => {
      const [card, tabs] = await Promise.all([
        tutorial.evaluate(element => element.getBoundingClientRect().toJSON()),
        page.locator('[data-tutorial="tabs"]').evaluate(element => element.getBoundingClientRect().toJSON())
      ])
      return card.left < tabs.right && card.right > tabs.left && card.top < tabs.bottom && card.bottom > tabs.top
    }).toBe(false)
  }

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Settings and profiles')
  await expect(tutorial).toContainText('Right-click it to switch profiles.')
  await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')

  await tutorial.getByRole('button', { name: 'Finish' }).click()
  await expect(tutorial).toBeHidden()
  await expect.poll(() => page.evaluate(async () => {
    const settings = await window.ftElectron.dbSettings(1)
    return settings.find(({ _id }) => _id === 'tutorialAudience')?.value
  })).toBe('completed')

  await page.reload()
  await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
})

test('resumes the tutorial after opening settings from it and replays it from About', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await tutorial.getByRole('button', { name: 'Import data' }).click()
  await expect(tutorial).toBeHidden()
  await expect(page.locator('.settingsContent [data-section="data"]')
    .getByRole('button', { name: 'Import subscriptions', exact: true })).toBeVisible()

  await page.locator('.settingsCloseButton').click()
  await expect(tutorial).toHaveAccessibleName('Make it yours')
  expect(await page.evaluate(() => localStorage.getItem('opentubex.tutorial.audience'))).toBe('new')

  await tutorial.getByRole('button', { name: 'Theme and colors' }).click()
  await expect(tutorial).toBeHidden()
  await expect(page.locator('.themeGallery .themeSection')).toBeVisible()
  await page.locator('.settingsCloseButton').click()
  await expect(tutorial).toHaveAccessibleName('Make it yours')

  await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(tutorial).toBeHidden()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('opentubex.tutorial.audience'))).toBe('completed')

  await page.locator('.profileTrigger').click()
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()
  await page.getByRole('dialog', { name: 'About' }).getByRole('button', { name: 'Show tutorial' }).click()
  await expect(page.locator('.settingsWindow')).toHaveCount(0)
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')

  // A replay from About starts over even while the tutorial waits to resume
  await tutorial.getByRole('button', { name: 'Start fresh' }).click()
  await tutorial.getByRole('button', { name: 'Theme and colors' }).click()
  await expect(page.locator('.themeGallery .themeSection')).toBeVisible()
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'about'))
  await page.getByRole('dialog', { name: 'About' }).getByRole('button', { name: 'Show tutorial' }).click()
  await expect(page.locator('.settingsWindow')).toHaveCount(0)
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')
})

test('repositions the navigation highlight after crossing the mobile breakpoint', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 600, height: 700 })
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.05))

  const tutorial = page.locator('.tutorialCard')
  await tutorial.getByRole('button', { name: 'Start fresh' }).click()
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')

  await setWindowSize(app, page, { width: 1000, height: 800 })
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')
})

test.describe('watch pages that hide the side bar', () => {
  test.use({ seed: { settings: { ...WATCH_PAGE_SEED, hideSideBarOnWatchPages: true, tabBarPosition: 'left' } } })

  test('point the navigation step at the menu button', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page, undefined, { waitForPlayback: false })
    // The closed side bar slides behind the vertical tab bar and must not stay focusable there
    await expect(page.locator('.app')).toHaveClass(/watchSideNavOverlay/)
    await expect(page.locator('.sideNav')).toBeHidden()

    await page.evaluate(() => window.$store.commit('setTutorialStep', 3))
    await expectHighlightCenteredOn(page, '.menuButton')
  })
})

test.describe('fresh profile relaunch', () => {
  test.use({ seed: { freshProfile: true } })

  test('keeps showing the new-user tutorial on the second launch', async ({ app, page }) => {
    await expect(page.getByRole('dialog', { name: 'Welcome to OpenTubeX' })).toBeVisible()

    // Simulate environments where Chromium does not flush local storage before
    // the first process exits. The datastore copy must preserve the audience.
    await page.evaluate(async () => {
      localStorage.removeItem('opentubex.tutorial.audience')
      localStorage.removeItem('opentubex.lastUsedVersion')
      await window.ftElectron.dbSettings(2, { _id: 'confirmCloseApp', value: false })
    })
    const { page: relaunchedPage } = await app.relaunch()

    await expect(relaunchedPage.getByRole('dialog', { name: 'Welcome to OpenTubeX' })).toBeVisible()
  })
})
