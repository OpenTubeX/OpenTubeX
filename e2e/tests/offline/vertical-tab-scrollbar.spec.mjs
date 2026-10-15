import { test, expect, setWindowSize } from '../../helpers/app.mjs'

test.use({ seed: { settings: { alwaysShowScrollbars: true } } })

test('vertical tab scrollbars halve their idle thickness and keep their full hit area', { tag: '@scale' }, async ({ app, page }, testInfo) => {
  await setWindowSize(app, page, { width: 1100, height: 600 })
  await page.evaluate(async () => {
    for (let index = 0; index < 24; index++) {
      await window.ftElectron.tabs.create({
        route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true
      })
    }
  })
  const container = page.locator('.tabsContainer')
  const scrollbar = container.locator(':scope > .os-scrollbar-vertical')
  const track = scrollbar.locator('.os-scrollbar-track')
  const handle = scrollbar.locator('.os-scrollbar-handle')
  const expectThickness = async thickness => {
    await expect.poll(() => handle.evaluate((element, expected) => (
      Math.abs(parseFloat(getComputedStyle(element).width) - expected)
    ), thickness)).toBeLessThan(0.1)
  }
  const expectWindowEdge = async position => {
    await expect.poll(() => handle.evaluate((element, position) => {
      const bounds = element.getBoundingClientRect()
      const viewport = document.documentElement.getBoundingClientRect()
      return Math.abs(position === 'left' ? bounds.left - viewport.left : viewport.right - bounds.right)
    }, position)).toBeLessThan(0.1)
  }
  for (const position of ['left', 'right']) {
    await page.evaluate(position => window.$store.commit('setTabBarPosition', position), position)
    for (const direction of ['ltr', 'rtl']) {
      await container.evaluate((element, direction) => { element.dir = direction }, direction)
      for (const width of [6, 10]) {
        await page.evaluate(width => window.$store.commit('setScrollbarThumbWidth', width), width)
        await page.mouse.move(500, 300)
        await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
        await expectThickness(width / 2)
        expect(await track.evaluate(element => element.clientWidth)).toBe(width)
        await expect.poll(() => handle.evaluate((element, position) => {
          const handle = element.getBoundingClientRect()
          const track = element.parentElement.getBoundingClientRect()
          return Math.abs(position === 'left' ? handle.left - track.left : handle.right - track.right)
        }, position)).toBeLessThan(0.1)
        await expectWindowEdge(position)
        await handle.hover()
        await expectThickness(width)
        await expectWindowEdge(position)
      }
    }
  }
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setTabBarPosition', 'left')
    store.commit('setScrollbarThumbWidth', 6)
  })
  await container.evaluate(element => { element.dir = 'ltr' })
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
    await page.mouse.move(500, 300)
    await expectThickness(3)
    await page.screenshot({ path: testInfo.outputPath(`vertical-tab-scrollbar-${colorScheme}.png`), clip: { x: 0, y: 0, width: 220, height: 260 }, animations: 'disabled' })
    await handle.hover()
    await expectThickness(6)
    await page.screenshot({ path: testInfo.outputPath(`vertical-tab-scrollbar-${colorScheme}-hover.png`), clip: { x: 0, y: 0, width: 220, height: 260 }, animations: 'disabled' })
  }
  await container.hover()
  await page.mouse.wheel(0, 100)
  await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const originalOrder = await container.locator('.tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))
  await handle.hover()
  const beforeDrag = await container.evaluate(element => element.scrollTop)
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(beforeDrag + 50)
  await expect.poll(() => container.locator('.tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))).toEqual(originalOrder)
  await container.evaluate(element => { element.scrollTop = 0 })
  const trackBox = await track.boundingBox()
  await track.click({ position: { x: trackBox.width / 2, y: trackBox.height - 10 } })
  await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
})

for (const position of ['left', 'right']) {
  test(`vertical scrollbar clamps shrinking content at ${position}`, { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 800, height: 400 })
    await page.evaluate(async (position) => {
      window.$store.commit('setTabBarPosition', position)
      for (let index = 0; index < 24; index++) {
        await window.ftElectron.tabs.create({
          route: '/history', title: `History ${index + 1}`, makeActive: false, lazyLoad: true
        })
      }
    }, position)
    const container = page.locator('.tabsContainer')
    const scrollbar = container.locator(':scope > .os-scrollbar-vertical')
    const scrollToEnd = async () => {
      await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
      await container.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    }
    const expectValidEnd = async () => {
      await expect.poll(() => container.evaluate(element => {
        const content = element.querySelector('.tabsContent')
        const maximum = Math.max(0, content.scrollHeight - element.clientHeight)
        const track = element.querySelector('.os-scrollbar-vertical')
        const handle = track.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        const trackBox = track.querySelector('.os-scrollbar-track').getBoundingClientRect()
        return {
          inRange: element.scrollTop <= maximum + 1,
          noEmptySpace: maximum <= 1 || Math.abs(content.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom) * devicePixelRatio <= 2,
          overflowMatches: track.classList.contains('os-scrollbar-unusable') === (maximum <= 1),
          thumbMatches: maximum <= 1 || Math.abs(handle.bottom - trackBox.bottom) <= 2
        }
      })).toEqual({ inRange: true, noEmptySpace: true, overflowMatches: true, thumbMatches: true })
    }
    await scrollToEnd()
    await page.evaluate(async () => {
      const { tabs } = await window.ftElectron.tabs.getState()
      for (const tab of tabs.slice(-4)) window.ftElectron.tabs.close(tab.id)
    })
    await expect(container.locator('.tab')).toHaveCount(21)
    await expectValidEnd()
    await scrollToEnd()
    await setWindowSize(app, page, { width: 850, height: 550 })
    await expectValidEnd()
    await scrollToEnd()
    const groupId = await page.evaluate(async () => {
      const { tabs } = await window.ftElectron.tabs.getState()
      const group = await window.ftElectron.tabs.createGroup({ name: 'History', color: 'green' })
      await window.ftElectron.tabs.setGroup(tabs.slice(1).map(tab => tab.id), group.id)
      return group.id
    })
    await page.evaluate(groupId => window.ftElectron.tabs.updateGroup(groupId, { isCollapsed: true }), groupId)
    await expect(container.locator('.collapsedTabGroup')).toHaveCount(1)
    await expectValidEnd()
    await expect.poll(() => container.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })
}
