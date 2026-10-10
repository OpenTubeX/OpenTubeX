import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'

// Acquire the Android lab lock and install the current debug APK first.
const serial = process.argv[2]
assert.ok(serial, 'Pass the locked emulator/device serial')
const baseline = process.argv.includes('--baseline')
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
let browser
let page
let port
try {
  adb('shell', 'am', 'start', '--user', '0', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
  let connectionError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pid = adb('shell', 'pidof', 'org.opentubex.app.dev')
      const forwardedPort = adb('forward', port ? `tcp:${port}` : 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
      port ||= forwardedPort
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (page) break
      throw new Error('Android WebView has no page yet')
    } catch (error) {
      connectionError = error
      // The app's WebView may still be starting. Release a partial connection.
      await browser?.close().catch(() => {})
      browser = undefined
    }
    await delay(100)
  }
  if (!page) throw new Error('Android WebView is unavailable after 100 connection attempts', { cause: connectionError })
  await page.addLocatorHandler(page.locator('.tutorialOverlay'), async () => {
    await page.locator('.tutorialActions button').first().click()
  })
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.tabGestureSavedState = {
      tabs: {
        ...store.state.tabs,
        currentWatchTimestamps: { ...store.state.tabs.currentWatchTimestamps },
        videoZoomByTabId: { ...store.state.tabs.videoZoomByTabId },
        lightsOffByTabId: { ...store.state.tabs.lightsOffByTabId },
        musicModeByTabId: { ...store.state.tabs.musicModeByTabId },
        skipSilenceByTabId: { ...store.state.tabs.skipSilenceByTabId },
      },
      layout: store.state.settings.capacitorLayoutMode,
      enabled: store.state.settings.enableMobileTabs,
      uiScale: store.state.settings.uiScale,
      tabCloseFocus: store.state.settings.tabCloseFocus,
      storage: localStorage.getItem('opentubex-capacitor-tabs'),
    }
    store.state.settings.capacitorLayoutMode = 'phone'
    store.state.settings.enableMobileTabs = true
    const active = { ...store.getters.getPresentedTab, isPinned: false }
    const extraTabs = Array.from({ length: 99 }, (_, index) => ({
      ...active,
      id: `gesture-test-${index}`,
      title: `Test tab ${index + 1}`,
      contentTitle: '',
      isPinned: false,
      loadState: 'unloaded',
      isUnloaded: true,
      isLoading: false,
      isPlaying: false,
      history: active.history.map(entry => ({ ...entry })),
    }))
    store.commit('setTabsState', {
      ...store.state.tabs, tabs: [active, ...extraTabs], presentedTabId: active.id,
    })
    window.tabGestureSeededState = { ...store.state.tabs }
  })
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(100)
  const session = await page.context().newCDPSession(page)
  async function touch(type, x = 0, y = 0) {
    await session.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    })
  }
  function row(id) { return page.locator(`.capacitorPhoneTabRow:has([data-tab-id="${id}"])`) }
  async function visibleBounds(locator) {
    await expect(locator).toBeVisible()
    const bounds = await locator.boundingBox()
    assert.ok(bounds, `Visible bounds are unavailable for ${locator}`)
    return bounds
  }

  // Count actual component renders, and measure event-to-next-frame latency.
  await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__
    function find(vnode) {
      if (!vnode) return null
      const component = vnode.component
      if (component?.type.__name === 'CapacitorPhoneTabSwitcher') return component
      if (component) return find(component.subTree)
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
          const found = find(child)
          if (found) return found
        }
      }
      return null
    }
    const instance = find((app._instance ?? app._container._vnode.component).subTree)
    if (!instance) throw new Error('Tab switcher component is unavailable')
    const components = []
    function collect(vnode) {
      if (!vnode) return
      if (vnode.component) {
        components.push(vnode.component)
        collect(vnode.component.subTree)
      } else if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) collect(child)
      }
    }
    collect(instance.vnode)
    window.tabGestureProbe = { renders: 0, frames: [], originals: [] }
    for (const component of components) {
      const render = component.render
      window.tabGestureProbe.originals.push({ component, render })
      component.render = function (...args) {
        window.tabGestureProbe.renders++
        return render.apply(this, args)
      }
    }
    window.tabGestureOnMove = () => {
      const start = performance.now()
      requestAnimationFrame(() => window.tabGestureProbe.frames.push(performance.now() - start))
    }
    document.querySelector('.capacitorPhoneOpenTabs').addEventListener('pointermove', window.tabGestureOnMove)
  })
  for (const scale of [100, 125]) {
    await page.evaluate(scale => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.uiScale = scale
    }, scale)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await row('gesture-test-0').scrollIntoViewIfNeeded()
    const bounds = await visibleBounds(row('gesture-test-0'))
    const x = bounds.x + bounds.width * 0.4
    const y = bounds.y + bounds.height * 0.4
    await touch('touchStart', x, y)
    await touch('touchMove', x + 10, y)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => { window.tabGestureProbe.renders = 0; window.tabGestureProbe.frames = [] })
    for (let step = 1; step <= 20; step++) await touch('touchMove', x + 10 + step * 2.5, y)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const metrics = await page.evaluate(() => ({
      renders: window.tabGestureProbe.renders,
      frames: window.tabGestureProbe.frames,
    }))
    await expect(row('gesture-test-0')).not.toHaveCSS('transform', 'none')
    const transform = await row('gesture-test-0').evaluate(element => getComputedStyle(element).transform)
    console.log(`swipe scale ${scale}`, {
      renders: metrics.renders,
      samples: metrics.frames.length,
      maxEventToFrameMs: Math.max(...metrics.frames).toFixed(1),
      transform,
    })
    if (!baseline) assert.ok(metrics.renders <= 1, 'Moving the card must not repeatedly render the tab grid')
    await touch('touchCancel')
    await expect(row('gesture-test-0')).toHaveCSS('opacity', '1')
    await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(100)
  }

  // Start a second close while the first card is still animating out.
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.uiScale = 100
  })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const first = await visibleBounds(row('gesture-test-0'))
  const second = await visibleBounds(row('gesture-test-1'))
  for (const bounds of [first, second]) {
    const x = bounds.x + bounds.width * 0.4
    const y = bounds.y + bounds.height * 0.4
    await touch('touchStart', x, y)
    await touch('touchMove', x + 50, y)
    await touch('touchMove', x + 100, y)
    await touch('touchEnd')
  }
  if (baseline) await delay(500)
  else await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(98)
  const remaining = await page.locator('.capacitorPhoneTabRow').count()
  console.log('consecutive closes', { remaining, expected: 98 })
  if (!baseline) {
    await expect(row('gesture-test-0')).toHaveCount(0)
    await expect(row('gesture-test-1')).toHaveCount(0)

    const source = row('gesture-test-2')
    const bounds = await visibleBounds(source)
    const destination = await visibleBounds(page.locator('.capacitorPhoneTabRow').first())
    const y = bounds.y + bounds.height * 0.4
    await touch('touchStart', bounds.x + bounds.width / 2, y)
    await delay(450)
    await expect(source).toHaveClass(/holding/)
    await touch('touchMove', destination.x + destination.width / 2, y)
    await expect(source).toHaveClass(/dragging/)
    await touch('touchEnd')
    await expect(page.locator('.capacitorPhoneTabTarget').first()).toHaveAttribute('data-tab-id', 'gesture-test-2')
    console.log('long-press reorder', { firstTab: 'gesture-test-2' })

    // A quick vertical gesture must still scroll rather than close or reorder.
    await touch('touchStart', destination.x + destination.width / 2, y)
    await touch('touchMove', destination.x + destination.width / 2, y - 120)
    await touch('touchMove', destination.x + destination.width / 2, y - 180)
    await touch('touchEnd')
    await expect.poll(() => page.locator('.capacitorPhoneTabList').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(98)
    console.log('vertical scrolling', { tabs: 98 })

    // Closing the active card can wait for its unloaded replacement to mount.
    // The next accepted close must not interrupt that presentation.
    const activeId = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.state.settings.tabCloseFocus = 'nextTab'
      store.commit('setTabsState', window.tabGestureSeededState)
      return store.getters.getPresentedTabId
    })
    await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(100)
    await row(activeId).scrollIntoViewIfNeeded()
    const activeBounds = await visibleBounds(row(activeId))
    const replacementBounds = await visibleBounds(row('gesture-test-0'))
    for (const [index, bounds] of [activeBounds, replacementBounds].entries()) {
      const x = bounds.x + bounds.width * 0.4
      const y = bounds.y + bounds.height * 0.4
      // Move the left card away from its neighbor so it cannot cover its touch target.
      const direction = index === 0 ? -1 : 1
      await touch('touchStart', x, y)
      await touch('touchMove', x + direction * 50, y)
      await touch('touchMove', x + direction * 100, y)
      await touch('touchEnd')
    }
    await expect(row(activeId)).toHaveCount(0)
    await expect(row('gesture-test-0')).toHaveCount(0)
    await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(98)
    console.log('active and replacement closes', { remaining: 98 })
  }
} finally {
  try {
    if (page) {
      await page.evaluate(async () => {
        const probe = window.tabGestureProbe
        if (probe) {
          for (const { component, render } of probe.originals) component.render = render
        }
        document.querySelector('.capacitorPhoneOpenTabs')?.removeEventListener('pointermove', window.tabGestureOnMove)
        document.querySelector('.capacitorPhoneTabHeaderButton:last-child')?.click()
        const saved = window.tabGestureSavedState
        if (saved) {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          // Let the budget callback and its delayed persistence settle on the test session.
          await new Promise(resolve => setTimeout(resolve, 1250))
          store.state.tabs = saved.tabs
          store.state.settings.capacitorLayoutMode = saved.layout
          store.state.settings.enableMobileTabs = saved.enabled
          store.state.settings.uiScale = saved.uiScale
          store.state.settings.tabCloseFocus = saved.tabCloseFocus
          if (saved.storage === null) localStorage.removeItem('opentubex-capacitor-tabs')
          else localStorage.setItem('opentubex-capacitor-tabs', saved.storage)
        }
        delete window.tabGestureSavedState
        delete window.tabGestureSeededState
        delete window.tabGestureProbe
        delete window.tabGestureOnMove
      })
    }
  } finally {
    if (browser) await browser.close()
    if (port) adb('forward', '--remove', `tcp:${port}`)
  }
}
