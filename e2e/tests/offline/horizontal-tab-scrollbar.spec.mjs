import { test, expect, setWindowSize } from '../../helpers/app.mjs'

test.use({ seed: { settings: { alwaysShowScrollbars: true } } })

test('horizontal tabs use the shared scrollbar and its appearance settings', async ({ page }, testInfo) => {
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
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateScrollbarThumbWidth', 10)
  })
  await expectThickness(5)
  await handle.hover()
  await expectThickness(10)
  await container.hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(() => container.evaluate(element => Math.abs(element.scrollLeft - 300))).toBeLessThanOrEqual(2)
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
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAlwaysShowScrollbars', false)
  })
  await page.mouse.move(500, 500)
  await expect(scrollbar).toHaveClass(/app-scrollbar-idle/)
  await container.hover()
  await expect(scrollbar).not.toHaveClass(/app-scrollbar-idle/)
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAlwaysShowScrollbars', true)
  })
  await page.mouse.move(500, 500)
  await expect(scrollbar).not.toHaveClass(/app-scrollbar-idle/)
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setScrollbarThumbWidth', 6)
  })
  await expectThickness(3)
  for (const position of ['top', 'bottom']) {
    for (const scale of [1, 0.95, 1.25]) {
      await page.evaluate(({ position, scale }) => {
        window.ftElectron.setZoomFactor(scale)
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setTabBarPosition', position)
      }, { position, scale })
      await page.mouse.move(500, 500)
      await expectThickness(3)
      const trackHeight = await scrollbar.locator('.os-scrollbar-track').evaluate(element => element.clientHeight)
      expect(trackHeight).toBe(6)
      await handle.hover()
      await expectThickness(6)
    }
  }
  await page.evaluate(() => {
    window.ftElectron.setZoomFactor(1)
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setTabBarPosition', 'top')
  })
  await page.mouse.move(500, 500)
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
    await expectThickness(3)
    await page.locator('.tabBar').screenshot({ path: testInfo.outputPath(`horizontal-tab-scrollbar-${colorScheme}.png`), animations: 'disabled' })
    await handle.hover()
    await expectThickness(6)
    await page.locator('.tabBar').screenshot({ path: testInfo.outputPath(`horizontal-tab-scrollbar-${colorScheme}-hover.png`), animations: 'disabled' })
    await page.mouse.move(500, 500)
  }
})

for (const position of ['top', 'bottom']) {
  for (const scale of [1, 0.95, 1.25]) {
    test(`horizontal scrollbar clamps shrinking content at ${position}, ${scale} scale`, async ({ app, page }) => {
      await setWindowSize(app, page, { width: 800, height: 600 })
      const groupId = await page.evaluate(async ({ position, scale }) => {
        window.ftElectron.setZoomFactor(scale)
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabBarPosition', position)
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
      }, { position, scale })
      const container = page.locator('.tabsContainer')
      const scrollbar = container.locator(':scope > .os-scrollbar-horizontal')
      const scrollToEnd = async () => {
        await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
        await container.evaluate(element => { element.scrollLeft = element.scrollWidth })
        await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
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
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setFixedTabWidth', 100))
      await expectValidEnd()
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setUseFixedTabWidth', false)
        const { tabs } = await window.ftElectron.tabs.getState()
        for (const tab of tabs) window.ftElectron.tabs.updateTitle('A long history tab title that fills its maximum width', tab.id)
      })
      await scrollToEnd()
      await page.evaluate(async () => {
        const { tabs } = await window.ftElectron.tabs.getState()
        for (const tab of tabs) window.ftElectron.tabs.updateTitle('History', tab.id)
      })
      await expectValidEnd()
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUseFixedTabWidth', true))
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
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setUseFixedTabWidth', true)
        store.commit('setFixedTabWidth', 200)
      })
      await scrollToEnd()
      await setWindowSize(app, page, { width: 1800, height: 900 })
      await expectValidEnd()
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    })
  }
}
