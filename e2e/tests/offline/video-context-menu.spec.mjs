import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const VIDEO_ID = 'jNQXAC9IVRw'

const SEED = {
  settings: { backendFallback: true },
  history: [{
    _id: VIDEO_ID,
    videoId: VIDEO_ID,
    title: 'Video menu test',
    author: 'Test Channel',
    authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
    published: Date.now() - 86400000,
    description: 'Video description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    timeWatched: Date.now(),
    isWatched: false,
    isLive: false,
    type: 'video'
  }]
}

test.use({ seed: SEED })

for (const iconPack of ['material', 'remix']) {
  test.describe(`background tab shortcut with ${iconPack} icons`, () => {
    test.use({ seed: { ...SEED, settings: { ...SEED.settings, iconPack, extraThumbnailAction: 'history' } } })

    test('mobile menu replaces the extra thumbnail action and keeps the current tab active', async ({ page, attachScreenshot }) => {
      await goTo(page, 'history')
      const title = page.locator('.ft-list-video .title').first()
      const extraAction = page.locator('.ft-list-video .extraThumbnailActionIcon').first()
      await expect(extraAction).toBeAttached()
      const initialState = await page.evaluate(() => window.ftElectron.tabs.getState())
      const menu = page.locator('.mobileLinkActions')

      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      try {
        for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
          await page.setViewportSize(viewport)
          await expect(extraAction).toHaveCount(0)
          await title.scrollIntoViewIfNeeded()
          const titleBounds = await title.boundingBox()
          expect(titleBounds).not.toBeNull()
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ x: titleBounds.x + 8, y: titleBounds.y + 8 }]
          })
          await expect(menu).toBeVisible({ timeout: 3000 })
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          const row = menu.locator('.mobileThumbnailActionRow')
          const backgroundTab = row.getByRole('menuitem', { name: 'Open in a Background Tab', exact: true })
          await expect(backgroundTab).toBeVisible()
          await expect(row.getByRole('menuitem').first()).toHaveAccessibleName('Open in a Background Tab')
          await expect(row.getByRole('menuitem', { name: /Watched/ })).toHaveCount(0)
          await expect(menu.getByRole('menuitem', { name: 'Mark As Watched', exact: true })).toHaveCount(1)
          const bounds = await backgroundTab.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds.width).toBeGreaterThanOrEqual(48)
          expect(bounds.height).toBeGreaterThanOrEqual(48)
          await attachScreenshot(`background tab mobile menu ${iconPack} ${viewport.width}`)
          const before = await page.evaluate(() => window.ftElectron.tabs.getState())
          await backgroundTab.click()
          await expect(menu).toHaveCount(0)
          await expect(page).toHaveURL(/#\/history/)
          await expect.poll(async () => (await page.evaluate(() => window.ftElectron.tabs.getState())).tabs.length).toBe(before.tabs.length + 1)
          const after = await page.evaluate(() => window.ftElectron.tabs.getState())
          expect(after.activeTabId).toBe(initialState.activeTabId)
          const created = after.tabs.find(tab => !before.tabs.some(previous => previous.id === tab.id))
          expect(created.route.path).toBe(`/watch/${VIDEO_ID}`)
        }

        await page.setViewportSize({ width: 1600, height: 900 })
        await expect(extraAction).toBeAttached()
        await goToSettingsSection(page, 'general')
        await expect(page.getByRole('combobox', { name: /Extra thumbnail action button/i })).toBeVisible()
        await page.setViewportSize({ width: 375, height: 812 })
        await expect(page.getByRole('combobox', { name: /Extra thumbnail action button/i })).toHaveCount(0)
      } finally {
        await session.detach()
      }
    })
  })
}

for (const iconPack of ['material', 'remix']) {
  test.describe(`mobile toggle indicators with ${iconPack} icons`, () => {
    test.use({ seed: { ...SEED, settings: { ...SEED.settings, iconPack, baseTheme: iconPack === 'material' ? 'dark' : 'light' } } })

    test('saved videos and premiere notifications visibly reflect their checked state', async ({ page, attachScreenshot }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      const menu = page.locator('.mobileLinkActions')
      const openMenu = async pressed => page.evaluate(pressed => {
        document.querySelector('#app').__vue_app__._container._vnode.component.provides.openMobileContextActions({
          title: 'Scheduled video',
          actions: [{ label: 'Copy link', icon: ['fas', 'link'], run() {} }],
          thumbnailActions: [
            { label: pressed ? 'Remove from Watch Later' : 'Save to Watch Later', icon: ['fas', 'clock'], pressed, run() {} },
            { label: pressed ? 'Notification on' : 'Notify me', icon: ['fas', 'calendar-days'], pressed, run() {} }
          ]
        })
      }, pressed)

      const colors = () => menu.getByRole('menuitemcheckbox').evaluateAll(buttons => buttons.map(button => {
        const icon = button.querySelector('svg')
        return { color: getComputedStyle(icon).color, background: getComputedStyle(button).backgroundColor }
      }))
      for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
        await page.setViewportSize(viewport)
        await openMenu(false)
        await expect(menu.getByRole('menuitemcheckbox').first()).toHaveAttribute('aria-checked', 'false')
        const inactive = await colors()
        await openMenu(true)
        await expect(menu.getByRole('menuitemcheckbox').first()).toHaveAttribute('aria-checked', 'true')
        const active = await colors()
        for (let index = 0; index < active.length; index++) {
          expect(active[index].color).not.toBe(inactive[index].color)
          await expect(menu.getByRole('menuitemcheckbox').nth(index)).toHaveCSS('color', 'rgb(33, 150, 243)')
          expect(active[index].background).not.toBe(inactive[index].background)
          await menu.getByRole('menuitemcheckbox').nth(index).focus()
          expect((await colors())[index]).toEqual(active[index])
        }
        await attachScreenshot(`active mobile actions ${iconPack} ${viewport.width}`)
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSecColor', 'Purple'))
        await expect(menu.getByRole('menuitemcheckbox').first()).toHaveCSS('color', 'rgb(156, 39, 176)')
        expect(await colors()).not.toEqual(active)
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSecColor', 'Blue'))
        await openMenu(false)
        await expect(menu.getByRole('menuitemcheckbox').first()).toHaveAttribute('aria-checked', 'false')
        expect(await colors()).toEqual(inactive)
        await page.keyboard.press('Escape')
      }
    })
  })
}

test('video thumbnails, titles, and metadata share one menu', async ({ page, app, attachScreenshot }) => {
  await goTo(page, 'history')
  const card = page.locator('.ft-list-video').first()
  await expect(card.getByRole('button', { name: /^More options$/i })).toHaveCount(0)
  const menu = page.getByRole('menu', { name: 'Context menu', exact: true })

  for (const selector of ['.thumbnailImage', '.h3Title', '.videoInfo']) {
    await card.locator(selector).first().click({ button: 'right' })
    await expect(menu).toBeVisible()
    for (const label of ['Play Next', 'Add to Queue', 'Mark As Watched', 'Remove From History', 'Copy Link', 'Open in a New Tab', 'Open in a New Window']) {
      await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }

  await card.locator('.title').focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: /without playlist/ })).toHaveCount(0)
  await expect(menu).toHaveCSS('opacity', '1')
  await attachScreenshot('unified video context menu')
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused()
  await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
  await menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`https://youtu.be/${VIDEO_ID}`)
  await expect(card.locator('.title')).toBeFocused()

  await card.locator('.videoInfo').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Mark As Watched', exact: true }).click()
  await expect(card).toHaveClass(/watched/)
  await card.locator('.videoInfo').click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Unmark As Watched', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Remove From History', exact: true }).click()
  await expect(card).toHaveCount(0)
})

for (const uiScale of [100, 125]) {
  test.describe(`video context menu at ${uiScale}% UI scale`, () => {
    test.use({ seed: { ...SEED, settings: { ...SEED.settings, uiScale } } })

    test('right click and keyboard stay compact when touch input is available', async ({ page }) => {
      await goTo(page, 'history')
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      try {
        expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
        const title = page.locator('.ft-list-video .title').first()
        const menu = page.locator('.contextMenu')
        for (const input of ['mouse', 'keyboard']) {
          if (input === 'mouse') {
            await title.click({ button: 'right' })
          } else {
            await title.focus()
            await page.keyboard.press('Shift+F10')
          }
          await expect(menu).toBeVisible()
          const action = menu.getByRole('menuitem', { name: 'Mark As Watched', exact: true })
          await expect(action).toHaveCSS('font-size', '13px')
          await expect(action).toHaveCSS('min-block-size', '28px')
          await expect(menu.locator('.tabQuickActions button').first()).toHaveCSS('min-block-size', '30px')
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)
        }
      } finally {
        await session.detach()
      }
    })

    test('touch holds open the existing bottom menu without navigating', async ({ page, app }) => {
      await goTo(page, 'history')
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      const menu = page.locator('.mobileLinkActions')
      try {
        for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1024, height: 768 }]) {
          await page.setViewportSize(viewport)
          const card = page.locator('.ft-list-video').first()
          await card.locator('.thumbnailLink').scrollIntoViewIfNeeded()
          const bounds = await card.locator('.thumbnailLink').boundingBox()
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ x: bounds.x + 8, y: bounds.y + 8 }]
          })
          await expect(menu).toBeVisible({ timeout: 3000 })
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await expect(page).toHaveURL(/#\/history/)
          const actions = menu.getByRole('menuitem').filter({ visible: true })
          await expect(page.locator('.contextMenu')).toHaveCount(0)
          for (const name of ['Play Next', 'Add to Queue', 'Mark As Watched', 'Remove From History', 'Copy Link']) {
            await expect(menu.getByRole('menuitem', { name, exact: true })).toBeAttached()
          }
          const header = menu.locator('strong')
          const headerBounds = await header.boundingBox()
          expect(await actions.evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(47.99)
          expect(await menu.evaluate(element => {
            const bounds = element.getBoundingClientRect()
            return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && Math.abs(bounds.bottom - innerHeight) <= 1
          })).toBe(true)
          await actions.last().scrollIntoViewIfNeeded()
          await expect(actions.last()).toBeInViewport()
          expect(await header.boundingBox()).toEqual(headerBounds)
          await page.setViewportSize({ width: 1600, height: 1600 })
          const scroller = menu.locator('.mobileLinkActionsScroll')
          await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
          await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
          await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
          await menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true }).click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`https://youtu.be/${VIDEO_ID}`)
          await expect(menu).toHaveCount(0)
          await card.locator('.title').click({ button: 'right' })
          await expect(page.locator('.contextMenu').getByRole('menuitem').first()).toHaveCSS('font-size', '13px')
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)
        }
      } finally {
        await session.detach()
      }
    })
  })
}

test.describe('sharing actions stay available in video menus', () => {
  test.use({ seed: { ...SEED, settings: { ...SEED.settings, hideSharingActions: true } } })

  test('desktop and mobile retain grouped link choices when sharing is hidden elsewhere', async ({ page, app }) => {
    await goTo(page, 'history')
    const title = page.locator('.ft-list-video .title').first()
    for (const touch of [false, true]) {
      if (touch) {
        await title.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
          bubbles: true, cancelable: true, pointerType: 'touch'
        })))
      } else {
        await title.click({ button: 'right' })
      }
      const menu = page.locator(touch ? '.mobileLinkActions' : '.contextMenu')
      await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
      await expect(menu.getByRole('menuitem', { name: 'Copy Invidious Link', exact: true })).toBeVisible()
      await menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true }).click()
      await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`https://youtu.be/${VIDEO_ID}`)
      await expect(menu).toHaveCount(0)
    }
  })
})

test('mobile groups quick actions and resets scrolling when entering and leaving submenus', async ({ page }) => {
  await goTo(page, 'history')
  await page.setViewportSize({ width: 375, height: 350 })
  await page.locator('.ft-list-video .title').first().evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
    bubbles: true, cancelable: true, pointerType: 'touch'
  })))
  const menu = page.locator('.mobileLinkActions')
  const scroller = menu.locator('.mobileLinkActionsScroll')
  const quickActions = menu.locator('.mobileLinkQuickActions:not(.mobileThumbnailActionRow) [role="menuitem"]')
  await expect(quickActions).toHaveCount(4)
  const tops = await quickActions.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))
  expect(new Set(tops).size).toBe(1)
  await expect(menu.getByRole('separator').first()).toBeAttached()
  await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
  await expect(quickActions).toHaveCount(0)
  await expect(menu.locator('strong')).toHaveCount(0)
  await expect(menu).toHaveAttribute('aria-label', 'Copy Link')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
  await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeFocused()
  const headerBounds = await menu.locator('.mobileLinkActionsHeader').boundingBox()
  await page.mouse.click(headerBounds.x + headerBounds.width - 12, headerBounds.y + headerBounds.height / 2)
  await expect(menu.getByRole('menuitem', { name: 'Copy Link', exact: true })).toBeFocused()
  await expect(quickActions).toHaveCount(4)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await menu.getByRole('menuitem', { name: 'Open Link', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: /^Open.*Channel in Invidious$/ })).toBeAttached()
  await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded()
  await page.keyboard.press('Escape')
  await expect(menu.locator('strong')).toHaveText('Video menu test')
  await expect(menu.getByRole('menuitem', { name: 'Open Link', exact: true })).toBeFocused()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('mobile video actions follow background updates and close with their source', async ({ page }) => {
  await goTo(page, 'history')
  const title = page.locator('.ft-list-video .title').first()
  const menu = page.locator('.mobileLinkActions')
  async function openMenu() {
    await title.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch'
    })))
    await expect(menu).toBeVisible()
  }
  await openMenu()
  await page.evaluate(videoId => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('upsertToHistoryCache', { ...store.getters.getHistoryCacheById[videoId], isWatched: true })
  }, VIDEO_ID)
  await expect(menu.getByRole('menuitem', { name: 'Unmark As Watched', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Open Link', exact: true }).click()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setBackendFallback', false))
  await expect(menu.getByRole('menuitem', { name: 'Open in Invidious', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Open in YouTube', exact: true })).toBeVisible()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/playlists'))
  await expect(menu).toHaveCount(0)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/history'))
  await openMenu()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setHistoryCacheSorted', []))
  await expect(title).toHaveCount(0)
  await expect(menu).toHaveCount(0)
})

test('replacing a long bottom menu resets its scroll range', async ({ page }) => {
  await goTo(page, 'history')
  await page.setViewportSize({ width: 375, height: 300 })
  const thumbnail = page.locator('.ft-list-video .thumbnailImage').first()
  await thumbnail.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
    bubbles: true, cancelable: true, pointerType: 'touch'
  })))
  const menu = page.locator('.mobileLinkActions')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded()
  const scroller = menu.locator('.mobileLinkActionsScroll')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__._container._vnode.component.provides.openMobileContextActions({
      title: 'Short menu',
      actions: [{ label: 'One action', icon: ['fas', 'check'], run() {} }]
    })
  })
  await expect(menu.getByRole('menuitem', { name: 'One action', exact: true })).toBeInViewport()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('clamps a menu after actions disappear and resets it after resizing', async ({ page }) => {
  await goTo(page, 'history')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setEnableDownloads', true))
  await page.setViewportSize({ width: 1000, height: 300 })
  const card = page.locator('.ft-list-video').first()
  await card.locator('.title').click({ button: 'right' })
  const menu = page.locator('.contextMenu')
  const scroller = menu.locator('.menuScroll')
  await menu.evaluate(element => { element.style.maxHeight = '150px' })
  const header = menu.locator('.tabMenuHeader')
  const headerBounds = await header.boundingBox()
  await menu.getByRole('menuitem').filter({ visible: true }).last().scrollIntoViewIfNeeded()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  expect(await header.boundingBox()).toEqual(headerBounds)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setEnableDownloads', false))
  await expect(menu.getByRole('menuitem', { name: 'Download Video', exact: true })).toHaveCount(0)
  await expect.poll(() => scroller.evaluate(element => {
    const content = element.querySelector('.menuContent')
    const end = content.offsetTop + content.offsetHeight
    return Math.abs(element.scrollTop - Math.max(0, end - element.clientHeight))
  })).toBeLessThanOrEqual(1)
  await expect(menu.getByRole('menuitem').filter({ visible: true }).last()).toBeInViewport()
  await page.setViewportSize({ width: 1200, height: 1000 })
  await expect(menu).toHaveCount(0)
  await card.locator('.title').click({ button: 'right' })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
  await expect(menu.getByRole('menuitem').first()).toBeInViewport()
  await expect(menu.getByRole('menuitem').filter({ visible: true }).last()).toBeInViewport()
})

test('opens the selected video in a new tab', async ({ page }) => {
  await goTo(page, 'history')
  const initialTabs = await page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabs.length)
  await page.locator('.ft-list-video .videoInfo').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in a New Tab', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/watch/${VIDEO_ID}`))
  await expect.poll(() => page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabs.length)).toBe(initialTabs + 1)
  await expect(page.locator('.contextMenu')).toHaveCount(0)
})

for (const playlistType of ['youtube', 'user']) {
  test.describe(`${playlistType} playlist copy actions`, () => {
    const playlistId = playlistType === 'youtube' ? 'PL1234567890' : 'private-playlist'
    test.use({
      seed: {
        settings: { saveVideoHistoryWithLastViewedPlaylist: true, backendFallback: true, defaultInvidiousInstance: 'https://invidious.test' },
        history: [{ ...SEED.history[0], lastViewedPlaylistId: playlistId, lastViewedPlaylistType: playlistType }]
      }
    })

    test('keeps public playlist parameters by default and offers a separate video-only copy', async ({ page, app }) => {
      await goTo(page, 'history')
      const card = page.locator('.ft-list-video').first()
      const menu = page.locator('.contextMenu')
      const invidious = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getCurrentInvidiousInstanceUrl)
      for (const [service, url, separator] of [
        ['YouTube', `https://youtu.be/${VIDEO_ID}`, '?'],
        ['Invidious', `${invidious}/watch?v=${VIDEO_ID}`, '&']
      ]) {
        await card.locator('.title').click({ button: 'right' })
        await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
        await menu.getByRole('menuitem', { name: `Copy ${service} Link`, exact: true }).click()
        await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe(playlistType === 'youtube' ? `${url}${separator}list=${playlistId}` : url)
        await card.locator('.title').click({ button: 'right' })
        await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
        const withoutPlaylist = menu.getByRole('menuitem', { name: `Copy ${service} link without playlist`, exact: true })
        if (playlistType === 'youtube') {
          await withoutPlaylist.click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(url)
        } else {
          await expect(withoutPlaylist).toHaveCount(0)
          await page.keyboard.press('Escape')
        }
      }
    })
  })
}

test('retains image and selected-text actions alongside video actions', async ({ page, app }) => {
  await page.route(/https:\/\/i\.ytimg\.com\//, route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'history')
  const card = page.locator('.ft-list-video').first()
  const thumbnail = card.locator('.thumbnailImage:not(.retryImagePlaceholder)')
  await expectImagesLoaded(thumbnail)
  const menu = page.locator('.contextMenu')
  await thumbnail.click({ button: 'right' })
  for (const name of ['Copy Image', 'Copy Image Address']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await expect(menu.getByRole('menuitem', { name: /^Save Image As/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Add to Queue', exact: true })).toBeVisible()
  const imageUrl = await thumbnail.evaluate(image => image.currentSrc || image.src)
  await menu.getByRole('menuitem', { name: 'Copy Image Address', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(imageUrl)
  await card.locator('.h3Title').evaluate(element => {
    const selection = window.getSelection()
    selection.selectAllChildren(element)
  })
  await card.locator('.h3Title').click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Search.*Video menu test/ }).first()).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy Link', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('Video menu test')
})

test('channel names keep their channel context menu', async ({ page, app }) => {
  await goTo(page, 'history')
  const channel = page.locator('.ft-list-video .channelName').first()
  await channel.locator('.channelNameText').click({ button: 'right' })
  const menu = page.locator('.contextMenu')
  await expect(menu).toBeVisible()
  for (const name of ['Add to Queue', 'Play Next', 'Mark As Watched', 'Remove From History', 'Download Video']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveCount(0)
  }
  await menu.getByRole('menuitem', { name: /^Hide channel$/i }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getChannelsHiddenParsed))
    .toEqual([{ name: 'UCaaaaaaaaaaaaaaaaaaaaaa', preferredName: 'Test Channel' }])
  await channel.locator('.channelNameText').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /^Show channel$/i }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getChannelsHiddenParsed))
    .toEqual([])
  await channel.locator('.channelNameText').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa')
  await channel.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Add to Queue', exact: true })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa')
})

test('channel handles store the channel name when hidden', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'channel menu',
      data: [{
        type: 'channel',
        dataSource: 'local',
        id: 'UCbbbbbbbbbbbbbbbbbbbbbb',
        name: 'Channel Menu Test',
        thumbnail: '',
        handle: '@channelmenutest',
        subscribers: 100,
        descriptionShort: ''
      }],
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
  })
  await page.locator(sel.searchInput).fill('channel menu')
  await page.locator(sel.searchInput).press('Enter')
  await page.locator('.ft-list-channel .handle').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Hide channel$/i }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getChannelsHiddenParsed))
    .toEqual([{ name: 'UCbbbbbbbbbbbbbbbbbbbbbb', preferredName: 'Channel Menu Test' }])
})

test('compact header and link submenus support keyboard navigation', async ({ page }) => {
  await goTo(page, 'history')
  await page.locator('.ft-list-video .title').first().focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.locator('.contextMenu')
  const quickActions = menu.locator('.tabQuickActions button')
  await expect(quickActions).toHaveCount(4)
  const tops = await quickActions.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top))
  expect(new Set(tops).size).toBe(1)
  await page.keyboard.press('ArrowRight')
  await expect(quickActions.nth(1)).toBeFocused()
  const copy = menu.getByRole('menuitem', { name: 'Copy Link', exact: true })
  await copy.focus()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(copy).toBeFocused()
  await menu.getByRole('menuitem', { name: 'Open Link', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: 'Open in YouTube', exact: true })).toBeVisible()
})

test('inline link choices clamp scrolling when collapsed on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 })
  await goTo(page, 'history')
  await page.locator('.ft-list-video .title').first().click({ button: 'right' })
  const menu = page.locator('.contextMenu')
  await menu.evaluate(element => { element.style.maxHeight = '200px' })
  await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).focus()
  const scroller = menu.locator('.menuScroll')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.mouse.move(0, 0)
  await menu.locator('.tabQuickActions button').first().focus()
  await expect(menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeHidden()
  await expect.poll(() => scroller.evaluate(element => {
    const content = element.querySelector('.menuContent')
    return element.scrollTop <= Math.max(0, content.offsetTop + content.offsetHeight - element.clientHeight) + 1
  })).toBe(true)
  await expect(menu.getByRole('menuitem', { name: 'Open Link', exact: true })).toBeInViewport()
})

test.describe('single link choice', () => {
  test.use({
    seed: {
      ...SEED,
      settings: { backendFallback: false, backendPreference: 'local' },
      history: [{ ...SEED.history[0], authorId: null }]
    }
  })

  test('shows the copy action directly when it is the only choice', async ({ page, app }) => {
    await goTo(page, 'history')
    await page.locator('.ft-list-video .title').first().click({ button: 'right' })
    const menu = page.locator('.contextMenu')
    await expect(menu.getByRole('menuitem', { name: 'Copy Link', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Open Link', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Open in YouTube', exact: true })).toBeVisible()
    const copy = menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })
    await expect(copy).toBeVisible()
    await expect(copy).not.toHaveAttribute('aria-haspopup', 'menu')
    await copy.click()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`https://youtu.be/${VIDEO_ID}`)
  })
})

for (const uiScale of [100, 125]) {
  for (const listType of ['grid', 'list']) {
    test.describe(`optional video menu button in ${listType} at ${uiScale}%`, () => {
      test.use({ seed: { ...SEED, settings: { ...SEED.settings, uiScale, listType, showVideoMenuButton: true } } })

      test('opens the unified menu beside the button and restores focus', async ({ page, attachScreenshot }) => {
        await goTo(page, 'history')
        const card = page.locator('.ft-list-video').first()
        const button = card.getByRole('button', { name: /^More options$/i })
        const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
        await card.hover()
        await expect(button).toBeVisible()

        for (const input of ['mouse', 'Enter', 'Space']) {
          await button.focus()
          if (input === 'mouse') await button.click()
          else await button.press(input)
          await expect(menu).toBeVisible()
          await expect(menu.getByRole('menuitem').first()).toBeFocused()
          await expect(menu.getByRole('menuitem', { name: 'Play Next', exact: true })).toBeVisible()
          const anchor = await button.boundingBox()
          const bounds = await menu.boundingBox()
          const viewportWidth = await page.evaluate(() => window.innerWidth)
          const expectedX = Math.max(8, Math.min(anchor.x, viewportWidth - bounds.width - 8))
          expect(Math.abs(bounds.x - expectedX)).toBeLessThanOrEqual(1)
          // The shared menu clamps vertically when there is insufficient space below the button.
          expect(bounds.y).toBeLessThanOrEqual(anchor.y + anchor.height + 1)
          expect(bounds.y + bounds.height).toBeGreaterThan(anchor.y)
          if (input === 'mouse') await attachScreenshot('optional video menu button')
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)
          await expect(button).toBeFocused()
        }

        await button.click()
        await menu.getByRole('menuitem', { name: 'Mark As Watched', exact: true }).click()
        await expect(card).toHaveClass(/watched/)
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateShowVideoMenuButton', false))
        await expect(button).toHaveCount(0)
        await card.locator('.title').click({ button: 'right' })
        await expect(menu.getByRole('menuitem', { name: 'Unmark As Watched', exact: true })).toBeVisible()
      })
    })
  }
}

test('optional video menu button can be enabled in appearance settings', async ({ page }) => {
  const appearance = await goToSettingsSection(page, 'appearance')
  const toggle = appearance.getByRole('checkbox', { name: /^Show video menu button/ })
  await expect(toggle).not.toBeChecked()
  await appearance.locator('label.switch-label').filter({ hasText: 'Show video menu button' }).click()
  await expect(toggle).toBeChecked()
  await goTo(page, 'history')
  const button = page.locator('.ft-list-video').first().getByRole('button', { name: /^More options$/i })
  await expect(button).toHaveCount(1)
  await page.reload()
  await expect(button).toHaveCount(1)
})
