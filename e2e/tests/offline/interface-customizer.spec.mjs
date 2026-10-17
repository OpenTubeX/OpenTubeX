import { test, expect, goTo, openInterfaceCustomizer, setWindowSize } from '../../helpers/app.mjs'

test.describe('interface customizer', () => {
  test('previews navigation changes on desktop and mobile layouts', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'navigation')
    const preview = customizer.locator('.navigationPreview')
    const previewIds = () => preview.locator('[data-preview-navigation-item]').evaluateAll(elements => (
      elements.map(element => element.dataset.previewNavigationItem)
    ))
    // The preview applies the same availability rules as the real side navigation.
    const editorIds = () => page.locator('.sideNav .inner > a.navOption').evaluateAll(elements => (
      elements.map(element => element.getAttribute('href').replace('#/', ''))
    ))

    await expect.poll(async () => JSON.stringify(await previewIds()) === JSON.stringify(await editorIds()), { message: 'the preview matches the editor order' }).toBe(true)
    await customizer.locator('[data-navigation-item-id="subscriptions"]').getByRole('button', { name: /^Move .* up$/ }).click()
    await expect.poll(async () => JSON.stringify(await previewIds()) === JSON.stringify(await editorIds()), { message: 'the preview matches the editor order' }).toBe(true)
    expect((await previewIds())[0]).toBe('subscriptions')
    await customizer.locator('[data-navigation-item-id="history"]').getByRole('button', { name: /^Remove / }).click()
    await expect(preview.locator('[data-preview-navigation-item="history"]')).toHaveCount(0)

    await customizer.getByRole('tab', { name: 'Mobile', exact: true }).click()
    await expect(preview).toHaveClass(/mobile/)
    const mobileItems = preview.locator('.previewBottomBar [data-preview-navigation-item]')
    await expect(mobileItems).toHaveCount(5)
    await expect(mobileItems.last()).toHaveAttribute('data-preview-navigation-item', 'more')
    await customizer.locator('label.switch-label').filter({ hasText: 'Compact navigation bar' }).click()
    await expect(preview).toHaveClass(/compactLabels/)
    await expect(mobileItems.first().locator('.previewNavLabel')).toBeHidden()

    // The selected preview layout belongs to its tab.
    await customizer.locator('[data-settings-subpage-tab="player"]').click()
    await customizer.locator('[data-settings-subpage-tab="navigation"]').click()
    await expect(customizer.getByRole('tab', { name: 'Mobile', exact: true })).toHaveAttribute('aria-selected', 'true')
  })

  test('renders the real quick settings menu as its preview', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'quick settings')
    const preview = customizer.locator('.quickSettingsPreview .quickSettingsMenu')
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-setting-id="baseTheme"]')).toBeVisible()
    await customizer.locator('.selectedSetting[data-setting-id="baseTheme"]').getByRole('button', { name: /^Remove / }).click()
    await expect(preview.locator('[data-setting-id="baseTheme"]')).toHaveCount(0)

    // Controls in the preview change the real settings.
    const toggle = preview.getByRole('checkbox', { name: 'Hide Comments' })
    await expect(toggle).not.toBeChecked()
    await preview.locator('label.switch-label').filter({ hasText: 'Hide comments' }).click()
    await expect(toggle).toBeChecked()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getHideComments)).toBe(true)
  })

  test('previews player controls, menu entries and paused visibility', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'player')
    const preview = customizer.locator('.playerPreview')
    const toggle = label => customizer.locator('.playerAppearanceEditor label.switch-label').filter({ hasText: label })

    await expect(preview.locator('[data-preview-control="screenshot"]')).toHaveCount(0)
    await toggle('Enable screenshot').click()
    await expect(preview.locator('[data-preview-control="screenshot"]')).toBeVisible()
    await toggle('Use Quick Playback Speed Bar').click()
    await expect(preview.locator('[data-preview-control="quickPlaybackSpeedBar"]')).toBeVisible()

    await customizer.getByRole('tab', { name: 'Player menu', exact: true }).click()
    await expect(preview.locator('[data-preview-overflow-item="lightsOff"]')).toHaveCount(0)
    await toggle('Show Lights Off Toggle').click()
    await expect(preview.locator('[data-preview-overflow-item="lightsOff"]')).toBeVisible()

    await customizer.getByRole('tab', { name: 'Paused', exact: true }).click()
    await expect(preview.locator('.previewControls')).toBeVisible()
    await expect(preview.locator('.previewTitle')).toBeVisible()
    await toggle('Show Player Controls').click()
    await toggle('Show Video Title').click()
    await expect(preview.locator('.previewControls')).toBeHidden()
    await expect(preview.locator('.previewTitle')).toBeHidden()
    await expect(preview.locator('.previewFullscreenActions')).toBeVisible()
    await expect.poll(() => page.evaluate(() => [
      window.$store.getters.getEnableScreenshot,
      window.$store.getters.getShowLightsOffToggle,
      window.$store.getters.getShowPlayerControlsWhenPaused,
    ])).toEqual([true, true, false])
  })

  test('previews the fullscreen action order', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'fullscreen actions')
    const actions = customizer.locator('.previewFullscreenActions [data-preview-fullscreen-action]')
    const previewIds = () => actions.evaluateAll(elements => elements.map(element => element.dataset.previewFullscreenAction))
    const editorIds = () => customizer.locator('.selectedAction').evaluateAll(elements => (
      elements.map(element => element.dataset.fullscreenActionId)
    ))

    await expect.poll(async () => JSON.stringify(await previewIds()) === JSON.stringify(await editorIds()), { message: 'the preview matches the editor order' }).toBe(true)
    await customizer.locator('[data-fullscreen-action-id="share"]').getByRole('button', { name: /^Move .* up$/ }).click()
    await expect.poll(async () => JSON.stringify(await previewIds()) === JSON.stringify(await editorIds()), { message: 'the preview matches the editor order' }).toBe(true)
    const rows = customizer.locator('.selectedAction')
    for (let remaining = await rows.count(); remaining > 0; remaining--) {
      await rows.last().getByRole('button', { name: /^Remove / }).click()
      await expect(rows).toHaveCount(remaining - 1)
    }
    await expect(customizer.locator('.previewFullscreenActions')).toHaveCount(0)
  })

  test('opens the matching tab from settings search', async ({ page }) => {
    await goTo(page, 'settings')
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('Add action')
    await page.getByRole('button', { name: 'Add action', exact: true }).click()
    await expect(page.locator('[data-settings-subpage-tab="fullscreenActions"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.selectedAction').first()).toBeVisible()
  })

  test('restores each tab editor scroll position when switching tabs', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 900, height: 600 })
    const customizer = await openInterfaceCustomizer(page, 'navigation')
    const scroller = customizer.locator('.customizerEditorScroll')
    const scrollTop = () => scroller.evaluate(element => element.scrollTop)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(scrollTop).toBeGreaterThan(0)
    const navigationTop = await scrollTop()

    await customizer.locator('[data-settings-subpage-tab="quickSettings"]').click()
    await expect.poll(scrollTop).toBeLessThanOrEqual(1)
    await scroller.evaluate(element => { element.scrollTop = 40 })
    await expect.poll(scrollTop).toBeGreaterThan(30)
    const quickSettingsTop = await scrollTop()

    await customizer.locator('[data-settings-subpage-tab="navigation"]').click()
    await expect.poll(async () => Math.abs(await scrollTop() - navigationTop)).toBeLessThanOrEqual(1)
    await customizer.locator('[data-settings-subpage-tab="quickSettings"]').click()
    await expect.poll(async () => Math.abs(await scrollTop() - quickSettingsTop)).toBeLessThanOrEqual(1)

    // A shortened editor clamps its stored position to the remaining content.
    await page.evaluate(() => window.$store.dispatch('updateNavigationItems', ['home']))
    await customizer.locator('[data-settings-subpage-tab="navigation"]').click()
    await expect.poll(() => scroller.evaluate(element => (
      element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1
    ))).toBe(true)
    await expect.poll(scrollTop).toBeLessThan(navigationTop)
  })

  test('labels the preview stage with the selected preview mode', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'player')
    const stage = customizer.getByRole('tabpanel', { name: 'Playing', exact: true })
    await expect(stage).toHaveClass(/previewStage/)
    await customizer.getByRole('tab', { name: 'Paused', exact: true }).click()
    await expect(customizer.getByRole('tabpanel', { name: 'Paused', exact: true })).toHaveClass(/previewStage/)
    await customizer.locator('[data-settings-subpage-tab="quickSettings"]').click()
    await expect(customizer.locator('.previewStage')).not.toHaveAttribute('role', 'tabpanel')
  })

  test('gives preview mode tabs a full touch target on touch screens', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'player')
    const mode = customizer.getByRole('tab', { name: 'Paused', exact: true })
    const session = await page.context().newCDPSession(page)
    try {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await expect.poll(() => page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
      await expect.poll(() => mode.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48)
    } finally {
      await session.detach()
    }
  })

  test('supports keyboard tab switching', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'navigation')
    const navigationTab = customizer.locator('[data-settings-subpage-tab="navigation"]')
    await navigationTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(customizer.locator('[data-settings-subpage-tab="quickSettings"]')).toBeFocused()
    await expect(customizer.locator('.selectedSettings')).toBeVisible()
    await page.keyboard.press('End')
    await expect(customizer.locator('[data-settings-subpage-tab="fullscreenActions"]')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(navigationTab).toHaveAttribute('aria-selected', 'true')
  })

  test('keeps previews inside their stage at narrow and wide widths', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 800 })
    const customizer = await openInterfaceCustomizer(page, 'player')
    // The widest control bar: the speed bar must give way to the other controls.
    await page.evaluate(async () => {
      await window.$store.dispatch('updateUseQuickPlaybackSpeedBar', true)
      await window.$store.dispatch('updateEnableScreenshot', true)
    })
    for (const size of [{ width: 1200, height: 800 }, { width: 420, height: 760 }]) {
      if (size.width !== 1200) await setWindowSize(app, page, size)
      for (const mode of ['Playing', 'Player menu', 'Fullscreen', 'Paused']) {
        await customizer.getByRole('tab', { name: mode, exact: true }).click()
        await expect.poll(() => customizer.locator('.previewStage').evaluate(stage => {
          const bounds = stage.getBoundingClientRect()
          return [...stage.querySelectorAll('.previewPlayer, .previewOverflowMenu, .previewFullscreenActions, .previewButtonPanel')]
            .filter(element => {
              const rect = element.getBoundingClientRect()
              return rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5 ||
                rect.top < bounds.top - 0.5 || rect.bottom > bounds.bottom + 0.5
            })
            .map(element => element.className)
        }), { message: `${mode} preview elements outside the stage at ${size.width}px` }).toEqual([])
        await expect.poll(() => customizer.locator('.previewPlayer').evaluate(player => {
          const bounds = player.getBoundingClientRect()
          return [...player.querySelectorAll('.previewButtonPanel > *, .previewRightGroup > *')]
            .filter(element => element.getBoundingClientRect().right > bounds.right + 0.5)
            .map(element => element.className)
        }), { message: `${mode} controls past the player edge at ${size.width}px` }).toEqual([])
      }
    }
  })
})

test.describe('interface customizer with Invidious', () => {
  test.use({
    seed: {
      settings: { backendPreference: 'invidious', defaultInvidiousInstance: 'https://invidious.test' },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: 'UCpreviewchannel',
          name: 'Preview Channel',
          thumbnail: 'https://yt3.ggpht.com/preview-avatar=s176-c-k-c0x00ffffff-no-rj'
        }]
      }]
    }
  })

  test('loads navigation preview avatars through the selected backend', async ({ page }) => {
    await page.route('https://invidious.test/**', route => route.fulfill({ status: 404 }))
    const customizer = await openInterfaceCustomizer(page, 'navigation')
    const avatar = customizer.locator('.previewChannel img').first()
    await expect(avatar).toHaveAttribute('src', /^https:\/\/invidious\.test\//)
  })
})

test.describe('interface customizer with a custom profile image', () => {
  test.use({
    seed: {
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [],
        icon: {
          type: 'image',
          value: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
        }
      }]
    }
  })

  test('fits the profile image to the preview avatars', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'navigation')
    const expectFilled = async (avatar) => {
      const image = avatar.locator('img')
      await expect(image).toBeVisible()
      const [avatarBox, imageBox] = await Promise.all([avatar.boundingBox(), image.boundingBox()])
      expect(imageBox.width).toBeCloseTo(avatarBox.width, 0)
      expect(imageBox.height).toBeCloseTo(avatarBox.height, 0)
    }
    await expectFilled(customizer.locator('.previewProfile'))
    await customizer.locator('[data-settings-subpage-tab="quickSettings"]').click()
    await expectFilled(customizer.locator('.previewProfileTrigger'))
  })
})
