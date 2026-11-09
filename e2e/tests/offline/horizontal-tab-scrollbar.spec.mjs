import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { DEFAULT_QUICK_SETTINGS } from '../../../src/renderer/helpers/quickSettings.js'
import { expectTabStripSettled } from '../../helpers/tabs.mjs'

test.use({ seed: { settings: { alwaysShowScrollbars: true } } })

for (const position of ['bottom']) {
  test(`quick settings stay inside the viewport above the reserved scrollbar row at ${position}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1400, height: 700 })
    await page.evaluate(async ({ position, quickSettings }) => {
      window.ftElectron.setZoomFactor(0.95)
      const store = window.$store
      store.commit('setTabBarPosition', position)
      store.commit('setScrollbarThumbWidth', 20)
      store.commit('setQuickSettings', quickSettings)
      for (let index = 0; index < 18; index++) {
        await window.ftElectron.tabs.create({ route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true })
      }
    }, { position, quickSettings: [...DEFAULT_QUICK_SETTINGS, 'useProxy'] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.tabsContainer > .os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-visible/)
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toHaveCSS('transform', 'none')
    await expect.poll(() => menu.evaluate((element, position) => {
      const boundary = position === 'bottom' ? document.querySelector('.tabBar').getBoundingClientRect().top : innerHeight
      return boundary - element.getBoundingClientRect().bottom
    }, position)).toBeGreaterThanOrEqual(4)
  })
}

test.describe('RTL horizontal scrolling', () => {
  test.use({ seed: { settings: { alwaysShowScrollbars: true, currentLocale: 'ar' } } })

  test('RTL horizontal scrolling keeps wheel, drag, and shrinking ranges consistent at bottom', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 800, height: 600 })
    const groupId = await page.evaluate(async () => {
      window.ftElectron.setZoomFactor(0.95)
      window.$store.commit('setTabBarPosition', 'bottom')
      const ids = []
      for (let index = 0; index < 18; index++) {
        const tab = await window.ftElectron.tabs.create({
          route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true
        })
        ids.push(tab.id)
      }
      const group = await window.ftElectron.tabs.createGroup({ name: 'History', color: 'green' })
      await window.ftElectron.tabs.setGroup(ids, group.id)
      return group.id
    })
    const container = page.locator('.tabsContainer')
    await expect.poll(() => container.evaluate(element => getComputedStyle(element).direction)).toBe('rtl')
    const scrollbar = container.locator(':scope > .os-scrollbar-horizontal')
    await expect(scrollbar).toHaveClass(/os-scrollbar-rtl/)
    await container.hover()
    await container.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 300 })))
    await expect.poll(() => container.evaluate(element => Math.abs(element.scrollLeft + 300))).toBeLessThanOrEqual(2)
    await container.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -100 })))
    await expect.poll(() => container.evaluate(element => Math.abs(element.scrollLeft + 400))).toBeLessThanOrEqual(2)
    const handle = scrollbar.locator('.os-scrollbar-handle')
    await handle.hover()
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeLessThan(-500)
    await expect.poll(() => page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabBarScrollPosition)).toBeLessThan(-500)
    // A track press scrolls towards it: right of the handle is the start in RTL.
    const beforeTrackClick = await container.evaluate(element => element.scrollLeft)
    const trackBox = await scrollbar.locator('.os-scrollbar-track').boundingBox()
    await page.mouse.click(trackBox.x + trackBox.width - 4, trackBox.y + trackBox.height / 2)
    await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeGreaterThan(beforeTrackClick + 100)
    await container.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10000 })))
    await page.evaluate(groupId => window.ftElectron.tabs.updateGroup(groupId, { isCollapsed: true }), groupId)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await expect.poll(() => container.evaluate(element => ({
      offset: element.scrollLeft,
      range: element.scrollWidth - element.clientWidth
    }))).toEqual({ offset: 0, range: 0 })
    await expect.poll(() => page.evaluate(async () => Math.abs((await window.ftElectron.tabs.getState()).tabBarScrollPosition))).toBe(0)
  })
})

for (const position of ['top', 'bottom']) {
  test(`wide horizontal scrollbars keep tab actions reachable at ${position}`, { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 800, height: 600 })
    await page.evaluate(async ({ position }) => {
      const store = window.$store
      store.commit('setTabBarPosition', position)
      store.commit('setScrollbarThumbWidth', 20)
      for (let index = 0; index < 18; index++) {
        await window.ftElectron.tabs.create({
          route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true
        })
      }
    }, { position })
    await expect.poll(() => page.locator('.tabBar').evaluate((element, position) => {
      const bar = element.getBoundingClientRect()
      const navigation = document.querySelector(position === 'top' ? '.topNav' : '.sideNav').getBoundingClientRect()
      return Math.abs(position === 'top' ? navigation.top - bar.bottom : bar.top - navigation.bottom)
    }, position)).toBeLessThan(1)
    const tab = page.locator('.tab').nth(1)
    const id = await tab.getAttribute('data-tab-id')
    const title = tab.locator('.tabTitleText')
    const box = await title.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => title.evaluate(element => {
      const box = element.getBoundingClientRect()
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.tab')?.dataset.tabId
    })).toBe(id)
    await title.click()
    await expect(tab).toHaveClass(/active/)
    await tab.locator('.closeButton').click()
    await expect(page.locator(`.tab[data-tab-id="${id}"]`)).toHaveCount(0)
  })
}

test('horizontal tabs use the shared scrollbar and its appearance settings', { tag: '@scale' }, async ({ page, uiScale }) => {
  await page.evaluate(async () => {
    for (let index = 0; index < 18; index++) {
      await window.ftElectron.tabs.create({
        route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true
      })
    }
  })
  const container = page.locator('.tabsContainer')
  const scrollbar = container.locator(':scope > .os-scrollbar-horizontal')
  const handle = scrollbar.locator('.os-scrollbar-handle')
  const expectThickness = async thickness => {
    await expect.poll(() => handle.evaluate((element, expected) => (
      Math.abs(parseFloat(getComputedStyle(element).height) - expected)
    ), thickness)).toBeLessThan(0.1)
  }
  await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
  await expectThickness(3)
  await page.evaluate(() => {
    window.$store.dispatch('updateScrollbarThumbWidth', 10)
  })
  await expectThickness(5)
  await handle.hover()
  await expectThickness(10)
  await container.hover()
  // Hovering the handle scrolls it into view, which can nudge the strip by a few pixels at fractional UI scales.
  const beforeWheel = await container.evaluate(element => element.scrollLeft)
  await page.mouse.wheel(0, 300)
  // Wheel deltas are device pixels, so UI scale changes the CSS scroll distance.
  await expect.poll(() => container.evaluate((element, target) => Math.abs(element.scrollLeft - target), beforeWheel + 300 * 100 / uiScale)).toBeLessThanOrEqual(2)
  const originalOrder = await container.locator('.tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))
  await handle.hover()
  const beforeDrag = await container.evaluate(element => element.scrollLeft)
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeGreaterThan(beforeDrag + 100)
  await expect.poll(() => page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabBarScrollPosition)).toBeGreaterThan(beforeDrag + 100)
  await expect.poll(() => container.locator('.tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))).toEqual(originalOrder)
  await container.evaluate(element => { element.scrollLeft = 0 })
  const track = scrollbar.locator('.os-scrollbar-track')
  await track.click({ position: { x: (await track.boundingBox()).width - 10, y: 5 } })
  await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeGreaterThan(100)
  await page.evaluate(() => {
    window.$store.commit('setAlwaysShowScrollbars', false)
  })
  await page.mouse.move(500, 500)
  await expect(scrollbar).toHaveClass(/app-scrollbar-idle/)
  // The pointer move shows the bar only until the auto-hide delay, so a slow
  // renderer can hide it again before a poll sees it. Record the change instead.
  const shown = scrollbar.evaluate(element => new Promise(resolve => {
    new MutationObserver((_, observer) => {
      if (element.classList.contains('app-scrollbar-idle')) return
      observer.disconnect()
      resolve(true)
    }).observe(element, { attributeFilter: ['class'] })
  }))
  await container.hover()
  expect(await shown).toBe(true)
  await page.evaluate(() => {
    window.$store.commit('setAlwaysShowScrollbars', true)
  })
  await page.mouse.move(500, 500)
  await expect(scrollbar).not.toHaveClass(/app-scrollbar-idle/)
  await page.evaluate(() => {
    window.$store.commit('setScrollbarThumbWidth', 6)
  })
  await expectThickness(3)
  for (const position of ['top', 'bottom']) {
    await page.evaluate(position => {
      window.$store.commit('setTabBarPosition', position)
    }, position)
    await page.mouse.move(500, 500)
    await expectThickness(3)
    const trackHeight = await scrollbar.locator('.os-scrollbar-track').evaluate(element => element.clientHeight)
    expect(trackHeight).toBe(6)
    await handle.hover()
    await expectThickness(6)
  }
})

test('horizontal scrollbar clamps shrinking content at top', { tag: '@scale' }, async ({ app, page }) => {
  await setWindowSize(app, page, { width: 800, height: 600 })
  const groupId = await page.evaluate(async () => {
    const store = window.$store
    store.commit('setTabBarPosition', 'top')
    store.commit('setUseFixedTabWidth', true)
    store.commit('setFixedTabWidth', 200)
    const ids = []
    for (let index = 0; index < 12; index++) {
      const tab = await window.ftElectron.tabs.create({
        route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true
      })
      ids.push(tab.id)
    }
    const group = await window.ftElectron.tabs.createGroup({ name: 'History', color: 'green' })
    await window.ftElectron.tabs.setGroup(ids, group.id)
    return group.id
  })
  const container = page.locator('.tabsContainer')
  const scrollbar = container.locator(':scope > .os-scrollbar-horizontal')
  const scrollToEnd = async () => {
    await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
    await expectTabStripSettled(page)
    await container.evaluate(element => { element.scrollLeft = element.scrollWidth })
    // Native scroll events reach Electron asynchronously. Ensure the
    // position is shared before title updates publish another tab snapshot.
    await expect.poll(async () => {
      const native = await container.evaluate(element => ({
        offset: element.scrollLeft,
        maximum: element.scrollWidth - element.clientWidth,
        scale: devicePixelRatio
      }))
      const shared = await page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabBarScrollPosition)
      return {
        atEnd: Math.abs(native.maximum - native.offset) * native.scale <= 2,
        sharedMatches: Math.abs(shared - native.offset) * native.scale <= 2
      }
    }).toEqual({ atEnd: true, sharedMatches: true })
  }
  const expectValidEnd = async () => {
    await expect.poll(() => container.evaluate(element => {
      const content = element.querySelector('.tabsContent')
      const maximum = Math.max(0, content.scrollWidth - element.clientWidth)
      const track = element.querySelector('.os-scrollbar-horizontal')
      const handle = track.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      const trackBox = track.querySelector('.os-scrollbar-track').getBoundingClientRect()
      return {
        inRange: element.scrollLeft <= maximum + 1,
        noEmptySpace: content.getBoundingClientRect().right >= element.getBoundingClientRect().right - 2,
        overflowMatches: track.classList.contains('os-scrollbar-unusable') === (maximum <= 1),
        thumbMatches: maximum <= 1 || Math.abs(handle.right - trackBox.right) <= 2
      }
    })).toEqual({ inRange: true, noEmptySpace: true, overflowMatches: true, thumbMatches: true })
  }
  await scrollToEnd()
  await page.evaluate(() => window.$store.commit('setFixedTabWidth', 100))
  await expectValidEnd()
  await page.evaluate(async () => {
    const store = window.$store
    store.commit('setUseFixedTabWidth', false)
    const { tabs } = await window.ftElectron.tabs.getState()
    for (const tab of tabs) window.ftElectron.tabs.updateTitle('A long history tab title that fills its maximum width', tab.id)
  })
  // Title updates use asynchronous IPC; confirm the wider content has
  // rendered before scrolling, then verify the shortened titles separately.
  await expect(container.locator('.tabTitleText')).toHaveText(Array(13).fill('A long history tab title that fills its maximum width'))
  await scrollToEnd()
  await page.evaluate(async () => {
    const { tabs } = await window.ftElectron.tabs.getState()
    for (const tab of tabs) window.ftElectron.tabs.updateTitle('History', tab.id)
  })
  await expect(container.locator('.tabTitleText')).toHaveText(Array(13).fill('History'))
  await expectValidEnd()
  await page.evaluate(() => window.$store.commit('setUseFixedTabWidth', true))
  await scrollToEnd()
  await page.evaluate(groupId => window.ftElectron.tabs.updateGroup(groupId, { isCollapsed: true }), groupId)
  await expectValidEnd()
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  await page.evaluate(groupId => window.ftElectron.tabs.updateGroup(groupId, { isCollapsed: false }), groupId)
  await scrollToEnd()
  await page.evaluate(async () => {
    const { tabs } = await window.ftElectron.tabs.getState()
    for (const tab of tabs.slice(-8)) window.ftElectron.tabs.close(tab.id)
  })
  await expectValidEnd()
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setUseFixedTabWidth', true)
    store.commit('setFixedTabWidth', 200)
  })
  await scrollToEnd()
  await setWindowSize(app, page, { width: 1800, height: 900 })
  await expectValidEnd()
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})
