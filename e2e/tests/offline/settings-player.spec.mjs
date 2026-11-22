import { test, expect, goTo, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'

test('DLNA, Google Cast and FCast casting are opt in from Player Settings', async ({ page }) => {
  const playback = await goToSettingsSection(page, 'playback')
  for (const label of ['Enable DLNA casting', 'Enable Google Cast', 'Enable FCast']) {
    const toggle = playback.getByRole('checkbox', { name: label })
    await expect(toggle).not.toBeChecked()
    await playback.locator('label.switch-label').filter({ hasText: label }).click()
    await expect(toggle).toBeChecked()
  }
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
    await page.locator('.captionControl').getByRole('slider', { name: /Font Size/ }).fill('400')
    await expect.poll(() => page.evaluate(() => JSON.parse(window.$store.getters.getDefaultCaptionSettings).fontScaleFactor)).toBe(4)
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

  test('disables automatic PiP on tab change while videos keep playing in the mini player', async ({ page }) => {
    const playback = await goToSettingsSection(page, 'playback')
    const leavingVideo = playback.getByRole('combobox', { name: 'When leaving a video' })
    // Its tooltip explains why it is disabled and joins its name.
    const automaticPipToggle = playback.getByRole('checkbox', { name: /^When switching tabs/ })

    await expect(leavingVideo).toHaveText('Keep playing in a mini player')
    await expect(automaticPipToggle).toBeDisabled()

    await leavingVideo.click()
    await page.getByRole('option', { name: 'Stop playing', exact: true }).click()
    await expect(automaticPipToggle).toBeEnabled()
    await playback.locator('.pure-checkbox label')
      .filter({ hasText: 'When switching tabs' })
      .click()
    await expect(automaticPipToggle).toBeChecked()
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

test.describe('video description visibility migration', () => {
  test.use({ seed: { settings: { hideVideoDescription: true } } })

  test('turns Hide Video Description into the Video descriptions select', async ({ app, page }, testInfo) => {
    const focus = await goToSettingsSection(page, 'focus')
    const descriptionMode = focus.getByRole('combobox', { name: 'Video descriptions' })
    await expect(descriptionMode).toHaveText('Hide')
    await expect(focus.getByRole('checkbox', { name: 'Hide Video Description' })).toHaveCount(0)

    await descriptionMode.click()
    await page.getByRole('option', { name: 'Expanded', exact: true }).click()
    await expect(descriptionMode).toHaveText('Expanded')
    await descriptionMode.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('video-descriptions-setting.png') })
    await expect.poll(() => (
      latestSettings(readDatastore(app.userDataDir, 'settings')).videoDescriptionMode
    )).toBe('expanded')

    const { page: relaunchedPage } = await app.relaunch()
    const relaunchedFocus = await goToSettingsSection(relaunchedPage, 'focus')
    await expect(relaunchedFocus.getByRole('combobox', { name: 'Video descriptions' })).toHaveText('Expanded')
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
