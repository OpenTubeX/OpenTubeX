import { test, expect, sel } from '../../helpers/app.mjs'

test('compact tab actions keep their labels and execute on the target tab', async ({ page }) => {
  const target = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/about', makeActive: false, lazyLoad: true
  }))
  const tab = page.locator(`.tab[data-tab-id="${target.id}"]`)
  const open = () => tab.click({ button: 'right' })
  const state = () => page.evaluate(async id => (
    (await window.ftElectron.tabs.getState()).tabs.find(tab => tab.id === id)
  ), target.id)

  await open()
  const menu = page.locator('.compactTabMenu')
  await expect(menu.locator('.tabQuickActions button')).toHaveCount(4)
  for (const name of ['Reload Tab', 'Duplicate Tab', 'Pin Tab', 'Close Tab']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute('title', name)
  }
  const box = await menu.boundingBox()
  expect(box.width).toBeLessThanOrEqual(240)
  expect(box.height).toBeLessThan(300)
  await menu.getByRole('menuitem', { name: 'Pin Tab', exact: true }).click()
  await expect.poll(async () => (await state()).isPinned).toBe(true)

  await open()
  await menu.getByRole('menuitemradio', { name: 'Purple', exact: true }).click()
  await expect.poll(async () => (await state()).color).toBe('purple')
  await open()
  await expect(menu.getByRole('menuitemradio', { name: 'Purple', exact: true })).toBeChecked()
  await menu.getByRole('menuitemradio', { name: 'Default', exact: true }).click()
  await expect.poll(async () => (await state()).color).toBeNull()

  await open()
  await menu.getByRole('menuitem', { name: 'Unpin Tab', exact: true }).click()
  await expect.poll(async () => (await state()).isPinned).toBe(false)
  await open()
  await menu.getByRole('menuitem', { name: 'Load Tab', exact: true }).click()
  await expect.poll(async () => (await state()).isUnloaded).toBe(false)
  const refreshKey = (await state()).refreshKey
  await open()
  await menu.getByRole('menuitem', { name: 'Reload Tab', exact: true }).click()
  await expect.poll(async () => (await state()).refreshKey).toBeGreaterThan(refreshKey)

  await open()
  await menu.getByRole('menuitem', { name: 'Duplicate Tab', exact: true }).click()
  await expect(page.locator(sel.tabs)).toHaveCount(3)
  await open()
  await menu.getByRole('menuitem', { name: 'Close Tab', exact: true }).click()
  await expect(tab).toHaveCount(0)
  await expect(page.locator(sel.tabs)).toHaveCount(2)
})

test('compact tab menu supports keyboard navigation and disabled actions', async ({ page }) => {
  await page.locator(sel.activeTab).focus()
  await page.locator(sel.activeTab).click({ button: 'right' })
  const menu = page.locator('.compactTabMenu')
  await expect(menu.getByRole('menuitem', { name: 'Unload Tab', exact: true })).toBeDisabled()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Reload Tab', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitem', { name: 'Duplicate Tab', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.locator(sel.activeTab)).toHaveClass(/pinned/)

  await page.locator(sel.activeTab).click({ button: 'right' })
  await menu.getByRole('menuitemradio', { name: 'Default', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitemradio', { name: 'Red', exact: true })).toBeFocused()
  await page.keyboard.press('Space')
  await page.locator(sel.activeTab).click({ button: 'right' })
  await expect(menu.getByRole('menuitemradio', { name: 'Red', exact: true })).toBeChecked()
  await menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitemradio', { name: 'Ungrouped', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.locator(sel.activeTab)).toBeFocused()
})

test('compact bulk actions preserve the selection and mixed color state', async ({ page }) => {
  await page.locator(sel.newTabButton).click()
  await page.locator(sel.newTabButton).click()
  const ids = await page.locator(sel.tabs).evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))
  const open = async () => {
    await page.evaluate(async ids => {
      const store = window.$store
      await store.dispatch('setTabSelection', ids)
    }, ids.slice(0, 2))
    await page.locator(`.tab[data-tab-id="${ids[0]}"]`).click({ button: 'right' })
  }
  await page.evaluate(id => window.ftElectron.tabs.setColor(id, 'blue'), ids[0])
  await open()
  const menu = page.locator('.compactTabMenu')
  await expect(menu.locator('.tabColorPalette [aria-checked="true"]')).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Duplicate 2 Tabs', exact: true })).toHaveAttribute('title', 'Duplicate 2 Tabs')
  await menu.getByRole('menuitemradio', { name: 'Green', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (
    (await window.ftElectron.tabs.getState()).tabs.map(tab => tab.color)
  ))).toEqual(['green', 'green', null])
  await open()
  await menu.getByRole('menuitem', { name: 'Pin Tabs', exact: true }).click()
  await expect(page.locator(`${sel.tabs}.pinned`)).toHaveCount(2)
  await open()
  await menu.getByRole('menuitem', { name: 'Close 2 Tabs', exact: true }).click()
  await expect(page.locator(sel.tabs)).toHaveCount(1)
  await expect(page.locator(sel.tabs)).toHaveAttribute('data-tab-id', ids[2])
})

test('the menu animates open from the pointer and closed on the compositor while taking input @scale', async ({ page }) => {
  // Slow motion keeps the menu's animations running long enough to inspect
  // them. Fly-outs keep their own short transition so they settle at once.
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`
      .contextMenu { --motion-fast-effects: 10s linear; --motion-fast-spatial: 10s linear; }
      .contextMenu .submenu { --motion-fast-effects: 0s; --motion-fast-spatial: 0s; }
    `)
    window.__slowMenuMotion = sheet
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  })
  const tab = page.locator(sel.activeTab)
  const tabBox = await tab.boundingBox()
  const point = { x: tabBox.x + 24, y: tabBox.y + tabBox.height / 2 }
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const menu = page.locator('.compactTabMenu')
  await expect(menu).toBeVisible()

  // The open and close animations change only opacity and transform, which
  // need no layout or paint, so a busy main thread can neither delay nor stall them
  const animatedProperties = () => menu.evaluate(element => [...new Set(element.getAnimations({ subtree: true })
    .filter(animation => animation instanceof CSSAnimation && animation.playState === 'running')
    .flatMap(animation => animation.effect.getKeyframes())
    .flatMap(keyframe => Object.keys(keyframe))
    .filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)))].sort())
  expect(await animatedProperties()).toEqual(['opacity', 'transform'])
  // Only the surface scales; the menu and its items keep their final geometry
  expect(await menu.evaluate(element => getComputedStyle(element).transform)).toBe('none')
  // The surface expands from the pointer, give or take the rounding of
  // pointer coordinates at fractional UI scales
  const origin = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const [x, y] = getComputedStyle(element, '::before').transformOrigin.split(' ').map(Number.parseFloat)
    return { x: rect.left + x, y: rect.top + y }
  })
  expect(Math.abs(origin.x - point.x)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(origin.y - point.y)).toBeLessThanOrEqual(1.5)

  // Fly-outs open where they belong while the menu is still animating
  const trigger = menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true })
  const triggerBox = await trigger.boundingBox()
  await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2)
  const ungrouped = menu.getByRole('menuitemradio', { name: 'Ungrouped', exact: true })
  await expect(ungrouped).toBeVisible()
  const ungroupedBox = await ungrouped.boundingBox()
  expect(ungroupedBox.x).toBeGreaterThanOrEqual(triggerBox.x + triggerBox.width - 8)
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="menuitemradio"]')?.textContent.trim(), {
    x: ungroupedBox.x + ungroupedBox.width / 2, y: ungroupedBox.y + ungroupedBox.height / 2
  })).toBe('Ungrouped')
  expect(await animatedProperties()).toEqual(['opacity', 'transform'])

  // Items work before the open animation ends
  const pin = menu.getByRole('menuitem', { name: 'Pin Tab', exact: true })
  const pinBox = await pin.boundingBox()
  await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2)
  await expect(tab).toHaveClass(/pinned/)

  // The closing menu fades out and lets the page beneath take input at once
  await expect(menu).toHaveClass(/context-menu-leave-active/)
  expect(await animatedProperties()).toEqual(['opacity', 'transform'])
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.contextMenu') == null, {
    x: pinBox.x + pinBox.width / 2, y: pinBox.y + pinBox.height / 2
  })).toBe(true)

  await page.evaluate(() => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.__slowMenuMotion)
  })
  await expect(menu).toHaveCount(0)
})

test('a menu closed while it opens still fades out in full', async ({ page }) => {
  // The surface finishes expanding while the longer fade-out still runs
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.contextMenu { --motion-fast-effects: 4s linear; --motion-fast-spatial: 1s linear; }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  })
  await page.locator(sel.activeTab).click({ button: 'right' })
  const menu = page.locator('.compactTabMenu')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveClass(/context-menu-leave-active/)
  await menu.evaluate(element => Promise.all(element.getAnimations({ subtree: true })
    .filter(animation => animation.animationName.startsWith('context-menu-expand'))
    .map(animation => animation.finished)))
  await expect(menu).toHaveClass(/context-menu-leave-active/)
  expect(await menu.evaluate(element => element.getAnimations()
    .find(animation => animation.animationName.startsWith('context-menu-fade-out'))?.playState)).toBe('running')
})

test('pink tab colors render and survive an app restart', async ({ page, app }) => {
  await page.locator(sel.activeTab).click({ button: 'right' })
  await page.getByRole('menuitemradio', { name: 'Pink', exact: true }).click()
  await expect(page.locator(sel.activeTab)).toHaveCSS('--tab-accent-color', '#d65b96')
  // Rounded colored tabs keep one even border instead of a one-sided accent stripe.
  await expect(page.locator(sel.activeTab)).toHaveCSS('box-shadow', 'none')
  await page.evaluate(() => window.$store.commit('setTabBarPosition', 'left'))
  await expect(page.locator(`${sel.activeTab}.vertical`)).toHaveCSS('box-shadow', 'none')
  await page.evaluate(() => window.$store.commit('setTabBarPosition', 'top'))
  await app.relaunch()
  await expect(app.page.locator(sel.activeTab)).toHaveCSS('--tab-accent-color', '#d65b96')
  await app.page.locator(sel.activeTab).click({ button: 'right' })
  await expect(app.page.getByRole('menuitemradio', { name: 'Pink', exact: true })).toBeChecked()
})

for (const settings of [
  { currentLocale: 'en-US', baseTheme: 'dark', iconPack: 'material', uiScale: 100 },
  { currentLocale: 'de-DE', baseTheme: 'light', iconPack: 'remix', uiScale: 125 },
  { currentLocale: 'en-US', baseTheme: 'dark', iconPack: 'remix', uiScale: 95 }
]) {
  test.describe(`compact tab menu ${Object.values(settings).join(' ')}`, () => {
    test.use({ seed: { settings } })

    test('fits small windows and keeps the action header clear of scrolling', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 680, height: 300 })
      await page.locator(sel.activeTab).click({ button: 'right' })
      const menu = page.locator('.compactTabMenu')
      await expect(menu).toBeVisible()
      await expect(menu.locator('.tabQuickActions svg')).toHaveCount(4)
      const colors = menu.locator('.tabColorPalette button')
      await expect(colors).toHaveCount(8)
      const positions = await colors.evaluateAll(buttons => buttons.map(button => {
        const { x, y } = button.getBoundingClientRect()
        return { x, y }
      }))
      expect(new Set(positions.map(({ y }) => y)).size).toBe(2)
      for (let index = 0; index < 4; index++) {
        expect(positions[index].y).toBe(positions[0].y)
        expect(positions[index + 4].y).toBe(positions[4].y)
        expect(positions[index].x).toBe(positions[index + 4].x)
      }
      await expect(menu).toHaveCSS('opacity', '1')
      await testInfo.attach('compact tab menu', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      if (settings.uiScale === 100) {
        await testInfo.attach('compact tab menu detail', { body: await menu.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      }

      const quickActions = menu.locator('.tabQuickActions button')
      await quickActions.first().hover()
      // Sample the settled hover color, not a frame of its fade.
      const hoverBackground = await quickActions.first().evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished))
        return getComputedStyle(element).backgroundColor
      })
      expect(hoverBackground).not.toBe('rgba(0, 0, 0, 0)')
      await quickActions.last().hover()
      await expect(quickActions.last()).toHaveCSS('background-color', hoverBackground, { timeout: 1000 })
      await page.mouse.move(0, 0)
      await quickActions.first().focus()
      await page.keyboard.press('ArrowLeft')
      await expect(quickActions.last()).toBeFocused()
      await expect(quickActions.last()).toHaveCSS('background-color', hoverBackground)

      // Reduce the action viewport while the menu stays open, then restore it.
      const scroller = menu.locator('.menuScroll')
      const header = menu.locator('.tabMenuHeader')
      const headerBox = await header.boundingBox()
      await menu.evaluate(element => { element.style.maxHeight = '150px' })
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
      expect(await header.boundingBox()).toEqual(headerBox)
      await expect.poll(() => scroller.evaluate(element => {
        const header = element.parentElement.querySelector('.tabMenuHeader').getBoundingClientRect()
        return element.getBoundingClientRect().top >= header.bottom
      })).toBe(true)

      await menu.evaluate(element => { element.style.maxHeight = 'none' })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      await page.keyboard.press('Escape')
      await page.locator(sel.activeTab).click({ button: 'right' })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      const box = await menu.boundingBox()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(box.x).toBeGreaterThanOrEqual(7)
      expect(box.y).toBeGreaterThanOrEqual(7)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7)
    })
  })
}

test('the empty tab bar menu uses the compact tab menu rows @scale', async ({ page }) => {
  await page.locator(sel.activeTab).click({ button: 'right' })
  const tabMenuRow = page.locator('.compactTabMenu .menuScroll .menuItem').first()
  await expect(tabMenuRow).toBeVisible()
  const rowStyle = element => {
    const style = getComputedStyle(element)
    return { fontSize: style.fontSize, minBlockSize: style.minBlockSize, height: element.getBoundingClientRect().height }
  }
  const tabRow = await tabMenuRow.evaluate(rowStyle)
  await page.keyboard.press('Escape')

  const content = await page.locator('.tabsContent').boundingBox()
  const container = await page.locator('.tabsContainer').boundingBox()
  await page.mouse.click(container.x + container.width - 12, content.y + content.height / 2, { button: 'right' })
  const newTab = page.locator('.contextMenu').getByRole('menuitem', { name: 'New Tab', exact: true })
  await expect(newTab).toBeVisible()
  expect(await newTab.evaluate(rowStyle)).toEqual(tabRow)
})

test('a collapsed tab group opens a group menu', async ({ page }) => {
  const createCollapsedGroup = name => page.evaluate(async name => {
    const tabs = await Promise.all([1, 2].map(index => window.ftElectron.tabs.create({
      route: '/history', title: `${name} ${index}`, makeActive: false, lazyLoad: true
    })))
    const group = await window.ftElectron.tabs.createGroup({ name, color: 'blue' })
    await window.ftElectron.tabs.setGroup(tabs.map(tab => tab.id), group.id)
    await window.ftElectron.tabs.updateGroup(group.id, { isCollapsed: true })
    return { groupId: group.id, tabIds: tabs.map(tab => tab.id) }
  }, name)
  const state = () => page.evaluate(() => window.ftElectron.tabs.getState())
  const menu = page.locator('.contextMenu')
  const group = page.locator('.collapsedTabGroup')
  // A chip collapsed again at once can appear before the expanded one has
  // finished closing.
  const openGroupMenu = async () => {
    await expect(group).toHaveCount(1)
    await group.click({ button: 'right' })
  }

  const research = await createCollapsedGroup('Research')
  await openGroupMenu()
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Expand Group', 'Close 2 Tabs', 'Ungroup', 'Manage Tab Groups…'
  ])
  await menu.getByRole('menuitem', { name: 'Expand Group', exact: true }).click()
  await expect(group).toHaveCount(0)
  await expect.poll(async () => (await state()).groups.find(group => group.id === research.groupId)?.isCollapsed).toBe(false)

  await page.evaluate(id => window.ftElectron.tabs.updateGroup(id, { isCollapsed: true }), research.groupId)
  await openGroupMenu()
  await menu.getByRole('menuitem', { name: 'Ungroup', exact: true }).click()
  await expect.poll(async () => {
    const { tabs, groups } = await state()
    return {
      groupExists: groups.some(group => group.id === research.groupId),
      groupIds: tabs.filter(tab => research.tabIds.includes(tab.id)).map(tab => tab.groupId)
    }
  }).toEqual({ groupExists: false, groupIds: [null, null] })

  const music = await createCollapsedGroup('Music')
  await openGroupMenu()
  await menu.getByRole('menuitem', { name: 'Close 2 Tabs', exact: true }).click()
  await expect.poll(async () => (await state()).tabs.filter(tab => music.tabIds.includes(tab.id))).toHaveLength(0)
  await expect(page.locator(sel.tabs)).toHaveCount(3)
})

test('menus without a tab palette take focus from the keyboard and navigate with arrow keys', async ({ page }) => {
  await page.evaluate(async () => {
    const tabs = await Promise.all([1, 2].map(index => window.ftElectron.tabs.create({
      route: '/history', title: `Research ${index}`, makeActive: false, lazyLoad: true
    })))
    const group = await window.ftElectron.tabs.createGroup({ name: 'Research' })
    await window.ftElectron.tabs.setGroup(tabs.map(tab => tab.id), group.id)
    await window.ftElectron.tabs.updateGroup(group.id, { isCollapsed: true })
  })
  const menu = page.locator('.contextMenu')
  const item = name => menu.getByRole('menuitem', { name, exact: true })

  // A pointer-opened menu leaves focus in place until an arrow key moves it in.
  const container = await page.locator('.tabsContainer').boundingBox()
  await page.mouse.click(container.x + container.width - 12, container.y + container.height / 2, { button: 'right' })
  await expect(item('New Tab')).toBeVisible()
  await expect(item('New Tab')).not.toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item('New Tab')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(item('Reopen Closed Tab')).not.toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // A keyboard-opened menu focuses its first item, so Enter picks from the menu.
  const group = page.locator('.collapsedTabGroup')
  await group.focus()
  await page.keyboard.press('Shift+F10')
  await expect(item('Expand Group')).toBeFocused()
  // Tab closes the menu like a native one, so it never lingers after focus leaves.
  await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
  await expect(group).not.toBeFocused()
  await group.focus()
  await page.keyboard.press('Shift+F10')
  await expect(item('Expand Group')).toBeFocused()
  await page.keyboard.press('End')
  await expect(item('Manage Tab Groups…')).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await expect(item('Close 2 Tabs')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(group).toHaveCount(0)
})
