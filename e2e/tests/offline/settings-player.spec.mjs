import { test, expect, goTo, goToSettingsSection, latestSettings, setWindowSize, readDatastore } from '../../helpers/app.mjs'

test.describe('fresh AI video summary default', () => {
  test.use({ seed: { freshProfile: true }, showTutorial: true })

  test('defaults AI video summaries to collapsed and preserves that on restart', async ({ app, page }, testInfo) => {
    await page.locator('.tutorialCard').getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(page.locator('.tutorialOverlay')).toBeHidden()
    const focus = await goToSettingsSection(page, 'focus')
    const summaryMode = focus.getByRole('combobox', { name: 'AI video summaries' })
    await expect(summaryMode).toHaveText('Collapsed')
    await summaryMode.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('summary-default-collapsed.png') })
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateConfirmCloseApp', false)
    })

    const { page: relaunchedPage } = await app.relaunch()
    const relaunchedFocus = await goToSettingsSection(relaunchedPage, 'focus')
    await expect(relaunchedFocus.getByRole('combobox', { name: 'AI video summaries' })).toHaveText('Collapsed')
  })
})

test('DLNA, Google Cast and FCast casting are opt in from Player Settings', async ({ page }) => {
  const playback = await goToSettingsSection(page, 'playback')
  for (const label of ['Enable DLNA casting', 'Enable Google Cast', 'Enable FCast']) {
    const toggle = playback.getByRole('checkbox', { name: label })
    await expect(toggle).not.toBeChecked()
    await playback.locator('label.switch-label').filter({ hasText: label }).click()
    await expect(toggle).toBeChecked()
  }
})

test('flows Player switches across balanced rows when some are unavailable', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
      x: 40,
      y: 40,
      width: 1400,
      height: 900
    }))
  })
  const playback = await goToSettingsSection(page, 'playback')
  const grid = playback.locator('.playerSwitchGrid').filter({ hasText: 'Show Music Mode Toggle' })
  await grid.evaluate(element => {
    for (const toggle of Array.from(element.children).slice(0, 3)) {
      toggle.style.display = 'none'
    }
  })
  await page.evaluate(() => {
    const store = window.$store
    return store.dispatch('updateUiScale', 95)
  })

  for (const direction of ['ltr', 'rtl']) {
    await page.evaluate(value => { document.documentElement.dir = value }, direction)
    const layout = await grid.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const direction = getComputedStyle(element).direction
      const switches = Array.from(element.querySelectorAll('.switch-ctn'))
        .filter(toggle => getComputedStyle(toggle).display !== 'none')
        .map(toggle => toggle.getBoundingClientRect())
      const midpoint = bounds.left + bounds.width / 2
      const column = switches.map(rect => {
        const atInlineStart = direction === 'rtl'
          ? rect.left > midpoint
          : rect.left < midpoint
        return atInlineStart ? 0 : 1
      })
      const bottoms = [0, 1].map(index => Math.max(...switches
        .filter((_, switchIndex) => column[switchIndex] === index)
        .map(rect => rect.bottom)))
      return { column, bottomDifference: Math.abs(bottoms[0] - bottoms[1]), rowHeight: switches[0].height }
    })

    expect(layout.column, direction).toEqual(layout.column.map((_, index) => index % 2))
    expect(layout.bottomDifference, direction).toBeLessThanOrEqual(layout.rowHeight + 1)
  }

  await playback.evaluate(element => { element.parentElement.style.inlineSize = '600px' })
  const narrowLayout = await grid.evaluate(element => {
    const positions = Array.from(element.querySelectorAll('.switch-ctn'))
      .filter(toggle => getComputedStyle(toggle).display !== 'none')
      .map(toggle => toggle.getBoundingClientRect().left)
    return {
      gridColumns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      leftDifference: Math.max(...positions) - Math.min(...positions)
    }
  })
  expect(narrowLayout.gridColumns).toBe(1)
  expect(narrowLayout.leftDifference).toBeLessThanOrEqual(10)
})

test.describe('settings', () => {
  test('forces end-screen recommendation hiding while all recommendations are hidden', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')
    const allRecommendations = focus.getByRole('checkbox', { name: 'Hide Recommended Videos' })
    const endScreen = focus.getByRole('checkbox', { name: 'Hide End-Screen Recommendations' })

    await expect(allRecommendations).not.toBeChecked()
    await expect(endScreen).not.toBeChecked()
    await endScreen.locator('..').locator('label').click()
    await expect(endScreen).toBeChecked()
    await allRecommendations.locator('..').locator('label').click()
    await expect(endScreen).toBeChecked()
    await expect(endScreen).toBeDisabled()
    await allRecommendations.locator('..').locator('label').click()
    await expect(endScreen).toBeChecked()
    await expect(endScreen).toBeEnabled()
    await endScreen.locator('..').locator('label').click()
    await expect(endScreen).not.toBeChecked()
    await allRecommendations.locator('..').locator('label').click()
    await expect(endScreen).toBeChecked()
    await expect(endScreen).toBeDisabled()
    await allRecommendations.locator('..').locator('label').click()
    await expect(endScreen).not.toBeChecked()
  })

  test('saves the playing interface hide delay independently of the paused delay', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')
    const slider = focus.getByRole('slider', { name: /Playing Interface Hide Delay/ })
    await expect(slider).toHaveValue('3')
    await expect(slider).toBeEnabled()
    await slider.fill('7.5')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return [store.getters.getPlayingInterfaceHideDelay, store.getters.getPausedInterfaceHideDelay]
    })).toEqual([7.5, 2.5])
    await goToSettingsSection(page, 'privacy')
    const reopened = await goToSettingsSection(page, 'focus')
    await expect(reopened.getByRole('slider', { name: /Playing Interface Hide Delay/ })).toHaveValue('7.5')
  })

  test('keeps comment translation controls out of Distraction Free settings', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')

    await expect(focus.getByRole('checkbox', {
      name: 'Hide Comment Translation Buttons'
    })).toHaveCount(0)
  })

  test('disables A-B repeat from Distraction Free settings', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')
    const disableAbRepeat = focus.getByRole('checkbox', { name: 'Disable A-B Repeat' })

    await expect(disableAbRepeat).not.toBeChecked()
    await disableAbRepeat.locator('..').locator('label.switch-label').click()
    await expect(disableAbRepeat).toBeChecked()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getDisableAbRepeat
    })).toBe(true)
  })

  test('preserves the existing AI video summary display mode and saves changes', async ({ app, page }) => {
    const focus = await goToSettingsSection(page, 'focus')
    const summaryMode = focus.getByRole('combobox', { name: 'AI video summaries' })

    await expect(summaryMode).toHaveText('Hide')
    await summaryMode.click()
    await expect(page.getByRole('option', { name: 'Hide', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Collapsed', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'Expanded', exact: true }).click()
    await expect(summaryMode).toHaveText('Expanded')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getAiVideoSummaryMode
    })).toBe('expanded')
    const { page: relaunchedPage } = await app.relaunch()
    const relaunchedFocus = await goToSettingsSection(relaunchedPage, 'focus')
    await expect(relaunchedFocus.getByRole('combobox', { name: 'AI video summaries' })).toHaveText('Expanded')
  })

  test('adds and removes languages that comment translation should ignore', async ({ app, page }) => {
    const general = await goToSettingsSection(page, 'general')
    const enableTranslations = general.getByRole('checkbox', {
      name: 'Enable comment translations'
    })
    const languageSelect = general.getByRole('combobox', {
      name: 'Never translate comments in'
    })

    await expect(enableTranslations).toBeChecked()
    await languageSelect.click()
    await expect(page.getByRole('option', { name: 'English', exact: true })).toHaveCount(0)
    await page.getByRole('option', { name: 'German', exact: true }).click()

    const ignoredLanguages = general.getByRole('list', {
      name: 'Never translate comments in'
    })
    await expect(ignoredLanguages).toContainText('German')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getCommentTranslationIgnoredLanguages
    })).toEqual(['de'])

    const removeGerman = ignoredLanguages.getByRole('button', {
      name: 'Translate German comments again'
    })
    await expect(removeGerman.locator('.ft-icon')).toHaveAttribute('aria-hidden', 'true')
    await expect(removeGerman.locator('.ft-icon__glyph')).toHaveAttribute('aria-hidden', 'true')
    const accentColor = await removeGerman.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent-color)'
      element.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    for (const size of [{ width: 1440, height: 800 }, { width: 375, height: 700 }]) {
      await setWindowSize(app, page, size)
      await expect(removeGerman.locator('.ft-icon')).toHaveCSS('font-size', '20px')
      if (size.width <= 680) {
        await expect.poll(() => removeGerman.evaluate(element => {
          const { width, height } = element.getBoundingClientRect()
          return Math.min(width, height)
        })).toBeGreaterThanOrEqual(48)
      }
      await expect(removeGerman).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await removeGerman.hover()
      await expect(removeGerman).toHaveCSS('color', accentColor)
      await expect(removeGerman).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await page.mouse.move(0, 0)
      await page.keyboard.press('Tab')
      await removeGerman.focus()
      await expect(removeGerman).toHaveCSS('color', accentColor)
      await expect(removeGerman).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await removeGerman.evaluate(element => element.blur())
      await expect(removeGerman).not.toHaveCSS('color', accentColor)
    }
    await enableTranslations.locator('..').locator('label.switch-label').click()
    await expect(enableTranslations).not.toBeChecked()
    await expect(languageSelect).toBeDisabled()
    await expect(removeGerman).toBeDisabled()
    await removeGerman.hover()
    await expect(removeGerman).not.toHaveCSS('color', accentColor)
    await expect(removeGerman).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await enableTranslations.locator('..').locator('label.switch-label').click()
    await removeGerman.click()
    await expect(ignoredLanguages).toHaveCount(0)
  })

  test('keeps SponsorBlock category controls inside its equal column layout', async ({ page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()

    const categories = addOns.locator('.sponsorBlockCategory')
    await expect(categories).toHaveCount(10)
    expect(await categories.first().locator('..').evaluate(element => (
      getComputedStyle(element).display
    ))).toBe('grid')

    const paletteColors = await categories.evaluateAll(elements => elements.slice(0, 2).map(element => (
      getComputedStyle(element.querySelector('.select-icon')).color
    )))
    expect(paletteColors).toEqual(['rgb(76, 175, 80)', 'rgb(255, 235, 59)'])

    const expectControlsInsideCategories = async () => {
      const maximumOverflow = await categories.evaluateAll(elements => Math.max(...elements.flatMap(element => {
        const categoryBounds = element.getBoundingClientRect()
        return Array.from(element.querySelectorAll('.select')).map(select => {
          const selectBounds = select.getBoundingClientRect()
          return Math.max(
            categoryBounds.left - selectBounds.left,
            selectBounds.right - categoryBounds.right
          )
        })
      })))
      expect(maximumOverflow).toBeLessThanOrEqual(1)
    }

    await expectControlsInsideCategories()
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 95)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    await expectControlsInsideCategories()
  })

  test('edits the SponsorBlock channel whitelist shared with the player', async ({ page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    const channelId = 'UC0000000000000000000000'
    await page.evaluate(async id => {
      const store = window.$store
      await store.dispatch('updateUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockChannelWhitelist', [id])
    }, channelId)

    const channels = addOns.locator('.ft-input-tags-component').filter({ hasText: 'Excluded Channels' })
    await expect(channels.locator('.name')).toHaveText(channelId)
    await channels.getByRole('button', { name: 'Remove' }).click()
    await expect(channels.locator('.name')).toHaveCount(0)
    expect(await page.evaluate(() => {
      const store = window.$store
      return store.getters.getSponsorBlockChannelWhitelist
    })).toEqual([])
  })

  test('shows saved SponsorBlock channels with names and avatars above the next setting', async ({ page }) => {
    const channelId = 'UC0000000000000000000000'
    const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#7056a8"/><text x="24" y="31" text-anchor="middle" fill="white" font-size="20">EC</text></svg>')
    await page.route(`**/api/v1/channels/${channelId}*`, route => route.fulfill({
      json: { author: 'Example Channel', authorThumbnails: [{ url: avatar }], tabs: [] }
    }))
    await goTo(page, 'settings')
    await page.evaluate(async id => {
      const store = window.$store
      await store.dispatch('updateBackendPreference', 'invidious')
      await store.dispatch('updateUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
      await store.dispatch('updateSponsorBlockChannelWhitelist', [id])
    }, channelId)

    const addOns = await goToSettingsSection(page, 'add-ons')
    const channels = addOns.locator('.ft-input-tags-component').filter({ hasText: 'Excluded Channels' })
    await expect(channels.locator('.name')).toHaveText('Example Channel')
    const avatarImage = channels.locator('img.tag-icon')
    await expect(avatarImage).toHaveAttribute('src', avatar)
    await expect.poll(() => avatarImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 95)
    })

    const gap = await channels.evaluate(element => {
      const nextSetting = element.closest('.ft-flex-box').nextElementSibling
      return nextSetting.getBoundingClientRect().top - element.getBoundingClientRect().bottom
    })
    expect(gap).toBeGreaterThanOrEqual(12)
    expect(await page.evaluate(() => {
      const store = window.$store
      return store.getters.getSponsorBlockChannelWhitelist
    })).toEqual([channelId])
  })

  test('loads saved SponsorBlock channel details only while the control is visible', async ({ page }) => {
    const channelId = 'UC0000000000000000000000'
    let lookups = 0
    await page.route(`**/api/v1/channels/${channelId}*`, route => {
      lookups++
      return route.fulfill({ json: { author: 'Example Channel', authorThumbnails: [{ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }], tabs: [] } })
    })
    await goTo(page, 'settings')
    await page.evaluate(async id => {
      const store = window.$store
      await store.dispatch('updateBackendPreference', 'invidious')
      await store.dispatch('updateUseSponsorBlock', false)
      await store.dispatch('updateUseDeArrowTitles', false)
      await store.dispatch('updateUseDeArrowThumbnails', false)
      await store.dispatch('updateSponsorBlockChannelWhitelist', [id])
    }, channelId)

    const addOns = await goToSettingsSection(page, 'add-ons')
    const channels = addOns.locator('.ft-input-tags-component').filter({ hasText: 'Excluded Channels' })
    await expect(channels).toHaveCount(0)
    // Excluded channels only affect SponsorBlock, so DeArrow alone keeps them hidden.
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUseDeArrowTitles', true)
      await store.dispatch('updateUseDeArrowThumbnails', true)
    })
    await expect(addOns.getByRole('textbox', { name: /^SponsorBlock API URL/i })).toBeVisible()
    await expect(channels).toHaveCount(0)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(lookups).toBe(0)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUseSponsorBlock', true)
    })
    await expect(channels.locator('.name')).toHaveText('Example Channel')
    expect(lookups).toBe(1)
  })

  test('retries an unresolved SponsorBlock channel when its tags are shown again', async ({ page }) => {
    const channelId = 'UC0000000000000000000000'
    let lookups = 0
    const firstLookupFailed = page.waitForEvent('console', message => (
      message.type() === 'error' && message.text().includes('Temporary channel lookup failure')
    ))
    await page.route(`**/api/v1/channels/${channelId}*`, route => {
      lookups++
      return route.fulfill({
        json: lookups === 1
          ? { error: 'Temporary channel lookup failure' }
          : { author: 'Example Channel', authorThumbnails: [{ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }], tabs: [] }
      })
    })
    await goTo(page, 'settings')
    await page.evaluate(async id => {
      const store = window.$store
      await store.dispatch('updateBackendPreference', 'invidious')
      await store.dispatch('updateUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockChannelWhitelist', [id])
    }, channelId)

    const addOns = await goToSettingsSection(page, 'add-ons')
    const channels = addOns.locator('.ft-input-tags-component').filter({ hasText: 'Excluded Channels' })
    await firstLookupFailed
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    await expect(channels.locator('.name')).toHaveText(channelId)
    const showItems = channels.getByRole('checkbox', { name: 'Show Added Items' })
    await expect(showItems).toBeChecked()
    await channels.locator('.pure-checkbox label').click()
    await expect(showItems).not.toBeChecked()
    await channels.locator('.pure-checkbox label').click()
    await expect(showItems).toBeChecked()
    await expect(channels.locator('.name')).toHaveText('Example Channel')
    expect(lookups).toBe(2)
  })

  test('retries a SponsorBlock lookup when tags are reopened while it is pending', async ({ page }) => {
    const channelId = 'UC0000000000000000000000'
    let lookups = 0
    let finishFirstLookup
    const firstLookupPending = new Promise(resolve => { finishFirstLookup = resolve })
    await page.route(`**/api/v1/channels/${channelId}*`, async route => {
      lookups++
      if (lookups === 1) await firstLookupPending
      await route.fulfill({
        json: lookups === 1
          ? { error: 'This channel does not exist.' }
          : { author: 'Example Channel', authorThumbnails: [{ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }], tabs: [] }
      })
    })
    await goTo(page, 'settings')
    await page.evaluate(async id => {
      const store = window.$store
      await store.dispatch('updateBackendPreference', 'invidious')
      await store.dispatch('updateUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockChannelWhitelist', [id])
    }, channelId)

    const addOns = await goToSettingsSection(page, 'add-ons')
    const channels = addOns.locator('.ft-input-tags-component').filter({ hasText: 'Excluded Channels' })
    await expect.poll(() => lookups).toBe(1)
    const showItems = channels.getByRole('checkbox', { name: 'Show Added Items' })
    await expect(showItems).toBeChecked()
    await channels.locator('.pure-checkbox label').click()
    await expect(showItems).not.toBeChecked()
    await channels.locator('.pure-checkbox label').click()
    await expect(showItems).toBeChecked()
    expect(lookups).toBe(1)
    finishFirstLookup()
    await expect(channels.locator('.name')).toHaveText('Example Channel')
    expect(lookups).toBe(2)
  })

  test('uses current backend options when a saved channel lookup finishes', async ({ page }) => {
    const channelId = 'UC0000000000000000000000'
    let lookups = 0
    let finishFirstLookup
    const firstLookupPending = new Promise(resolve => { finishFirstLookup = resolve })
    await page.route(`**/api/v1/channels/${channelId}*`, async route => {
      const lookup = ++lookups
      if (lookup === 1) await firstLookupPending
      await route.fulfill({
        json: {
          author: lookup === 1 ? 'Old Backend Channel' : 'Current Backend Channel',
          authorThumbnails: [{ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }],
          tabs: []
        }
      })
    })
    await goTo(page, 'settings')
    await page.evaluate(async id => {
      const store = window.$store
      await store.dispatch('updateBackendPreference', 'invidious')
      await store.dispatch('updateBackendFallback', false)
      await store.dispatch('updateUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockChannelWhitelist', [id])
    }, channelId)

    const addOns = await goToSettingsSection(page, 'add-ons')
    const channels = addOns.locator('.ft-input-tags-component').filter({ hasText: 'Excluded Channels' })
    await expect.poll(() => lookups).toBe(1)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateBackendFallback', true)
    })
    finishFirstLookup()
    await expect(channels.locator('.name')).toHaveText('Current Backend Channel')
    expect(lookups).toBe(2)
  })

  test('offers a custom SponsorBlock category color initialized from its default', async ({ app, page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()

    const sponsorCategory = addOns.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Sponsor$/ }) })
    const colorSelect = sponsorCategory.locator('.select-text').first()
    await colorSelect.click()

    const colorOptions = page.locator('.selectDropdown .selectOption')
    await expect(colorOptions.first()).toHaveText('Custom color')
    await colorOptions.first().click()

    const picker = sponsorCategory.locator('.ftColorPicker')
    await expect(picker.getByRole('button', { name: 'Custom color' })).toBeVisible()
    await expect(picker.locator('code')).toHaveText('#4caf50')
    await expect(sponsorCategory.locator('.select-icon').first())
      .toHaveCSS('color', 'rgb(76, 175, 80)')

    await picker.getByRole('button', { name: 'Custom color' }).click()
    const pickerDialog = page.getByRole('dialog', { name: 'Custom color' })
    const hexColor = pickerDialog.getByLabel('Hex color')
    await hexColor.fill('#123456')
    await hexColor.press('Enter')
    await pickerDialog.getByRole('button', { name: 'Apply' }).click()

    await expect(picker.locator('code')).toHaveText('#123456')
    await expect(sponsorCategory.locator('.select-icon').first())
      .toHaveCSS('color', 'rgb(18, 52, 86)')
    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return settings.sponsorBlockSponsor
    }).toEqual({ color: '#123456', skip: 'autoSkip' })
  })

  test('aligns Playback toggles and selects in a narrow settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 700
      }))
    })
    const playback = await goToSettingsSection(page, 'playback')
    const playerSettings = playback.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Player', exact: true })
    })

    async function expectControlsAligned() {
      const firstToggles = playerSettings.locator('.playerSwitchGrid > .switch-ctn')
      await expect(firstToggles.first()).toBeVisible()
      const toggleLabelLeftEdges = await firstToggles.evaluateAll(elements => elements.slice(0, 3)
        .map(element => element.querySelector('.switch-label-text').getBoundingClientRect().left))
      expect.soft(Math.max(...toggleLabelLeftEdges) - Math.min(...toggleLabelLeftEdges))
        .toBeLessThanOrEqual(1)

      const tooltipToggle = playerSettings.locator('.switch-ctn')
        .filter({ hasText: 'Show Skip Silence Toggle' })
      const toggleCenterOffset = await tooltipToggle.evaluate(element => {
        const text = element.querySelector('.switch-label-text')
        const textBounds = text.getBoundingClientRect()
        const knob = element.querySelector('.switch-thumb').getBoundingClientRect()
        const knobCenter = knob.top + knob.height / 2
        return Math.abs(knobCenter - (textBounds.top + textBounds.height / 2))
      })
      expect.soft(toggleCenterOffset).toBeLessThanOrEqual(1)

      const selectLeftEdges = await playerSettings.locator('.select .select-text')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left))
      expect.soft(selectLeftEdges).toHaveLength(4)
      expect.soft(Math.max(...selectLeftEdges) - Math.min(...selectLeftEdges))
        .toBeLessThanOrEqual(1)
    }

    await expectControlsAligned()
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 125)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.25, 2)
    await expectControlsAligned()
  })

  test('keeps quick playback speed actions sticky and reflects the default state', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    const customizeButton = page.getByRole('button', {
      name: 'Customize Quick Playback Speed Bar'
    })
    await expect(customizeButton).toBeDisabled()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Use Quick Playback Speed Bar' })
      .click()
    await expect(customizeButton).toBeEnabled()
    await customizeButton.click()

    await expect(page.locator('.settingsBreadcrumb [data-icon="gauge-high"]')).toBeVisible()

    const scroller = page.locator('.settingsSubpageScroll')
    const toolbar = page.locator('.quickPlaybackSpeedToolbar')
    const list = page.locator('.quickPlaybackSpeedList')
    const reset = page.getByRole('button', { name: 'Reset to Defaults' })
    await expect(reset).toBeDisabled()

    const [scrollerBounds, scrollerClientWidth, listBounds] = await Promise.all([
      scroller.boundingBox(),
      scroller.evaluate(element => element.clientWidth),
      list.boundingBox()
    ])
    expect(listBounds.width).toBeLessThanOrEqual(800)
    expect(Math.abs(
      listBounds.x + listBounds.width / 2 - scrollerBounds.x - scrollerClientWidth / 2
    )).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: 'Add Playback Speed' }).click()
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()

    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => {
      const [currentScrollerBounds, toolbarBounds] = await Promise.all([
        scroller.boundingBox(),
        toolbar.boundingBox()
      ])
      return Math.abs(toolbarBounds.y - currentScrollerBounds.y)
    }).toBeLessThanOrEqual(1)
    await expect(toolbar).toBeVisible()
  })

  test('aligns caption color controls with neighboring selects', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const edgeStyle = page.getByRole('combobox', { name: 'Edge Style' })
    await edgeStyle.click()
    await page.getByRole('option', { name: 'Drop Shadow' }).click()

    const edgeStyleControl = edgeStyle.locator('..').locator('..')
    const edgeColorControl = page.locator('.captionColorControl').filter({ hasText: 'Edge Color' })
    const edgeColorTrigger = edgeColorControl.getByRole('button', { name: 'Edge Color' })
    const [styleControlBounds, colorControlBounds, colorTriggerBounds] = await Promise.all([
      edgeStyleControl.boundingBox(),
      edgeColorControl.boundingBox(),
      edgeColorTrigger.boundingBox()
    ])

    expect(colorControlBounds.y).toBeCloseTo(styleControlBounds.y, 0)
    expect(colorControlBounds.height).toBeCloseTo(styleControlBounds.height, 0)
    expect(colorTriggerBounds.y).toBeCloseTo(colorControlBounds.y, 0)
    expect(colorTriggerBounds.height).toBeCloseTo(colorControlBounds.height, 0)
  })

  test('stacks caption controls at narrow settings widths', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 420,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const preview = page.locator('.captionPreview')
    const initialPreviewBounds = await preview.boundingBox()
    await page.getByRole('slider', { name: /Font Size/ }).fill('400')
    const enlargedPreviewBounds = await preview.boundingBox()
    expect(initialPreviewBounds.height).toBe(240)
    expect(enlargedPreviewBounds.height).toBe(initialPreviewBounds.height)

    const controls = page.locator('.captionControls')
    expect(await controls.evaluate(element => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length
    })).toBe(1)
    await attachScreenshot('caption settings at 420px')

    const contentBounds = await page.locator('.settingsContent').boundingBox()
    expect(await page.locator('.captionControl').evaluateAll((elements, rightEdge) => {
      return elements.every(element => element.getBoundingClientRect().right <= rightEdge + 1)
    }, contentBounds.x + contentBounds.width)).toBe(true)
  })

  test('enables YouTube-style Shorts by default in player settings', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
  })

  test('disables the cross-tab mini player while automatic PiP on tab change is enabled', async ({ page }) => {
    const playback = await goToSettingsSection(page, 'playback')
    const miniPlayerToggle = playback.getByRole('checkbox', {
      name: 'Keep a mini player on screen when switching tabs'
    })
    const automaticPipToggle = playback.getByRole('checkbox', {
      name: 'When switching tabs',
      exact: true
    })
    const automaticPipLabel = playback.locator('.pure-checkbox label')
      .filter({ hasText: 'When switching tabs' })

    const keepPlayingToggle = playback.getByRole('checkbox', {
      name: 'Keep playing when navigating away from a video'
    })
    await expect(keepPlayingToggle).toBeChecked()
    await expect(miniPlayerToggle).toBeDisabled()
    await expect(miniPlayerToggle).toBeChecked()
    await playback.locator('label.switch-label')
      .filter({ hasText: 'Keep playing when navigating away from a video' })
      .click()
    await expect(keepPlayingToggle).not.toBeChecked()
    await expect(miniPlayerToggle).toBeEnabled()
    await expect(miniPlayerToggle).not.toBeChecked()
    await playback.locator('label.switch-label')
      .filter({ hasText: 'Keep a mini player on screen when switching tabs' })
      .click()
    await expect(miniPlayerToggle).toBeChecked()

    await automaticPipLabel.click()
    await expect(automaticPipToggle).toBeChecked()
    await expect(miniPlayerToggle).toBeDisabled()
    await expect(miniPlayerToggle).toBeChecked()

    await automaticPipLabel.click()
    await expect(automaticPipToggle).not.toBeChecked()
    await expect(miniPlayerToggle).toBeEnabled()
    await expect(miniPlayerToggle).toBeChecked()
  })

  test('shows voice-over settings disabled until translation is enabled', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="add-ons"]').click()

    const settingsContent = page.locator('.settingsContent')
    const voiceOverSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: /Voice-over translation/ })
    })
    await settingsContent.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(voiceOverSection).toBeInViewport()

    const enableToggle = page.getByRole('checkbox', { name: 'Enable voice-over translation' })
    const backgroundToggle = page.getByRole('checkbox', {
      name: 'Start preparing voice-over translations in the background'
    })
    const languageSelect = page.getByRole('combobox', {
      name: 'Voice-over translation language'
    })

    await expect(enableToggle).not.toBeChecked()
    await expect(backgroundToggle).toBeDisabled()
    await expect(languageSelect).toBeDisabled()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Enable voice-over translation' })
      .click()

    await expect(backgroundToggle).toBeEnabled()
    await expect(backgroundToggle).not.toBeChecked()
    await expect(languageSelect).toBeEnabled()
    await expect(page.getByRole('checkbox', {
      name: 'Cache voice-over translations for one day'
    })).toHaveCount(0)
    await expect(page.getByText('Supported source languages: Russian, English, Chinese, Korean,'))
      .toBeVisible()
  })
})

test.describe('preferred caption language migration', () => {
  test.use({ seed: { settings: { preferredCaptionLocale: 'zh-TW' } } })

  test('persists the equivalent YouTube language code for existing users', async ({ app, page }) => {
    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return settings.preferredCaptionLocale
    }).toBe('zh-Hant')

    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByRole('combobox', { name: 'Preferred Caption Language' }))
      .toContainText('Chinese (Traditional)')
  })
})

test.describe('existing Japanese caption preference', () => {
  test.use({ seed: { settings: { preferredCaptionLocale: 'ja' } } })

  test('remains selected before player caption metadata is available', async ({ page }) => {
    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByRole('combobox', { name: 'Preferred Caption Language' }))
      .toContainText('Japanese')
  })
})

test.describe('live chat replay visibility migration', () => {
  test.use({ seed: { settings: { hideLiveChat: true } } })

  test('preserves the old live chat visibility choice for replays', async ({ app }) => {
    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return {
        liveChat: settings.hideLiveChat,
        replay: settings.hideLiveChatReplay
      }
    }).toEqual({ liveChat: true, replay: true })
  })
})

test.describe('SponsorBlock highlight settings', () => {
  test.use({
    seed: {
      settings: {
        highlightChangedSettings: true,
        sponsorBlockHighlight: {
          color: 'Blue',
          skip: 'autoSkip'
        },
        useSponsorBlock: true
      }
    }
  })

  test('preserves the stored skip option when resetting only the color', async ({ app }) => {
    const { page } = app
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="add-ons"]').click()

    const highlightCategory = page.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Highlight$/ }) })
    const color = highlightCategory.locator('select').nth(0)
    const skipOption = highlightCategory.locator('select').nth(1)

    await expect(color).toHaveValue('Blue')
    await expect(skipOption).toHaveValue('promptToSkip')
    await highlightCategory.getByRole('button', {
      name: 'Reset this setting to its default'
    }).click()
    await expect(color).toHaveValue('Red')

    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return settings.sponsorBlockHighlight
    }).toEqual({
      color: 'Red',
      skip: 'autoSkip'
    })
  })
})
