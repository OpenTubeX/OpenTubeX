import { test, expect, expectScrollAtRenderedEnd, openInterfaceCustomizer, setWindowSize } from '../../helpers/app.mjs'

test.describe('interface customizer', () => {
  test('previews the control bar order and moves removed buttons into the player menu', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'control bar')
    const preview = customizer.locator('.playerPreview')
    const previewIds = () => preview.locator('.previewRightGroup [data-preview-control]').evaluateAll(elements => (
      elements.map(element => element.dataset.previewControl).filter(id => id !== 'screenshot')
    ))
    const sectionIds = section => customizer.locator(`[data-placement-section="${section}"] .placementItem`).evaluateAll(elements => (
      elements.map(element => element.dataset.controlBarButtonId ?? element.dataset.playerMenuControlId ?? element.dataset.hiddenControlId)
    ))
    const menuIds = () => preview.locator('[data-preview-overflow-item]').evaluateAll(elements => (
      elements.map(element => element.dataset.previewOverflowItem)
    ))
    const row = id => customizer.locator(`[data-control-bar-button-id="${id}"]`)

    await expect.poll(() => sectionIds('bar')).toEqual(['chapters', 'autoplay', 'captions', 'menu', 'pictureInPicture', 'theatreMode', 'fullWindow', 'fullscreen'])
    // The chapters button sits next to the time instead.
    await expect.poll(previewIds).toEqual((await sectionIds('bar')).slice(1))
    await expect(preview.locator('[data-preview-chapters]')).toBeVisible()
    // The player menu holds every other control, so it cannot leave the control bar.
    await expect(row('menu').locator('[data-placement-action="lower"]')).toHaveCount(0)

    await row('fullscreen').getByRole('button', { name: /^Move .* up$/ }).click()
    for (const id of ['autoplay', 'pictureInPicture', 'theatreMode']) {
      await row(id).getByRole('button', { name: /to the player menu$/ }).click()
    }
    await expect.poll(previewIds).toEqual(['captions', 'menu', 'fullscreen', 'fullWindow'])

    // Removed buttons return to their place in the menu.
    await expect.poll(async () => {
      const ids = await menuIds()
      return [ids[ids.indexOf('sleepTimer') + 1], ...ids.slice(-2)]
    }).toEqual(['autoplay', 'pictureInPicture', 'theatreMode'])
    await expect.poll(async () => (await sectionIds('menu')).filter(id => ['autoplay', 'pictureInPicture', 'theatreMode'].includes(id)))
      .toEqual(['autoplay', 'pictureInPicture', 'theatreMode'])

    await customizer.locator('[data-player-menu-control-id="autoplay"]').getByRole('button', { name: 'Move Autoplay to the control bar' }).click()
    await expect(preview.locator('[data-preview-overflow-item="autoplay"]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.$store.getters.getControlBarButtons))
      // The screenshot button keeps its place while screenshots are disabled.
      .toEqual(['chapters', 'screenshot', 'captions', 'menu', 'fullscreen', 'fullWindow', 'autoplay'])

    // Fullscreen has no menu entry, so it goes straight to the hidden controls and back.
    await row('fullscreen').getByRole('button', { name: 'Hide Fullscreen' }).click()
    await expect.poll(() => sectionIds('hidden')).toContain('fullscreen')
    await customizer.locator('[data-hidden-control-id="fullscreen"]').getByRole('button', { name: 'Move Fullscreen to the control bar' }).click()
    await expect.poll(() => sectionIds('bar')).toEqual(['chapters', 'captions', 'menu', 'fullWindow', 'autoplay', 'fullscreen'])

    // Chapters leave the time for their place in the menu.
    await row('chapters').getByRole('button', { name: 'Move Chapters to the player menu' }).click()
    await expect(preview.locator('[data-preview-chapters]')).toHaveCount(0)
    await expect(preview.locator('[data-preview-overflow-item="chapters"]')).toBeVisible()

    await customizer.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect.poll(() => sectionIds('bar')).toEqual(['chapters', 'autoplay', 'captions', 'menu', 'pictureInPicture', 'theatreMode', 'fullWindow', 'fullscreen'])
    await expect(customizer.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  })

  test('places each control on the control bar, in the player menu or nowhere', async ({ page }) => {
    const customizer = await openInterfaceCustomizer(page, 'control bar')
    const preview = customizer.locator('.playerPreview')
    const previewItem = id => preview.locator(`[data-preview-overflow-item="${id}"]`)
    const menuRow = id => customizer.locator(`[data-player-menu-control-id="${id}"]`)
    const hiddenRow = id => customizer.locator(`[data-hidden-control-id="${id}"]`)
    const menuIds = () => customizer.locator('[data-placement-section="menu"] .placementItem').evaluateAll(elements => (
      elements.map(element => element.dataset.playerMenuControlId)
    ))
    const getter = name => page.evaluate(name => window.$store.getters[name], name)

    // Controls of features turned off in the player settings are left out, and
    // placing a control never turns its feature on or off.
    const anyRow = id => customizer.locator(`[data-control-bar-button-id="${id}"], [data-player-menu-control-id="${id}"], [data-hidden-control-id="${id}"]`)
    await expect(anyRow('lightsOff')).toHaveCount(0)
    await expect(anyRow('screenshot')).toHaveCount(0)
    await page.evaluate(() => window.$store.dispatch('updateShowLightsOffToggle', true))
    await expect(menuRow('lightsOff')).toBeVisible()
    await expect(previewItem('lightsOff')).toBeVisible()
    await menuRow('abRepeat').getByRole('button', { name: /^Hide / }).click()
    await expect(previewItem('abRepeat')).toHaveCount(0)
    await expect(hiddenRow('abRepeat')).toBeVisible()
    await expect.poll(() => getter('getHiddenPlayerMenuControls')).toEqual(['abRepeat'])
    expect(await getter('getDisableAbRepeat')).toBe(false)

    await expect(previewItem('ambientMode')).toBeVisible()
    await menuRow('ambientMode').getByRole('button', { name: 'Hide Ambient Mode' }).click()
    await expect(previewItem('ambientMode')).toHaveCount(0)
    await expect(hiddenRow('ambientMode')).toBeVisible()
    await expect.poll(() => getter('getHiddenPlayerMenuControls')).toEqual(['abRepeat', 'ambientMode'])

    // A hidden control returns to the menu before it can join the control bar.
    await menuRow('quality').getByRole('button', { name: 'Hide Resolution' }).click()
    await expect(previewItem('quality')).toHaveCount(0)
    await hiddenRow('quality').getByRole('button', { name: 'Move Resolution to the player menu' }).click()
    await menuRow('quality').getByRole('button', { name: 'Move Resolution to the control bar' }).click()
    await expect(preview.locator('.previewRightGroup [data-preview-control="quality"]')).toBeVisible()
    await expect(previewItem('quality')).toHaveCount(0)
    await expect(menuRow('quality')).toHaveCount(0)
    await expect.poll(() => getter('getHiddenPlayerMenuControls')).toEqual(['abRepeat', 'ambientMode'])
    // A control that was hidden before it joined the control bar returns to the menu.
    await page.evaluate(() => window.$store.dispatch('updateHiddenPlayerMenuControls', ['abRepeat', 'ambientMode', 'pictureInPicture']))
    await customizer.locator('[data-control-bar-button-id="pictureInPicture"]').getByRole('button', { name: 'Move Picture in Picture to the player menu' }).click()
    await expect(menuRow('pictureInPicture')).toBeVisible()
    await expect.poll(() => getter('getHiddenPlayerMenuControls')).toEqual(['abRepeat', 'ambientMode'])

    // Features that are turned off have no menu entry to place.
    await expect(customizer.locator('[data-player-menu-control-id="voiceOverTranslation"], [data-hidden-control-id="voiceOverTranslation"]')).toHaveCount(0)
    await page.evaluate(() => window.$store.dispatch('updateUseVoiceOverTranslation', true))
    await expect(menuRow('voiceOverTranslation')).toBeVisible()
    await page.evaluate(() => window.$store.dispatch('updateUseVoiceOverTranslation', false))
    await expect(menuRow('voiceOverTranslation')).toHaveCount(0)

    // Menu-only controls cannot join the control bar.
    await expect(menuRow('sleepTimer').locator('[data-placement-action="higher"]')).toHaveCount(0)

    // The menu order follows the editor, and the preview follows the menu order.
    const before = await menuIds()
    await menuRow('sleepTimer').getByRole('button', { name: /^Move .* up$/ }).click()
    const sleepIndex = before.indexOf('sleepTimer')
    const expected = before.slice()
    expected.splice(sleepIndex - 1, 2, 'sleepTimer', before[sleepIndex - 1])
    await expect.poll(menuIds).toEqual(expected)
    // The caption menu stays with the caption toggle on the control bar.
    await expect.poll(() => preview.locator('[data-preview-overflow-item]').evaluateAll(elements => (
      elements.map(element => element.dataset.previewOverflowItem).filter(id => id !== 'captions')
    ))).toEqual(expected.filter(id => ['audioTracks', 'playbackRate', 'sleepTimer', 'musicVisualizer', 'lightsOff', 'videoZoom', 'loop', 'pictureInPicture'].includes(id)))

    // Resetting restores the placement but leaves the features' own settings alone.
    await customizer.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect(customizer.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
    await expect.poll(() => getter('getHiddenPlayerMenuControls')).toEqual([])
    for (const id of ['ambientMode', 'quality', 'lightsOff', 'abRepeat']) await expect(menuRow(id)).toBeVisible()
    expect(await getter('getShowLightsOffToggle')).toBe(true)

    // Turning a feature off removes its control without moving it.
    await page.evaluate(() => window.$store.dispatch('updateDisableAbRepeat', true))
    await expect(anyRow('abRepeat')).toHaveCount(0)
    expect(await getter('getHiddenPlayerMenuControls')).toEqual([])
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

  // The desktop sizes stay above the phone layout's 600px at every UI scale.
  const scrollingMenuLayouts = [
    { name: 'phone grid', size: { width: 360, height: 760 }, resized: { width: 380, height: 640 }, grid: true },
    { name: 'desktop list', size: { width: 1200, height: 800 }, resized: { width: 1050, height: 780 }, grid: false },
  ]
  for (const layout of scrollingMenuLayouts) {
    test(`scrolls the ${layout.name} player menu preview and clamps it when its range shrinks`, { tag: '@scale' }, async ({ app, page }) => {
      const phone = layout.name.startsWith('phone')
      const toggles = ['ShowSkipSilenceButton', 'ShowMusicModeToggle', 'ShowLightsOffToggle', 'ShowVolumeBoostToggle', 'ShowMonoAudioToggle']
      const setToggles = value => page.evaluate(async ({ toggles, value }) => {
        for (const toggle of toggles) await window.$store.dispatch(`update${toggle}`, value)
      }, { toggles, value })
      await setWindowSize(app, page, layout.size)
      await page.evaluate(async (grid) => {
        await window.$store.dispatch('updateUsePlayerMenuGrid', grid)
        // The full control bar keeps most entries out of the menu.
        await window.$store.dispatch('updateControlBarButtons', ['menu', 'fullscreen'])
      }, layout.grid)
      const customizer = await openInterfaceCustomizer(page, 'control bar')
      await setToggles(true)
      if (phone) await customizer.getByRole('tab', { name: 'Player menu', exact: true }).click()
      const grid = customizer.locator('.previewOverflowGrid')
      // The phone menu keeps its scrollbar visible, the desktop one hides it while idle.
      const expectScrollbarToMatchRange = () => expect.poll(() => grid.evaluate((element, phone) => {
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        if (element.scrollHeight - element.clientHeight <= 1) {
          return !scrollbar.classList.contains('os-scrollbar-visible') || scrollbar.classList.contains('os-scrollbar-unusable')
        }
        const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handle = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return (!phone || getComputedStyle(scrollbar).visibility === 'visible') && handle.height >= 1 &&
          Math.abs(handle.bottom - track.bottom) <= 2
      }, phone)).toBe(true)
      const scrollToEnd = async () => {
        await grid.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expectScrollAtRenderedEnd(grid)
        await expectScrollbarToMatchRange()
      }

      // Like the player's menu, the entries that don't fit scroll into view.
      await expect.poll(() => grid.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(1)
      await scrollToEnd()

      await setToggles(false)
      await expectScrollAtRenderedEnd(grid)
      await expectScrollbarToMatchRange()

      await setToggles(true)
      await scrollToEnd()
      await setWindowSize(app, page, layout.resized)
      await expectScrollAtRenderedEnd(grid)
      await expectScrollbarToMatchRange()

      // The tiles take less room than the rows of the list.
      if (!layout.grid) {
        await scrollToEnd()
        await page.evaluate(() => window.$store.dispatch('updateUsePlayerMenuGrid', true))
        await expectScrollAtRenderedEnd(grid)
        await expectScrollbarToMatchRange()
      }
    })
  }
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
