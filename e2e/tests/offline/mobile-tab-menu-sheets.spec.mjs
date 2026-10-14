import { test, expect, expectScrollAtRenderedEnd, setWindowSize } from '../../helpers/app.mjs'

async function enableTabMenus(page, mode) {
  await page.evaluate(mode => {
    function visit(vnode) {
      if (!vnode || typeof vnode !== 'object') return
      const component = vnode.component
      if (component?.type.__name === 'CapacitorPhoneTabSwitcher') component.props.enabled = true
      if (component?.type.__name === 'CapacitorTabActionsMenu') component.props.mode = mode
      if (component) visit(component.subTree)
      if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
    }
    visit(document.querySelector('#app')._vnode)
  }, mode)
}

async function settled(menu) {
  await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
}

async function drag(session, target, distance) {
  const bounds = await target.boundingBox()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(20, bounds.height / 2) }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + distance * step / 5 }]
    })
  }
}

for (const mode of ['phone', 'tablet']) {
  for (const scale of [100, 125]) {
    test(`${mode} tab sheet supports gestures and submenus at ${scale}%`, async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width: 375, height: 760 })
      await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), scale)
      await enableTabMenus(page, mode)
      await page.locator('.capacitorPhoneTabSwitcherButton').click()
      // The shared tab menu is mounted after the switcher opens.
      await enableTabMenus(page, mode)
      const target = page.locator('.capacitorPhoneTabTarget').filter({ hasText: 'Subscriptions' })
      await expect(target).toHaveCount(1)
      const menu = page.locator('.capacitorTabActions')
      const open = async () => {
        await target.click({ button: 'right' })
        await enableTabMenus(page, mode)
        await expect(menu).toBeVisible()
        await settled(menu)
      }
      await open()
      const handle = menu.locator('.bottomSheetHandle')
      await expect(handle).toBeVisible()
      await expect(menu).toHaveCSS('touch-action', 'none')
      const list = menu.locator('.capacitorTabActionList')
      await expect(list).toHaveCSS('touch-action', 'pan-down')
      expect(await menu.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(await page.evaluate(() => innerWidth), 0)
      await testInfo.attach(`${mode} tab sheet`, { body: await page.screenshot(), contentType: 'image/png' })
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      try {
        // Hold beyond the flick interval so a pull above the flick-distance
        // threshold settles without selecting the touched action.
        await drag(session, menu.getByRole('menuitem', { name: 'Select Tab', exact: true }), 30)
        await page.waitForTimeout(180)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await settled(menu)
        await expect(menu).toBeVisible()
        await expect(page.locator('.capacitorPhoneTabRow input[type="checkbox"]')).toHaveCount(0)
        await expect(menu).toHaveCSS('transform', 'none')

        await drag(session, menu.getByRole('menuitem', { name: 'Select Tab', exact: true }), 110)
        await expect.poll(() => menu.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBeGreaterThan(80)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCount(0)
        await expect(page.locator('.capacitorPhoneTabDialog')).toBeVisible()

        await open()
        await setWindowSize(app, page, { width: 760, height: 375 })
        await list.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await expect(list).toHaveCSS('touch-action', 'pan-y')
        await drag(session, menu.getByRole('menuitem', { name: 'Close Tab', exact: true }), 30)
        // Hold before release so native scrolling does not fling while the
        // following submenu assertion records its starting offset.
        await page.waitForTimeout(180)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCSS('transform', 'none')
        await expect(menu).toBeVisible()
        await list.evaluate(element => { element.scrollTop = element.scrollHeight })
        const scrollTop = await list.evaluate(element => element.scrollTop)
        await menu.getByRole('menuitem', { name: 'Close Tabs', exact: true }).click()
        await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
        await expect(list.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
        await expect(list).toHaveCSS('touch-action', 'pan-down')
        await page.keyboard.press('Escape')
        await expect(menu.getByRole('menuitem', { name: 'Close Tabs', exact: true })).toBeFocused()
        await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, 0)
        await expect(list).toHaveCSS('touch-action', 'pan-y')
        // Enlarging the viewport removes overflow while the sheet stays open.
        await list.evaluate(element => { element.scrollTop = element.scrollHeight })
        await setWindowSize(app, page, { width: 375, height: 760 })
        await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
        await expectScrollAtRenderedEnd(list)
        await expect(list.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
        await expect(list).toHaveCSS('touch-action', 'pan-down')
        await setWindowSize(app, page, { width: 760, height: 375 })
        await list.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await expect(list.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
        // The fixed handle dismisses even when the list is scrolled.
        await drag(session, handle, 100)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCount(0)

        await open()
        await menu.getByRole('menuitem', { name: 'Close Tabs', exact: true }).click()
        await drag(session, handle, 100)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCount(0)

        await open()
        const exit = await menu.evaluate(element => {
          element.parentElement.click()
          return new Promise(resolve => requestAnimationFrame(() => {
            resolve({
              retained: element.isConnected,
              sliding: element.getAnimations().some(animation => animation.effect.getKeyframes().at(-1).transform === 'translateY(100%)'),
              rows: element.querySelectorAll('button').length
            })
          }))
        })
        expect(exit.retained).toBe(true)
        expect(exit.sliding).toBe(true)
        expect(exit.rows).toBeGreaterThan(0)
        await expect(menu).toHaveCount(0)

        await page.emulateMedia({ reducedMotion: 'reduce' })
        await open()
        await drag(session, handle, 100)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCount(0)
      } finally {
        await session.detach()
      }
    })

    test(`${mode} tab sheet restores keyboard focus and keeps long-title actions reachable at ${scale}%`, async ({ app, page }) => {
      await setWindowSize(app, page, { width: 375, height: 760 })
      await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), scale)
      await enableTabMenus(page, mode)
      await page.locator('.capacitorPhoneTabSwitcherButton').click()
      const target = page.locator('.capacitorPhoneTabTarget[aria-selected="true"]')
      const menu = page.locator('.capacitorTabActions')
      await target.focus()
      await target.press('Shift+F10')
      await enableTabMenus(page, mode)
      await settled(menu)
      await expect(menu).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(target).toBeFocused()

      await setWindowSize(app, page, { width: 760, height: 375 })
      const title = 'A very long video title '.repeat(100)
      await page.evaluate(title => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabContentTitle', { tabId: store.getters.getActiveTabId, title })
      }, title)
      await target.focus()
      await target.press('ContextMenu')
      await enableTabMenus(page, mode)
      await settled(menu)
      await expect(menu.locator('strong')).toHaveText(title.trim())
      const viewportWidth = await page.evaluate(() => innerWidth)
      await expect.poll(() => menu.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(viewportWidth, 0)
      const list = menu.locator('.capacitorTabActionList')
      await expect.poll(() => list.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(48)
      await list.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect(menu.getByRole('menuitem', { name: 'Close Tab', exact: true })).toBeInViewport()
      await expectScrollAtRenderedEnd(list)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(target).toBeFocused()
    })
  }
}
