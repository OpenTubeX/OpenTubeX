import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

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

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/i\.ytimg\.com\/vi\//, route => fulfillVisualFixture(route, 'video-thumbnail'))
})

for (const iconPack of ['material']) {
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

test('video thumbnails, titles, and metadata share one menu', async ({ page, app, attachScreenshot }) => {
  await goTo(page, 'history')
  const card = page.locator('.ft-list-video').first()
  await expect(card.getByRole('button', { name: /^More options$/i })).toHaveCount(0)
  const menu = page.getByRole('menu', { name: 'Context menu', exact: true })

  for (const selector of ['.thumbnailImage:not(.retryImagePlaceholder):not(.thumbnailPreview)', '.h3Title', '.videoInfo']) {
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

test.describe('video context menu', () => {
  test('touch holds open the existing bottom menu without navigating', { tag: '@scale' }, async ({ page, app }) => {
    await goTo(page, 'history')
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const menu = page.locator('.mobileLinkActions')
    try {
      for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1024, height: 768 }]) {
        await page.setViewportSize(viewport)
        const card = page.locator('.ft-list-video').first()
        await card.locator('.thumbnailImage:not(.retryImagePlaceholder):not(.thumbnailPreview)').scrollIntoViewIfNeeded()
        const bounds = await card.locator('.thumbnailImage:not(.retryImagePlaceholder):not(.thumbnailPreview)').boundingBox()
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
        })
        await expect(menu).toBeVisible({ timeout: 3000 })
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(page).toHaveURL(/#\/history/)
        // The sheet slides in, so measure it only after its enter animation ends.
        await menu.evaluate(element => Promise.all([element, element.parentElement]
          .flatMap(node => node.getAnimations())
          .map(animation => animation.finished)))
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
    const store = window.$store
    store.commit('upsertToHistoryCache', { ...store.getters.getHistoryCacheById[videoId], isWatched: true })
  }, VIDEO_ID)
  await expect(menu.getByRole('menuitem', { name: 'Unmark As Watched', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Open Link', exact: true }).click()
  await page.evaluate(() => window.$store.commit('setBackendFallback', false))
  await expect(menu.getByRole('menuitem', { name: 'Open in Invidious', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Open in YouTube', exact: true })).toBeVisible()
  await page.evaluate(() => window.$router.push('/playlists'))
  await expect(menu).toHaveCount(0)
  await page.evaluate(() => window.$router.push('/history'))
  await openMenu()
  await page.evaluate(() => window.$store.commit('setHistoryCacheSorted', []))
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
  await page.evaluate(() => window.$store.commit('setEnableDownloads', true))
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
  await page.evaluate(() => window.$store.commit('setEnableDownloads', false))
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
      const invidious = await page.evaluate(() => window.$store.getters.getCurrentInvidiousInstanceUrl)
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
  await goTo(page, 'history')
  const card = page.locator('.ft-list-video').first()
  const thumbnail = card.locator('.thumbnailImage:not(.retryImagePlaceholder):not(.thumbnailPreview)')
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
  await expect.poll(() => page.evaluate(() => window.$store.getters.getChannelsHiddenParsed))
    .toEqual([{ name: 'UCaaaaaaaaaaaaaaaaaaaaaa', preferredName: 'Test Channel' }])
  await channel.locator('.channelNameText').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /^Show channel$/i }).click()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getChannelsHiddenParsed))
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

for (const listType of ['grid', 'list']) {
  test.describe(`optional video menu button in ${listType}`, { tag: '@scale' }, () => {
    test.use({ seed: { ...SEED, settings: { ...SEED.settings, listType, showVideoMenuButton: true } } })

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
      await page.evaluate(() => window.$store.dispatch('updateShowVideoMenuButton', false))
      await expect(button).toHaveCount(0)
      await card.locator('.title').click({ button: 'right' })
      await expect(menu.getByRole('menuitem', { name: 'Unmark As Watched', exact: true })).toBeVisible()
    })
  })
}

test('mobile context sheet moves between items and submenus with arrow keys', async ({ page }) => {
  await goTo(page, 'history')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.ft-list-video .title').first().evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
    bubbles: true, cancelable: true, pointerType: 'touch'
  })))
  const menu = page.locator('.mobileLinkActions')
  await expect(menu).toBeFocused()
  // A touch press hides focus outlines.
  await page.evaluate(() => window.$store.dispatch('hideOutlines'))
  await expect(page.locator('html')).toHaveClass(/\bhideOutlines\b/)
  const item = name => menu.getByRole('menuitem', { name, exact: true })
  const press = async (key, focused) => {
    await page.keyboard.press(key)
    await expect(focused).toBeFocused()
  }

  await press('ArrowDown', item('Open in a New Tab'))
  await expect(page.locator('html')).not.toHaveClass(/\bhideOutlines\b/)
  // Left and Right stay within a quick action row and wrap around it.
  await press('ArrowRight', item('Open in a New Window'))
  await press('ArrowLeft', item('Open in a New Tab'))
  await press('ArrowLeft', item('Add to Queue'))
  await press('ArrowDown', item('Open in a Background Tab'))
  await press('End', item('Open Link'))
  await press('ArrowDown', item('Open in a New Tab'))
  await press('ArrowUp', item('Open Link'))
  await press('ArrowUp', item('Copy Link'))
  await press('ArrowLeft', item('Copy Link'))

  await press('ArrowRight', item('Copy YouTube Link'))
  await expect(menu).toHaveAttribute('aria-label', 'Copy Link')
  await press('ArrowDown', item('Copy Invidious Link'))
  await press('Home', menu.getByRole('button', { name: 'Back', exact: true }))
  await press('ArrowLeft', item('Copy Link'))
  await expect(menu.locator('strong')).toHaveText('Video menu test')
})

test.describe('mobile context sheet on a watch page', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, holdPlaybackRateMultiplier: 2 } } })

  async function openSheet(page) {
    await page.evaluate(() => {
      window.sheetActionRuns = 0
      window.dispatchEvent(new CustomEvent('opentubex:mobile-context-menu', {
        detail: { title: 'Space test', actions: [{ label: 'Space action', run: () => { window.sheetActionRuns++ } }] }
      }))
    })
    const menu = page.locator('.mobileLinkActions')
    await expect(menu).toBeFocused()
    return menu
  }

  test.beforeEach(async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.setViewportSize({ width: 375, height: 812 })
  })

  test('Space activates the focused item instead of toggling playback', async ({ page }) => {
    const video = page.locator('video')
    await video.evaluate(element => element.pause())
    const menu = await openSheet(page)
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Space action', exact: true })).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(() => page.evaluate(() => window.sheetActionRuns)).toBe(1)
    await expect(menu).toBeHidden()
    expect(await video.evaluate(element => element.paused)).toBe(true)
  })

  test('releasing a held Space in the sheet ends the faster playback', async ({ page }) => {
    const video = page.locator('video')
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.down('Space')
    try {
      await expect(video).toHaveJSProperty('playbackRate', 2)
      await openSheet(page)
    } finally {
      await page.keyboard.up('Space')
    }
    await expect(video).toHaveJSProperty('playbackRate', 1)
  })
})
