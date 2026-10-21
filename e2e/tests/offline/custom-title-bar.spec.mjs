import { test, expect, setWindowSize } from '../../helpers/app.mjs'

/**
 * Measures the space the window controls take at each window edge and the
 * padding of the bar beside them.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
function getControlsGeometry(page, selector) {
  return page.evaluate((selector) => {
    const controls = { left: 0, right: 0, height: 0 }
    for (const group of document.querySelectorAll('.windowControls')) {
      const rect = group.getBoundingClientRect()
      if (rect.width === 0) continue
      if (group.classList.contains('left')) {
        controls.left = rect.right
      } else {
        controls.right = innerWidth - rect.left
      }
      controls.height = Math.max(controls.height, rect.height)
    }
    const bar = document.querySelector(selector)
    const style = getComputedStyle(bar)
    return {
      ...controls,
      paddingLeft: parseFloat(style.paddingLeft),
      paddingRight: parseFloat(style.paddingRight),
      region: style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region')
    }
  }, selector)
}

test.describe('without a custom title bar', () => {
  test('keeps the system title bar', async ({ page }) => {
    await expect(page.locator('.app')).not.toHaveClass(/customTitleBar/)
    await expect(page.locator('.windowControls')).toHaveCount(0)
  })
})

test.describe('with a custom title bar', () => {
  test.use({ seed: { settings: { customTitleBar: true } } })

  test('places the window controls beside the top tabs @scale', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 700 })
    await page.evaluate(async () => {
      for (let index = 0; index < 30; index++) {
        await window.ftElectron.tabs.create({ route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true })
      }
    })
    await expect(page.locator('.app')).toHaveClass(/customTitleBar/)

    const geometry = await getControlsGeometry(page, '.tabBar')
    expect(geometry.left + geometry.right).toBeGreaterThan(0)
    expect(geometry.height).toBeCloseTo(32, 0)
    expect(geometry.paddingLeft).toBeGreaterThanOrEqual(geometry.left - 0.5)
    expect(geometry.paddingRight).toBeGreaterThanOrEqual(geometry.right - 0.5)
    expect(geometry.region).toBe('drag')

    // Overflowing tabs and the bar's buttons stay clear of the controls.
    const overlap = await page.evaluate(({ left, right }) => {
      return [...document.querySelectorAll('.tabsViewport, .newTabButton, .tabOrganizerButton')]
        .map(element => element.getBoundingClientRect())
        .some(rect => rect.left < left - 0.5 || rect.right > innerWidth - right + 0.5)
    }, geometry)
    expect(overlap).toBe(false)

    const tabRegion = await page.locator('.tabBar .tab').first().evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    expect(tabRegion).toBe('no-drag')
    const buttonRegion = await page.locator('.newTabButton').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    expect(buttonRegion).toBe('no-drag')
  })

  test('controls the window with the desktop\'s button layout', async ({ app, page }) => {
    // The layout comes from the host desktop, such as GNOME's close button only.
    const { layout } = await page.evaluate(() => window.ftElectron.windowControls.getState())
    const names = layout.split(/[:,]/).filter(name => ['minimize', 'maximize', 'close'].includes(name))
    const controls = page.locator('.windowControl')
    await expect(controls).toHaveCount(names.length)
    expect(await controls.evaluateAll(buttons => buttons.map(button => button.classList[1]))).toEqual(names)

    // A virtual display has no window manager to change the window's state,
    // so record the calls and report the states as one would.
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0]
      const state = { maximized: false, fullScreen: false }
      globalThis.windowControlCalls = []
      for (const action of ['minimize', 'maximize', 'unmaximize']) {
        browserWindow[action] = () => globalThis.windowControlCalls.push(action)
      }
      browserWindow.isMaximized = () => state.maximized
      browserWindow.isFullScreen = () => state.fullScreen
      globalThis.setWindowState = (key, value, event) => {
        state[key] = value
        browserWindow.emit(event)
      }
    })
    const calls = () => app.electronApp.evaluate(() => globalThis.windowControlCalls)
    const setWindowState = (...args) => app.electronApp.evaluate((_, args) => globalThis.setWindowState(...args), args)

    const maximize = page.locator('.windowControl.maximize')
    if (names.includes('minimize')) {
      await page.locator('.windowControl.minimize').click()
      await expect.poll(calls).toEqual(['minimize'])
    }
    if (names.includes('maximize')) {
      await maximize.click()
      await expect.poll(async () => (await calls()).at(-1)).toBe('maximize')
      await setWindowState('maximized', true, 'maximize')
      await expect(maximize).toHaveAccessibleName('Restore')
      await maximize.click()
      await expect.poll(async () => (await calls()).at(-1)).toBe('unmaximize')
      await setWindowState('maximized', false, 'unmaximize')
      await expect(maximize).toHaveAccessibleName('Maximize')
    }

    // The desktop's controls hide in fullscreen and give their space back.
    await setWindowState('fullScreen', true, 'enter-full-screen')
    await expect(controls).toHaveCount(0)
    const fullScreenGeometry = await getControlsGeometry(page, '.tabBar')
    expect(fullScreenGeometry.paddingLeft).toBeLessThan(10)
    expect(fullScreenGeometry.paddingRight).toBeLessThan(10)
    await setWindowState('fullScreen', false, 'leave-full-screen')
    await expect(controls).toHaveCount(names.length)
  })

  test('moves the window controls to the top navigation without top tabs @scale', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 700 })
    await page.evaluate(() => window.$store.commit('setTabBarPosition', 'bottom'))
    await expect(page.locator('.app')).toHaveClass(/bottomTabs/)

    const geometry = await getControlsGeometry(page, '.topNavInner')
    expect(Math.abs(geometry.paddingLeft - geometry.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(geometry.paddingRight - Math.max(0, geometry.right))).toBeLessThanOrEqual(1)
    const navRegion = await page.locator('.topNav').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    expect(navRegion).toBe('drag')
    const buttonRegion = await page.locator('.topNav .navBackButton').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    expect(buttonRegion).toBe('no-drag')
    const tabBarRegion = await page.locator('.tabBar').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    expect(tabBarRegion).toBe('none')
  })

  test('keeps vertical tabs below window controls in their corner @scale', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 700 })
    for (const position of ['left', 'right']) {
      await page.evaluate(position => window.$store.commit('setTabBarPosition', position), position)
      await expect(page.locator('.tabBar')).toHaveClass(new RegExp(`position-${position}`))
      const controls = await getControlsGeometry(page, '.tabBar')
      const tabsTop = await page.locator('.tabBar .tabsViewport').evaluate(element => element.getBoundingClientRect().top)
      expect(tabsTop).toBeGreaterThanOrEqual(controls[position] > 0 ? controls.height : 0)
    }
  })

  test('keeps floating layers above the drag region clickable', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const palette = page.locator('.commandPaletteBackdrop')
    await expect(palette).toBeVisible()
    expect(await palette.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('no-drag')
  })
})
