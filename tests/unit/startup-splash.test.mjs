import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { cacheStartupAppearance, curtainExtent, STARTUP_REVEAL_DURATION_MS } from '../../src/renderer/helpers/startupSplash.js'
import { getThemeBackground } from '../../src/renderer/helpers/customTheme.js'
import { androidDynamicColors } from '../../src/renderer/helpers/dynamicColors.js'

test('curtains cover the window initially and open from the rail before the hem', () => {
  for (const depth of [0, 0.25, 0.5, 0.75, 1]) assert.equal(curtainExtent(0, depth), 1)
  assert.equal(curtainExtent(100, 1), 1, 'the hem initially trails the rail')
  for (const elapsed of [100, 180, 260]) {
    assert.ok(curtainExtent(elapsed, 0) < curtainExtent(elapsed, 0.5))
    assert.ok(curtainExtent(elapsed, 0.5) < curtainExtent(elapsed, 1))
  }
})

test('all fabric leaves the viewport within the shortened reveal', () => {
  assert.ok(STARTUP_REVEAL_DURATION_MS <= 600)
  for (let row = 0; row <= 100; row++) {
    assert.equal(curtainExtent(STARTUP_REVEAL_DURATION_MS, row / 100), 0)
    for (let elapsed = 0; elapsed <= 1000; elapsed += 10) {
      const extent = curtainExtent(elapsed, row / 100)
      assert.ok(Number.isFinite(extent) && extent >= 0 && extent <= 1)
    }
  }
})

test('the initial splash uses native appearance without the renderer', async () => {
  const properties = new Map()
  const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
  let presented = false
  let paint
  const context = {
    window: { ftElectron: {
      startupAppearance: { background: '#1e1e2e', dark: true },
      startupSplashReady: () => { presented = true }
    } },
    requestAnimationFrame: callback => { paint = callback },
    document: {
      documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } }
    }
  }
  vm.runInNewContext(script, context)
  assert.equal(properties.get('--startup-background'), '#1e1e2e')
  assert.equal(properties.get('--startup-foreground'), '#eeeeee')
  assert.equal(presented, false)
  paint()
  assert.equal(presented, true)
})

for (const hideSplash of [true, false, undefined]) {
  test(`early startup honors hideSplash=${hideSplash} before loading the renderer`, async () => {
    const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
    let removed = false
    let inert = true
    let presented = false
    vm.runInNewContext(script, {
      window: { ftElectron: {
        startupAppearance: { hideSplash },
        startupSplashReady: () => { presented = true }
      } },
      document: {
        documentElement: {},
        getElementById: id => id === 'startup-splash'
          ? { remove: () => { removed = true } }
          : { removeAttribute: name => { if (name === 'inert') inert = false } }
      },
      requestAnimationFrame: callback => callback()
    })
    assert.equal(removed, hideSplash === true)
    assert.equal(inert, hideSplash !== true)
    assert.equal(presented, true, 'the native window still becomes visible')
  })
}

test('mobile startup uses cached appearance and can hide the splash before loading Vue', async () => {
  const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
  for (const hideSplash of [false, true]) {
    const properties = new Map()
    let removed = false
    let inert = true
    vm.runInNewContext(script, {
      window: { matchMedia: () => ({ matches: false }) },
      localStorage: { getItem: key => {
        assert.equal(key, 'opentubex-startup-appearance')
        return JSON.stringify({
          light: { background: '#f1f1f1', dark: false },
          dark: { background: '#0f0f0f', dark: true },
          hideSplash
        })
      } },
      document: {
        documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } },
        getElementById: id => id === 'startup-splash'
          ? { remove: () => { removed = true } }
          : { removeAttribute: () => { inert = false } }
      },
      requestAnimationFrame: callback => callback()
    })
    assert.equal(properties.get('--startup-background'), '#f1f1f1')
    assert.equal(properties.get('--startup-foreground'), '#212121')
    assert.equal(removed, hideSplash)
    assert.equal(inert, !hideSplash)
  }
})

test('mobile startup survives unavailable or corrupt appearance storage', async () => {
  const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
  for (const getItem of [() => null, () => '{', () => { throw new Error('storage disabled') }]) {
    let painted = false
    assert.doesNotThrow(() => vm.runInNewContext(script, {
      window: {},
      localStorage: { getItem },
      document: { documentElement: {} },
      requestAnimationFrame: callback => { painted = true; callback() }
    }))
    assert.ok(painted)
  }
})

test('mobile splash follows a system color-scheme change while the app is closed', async () => {
  const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
  for (const dark of [false, true]) {
    const properties = new Map()
    vm.runInNewContext(script, {
      window: { matchMedia: () => ({ matches: dark }) },
      localStorage: { getItem: () => JSON.stringify({
        light: { background: '#f1f1f1', dark: false },
        dark: { background: '#0f0f0f', dark: true },
        hideSplash: false
      }) },
      document: { documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } } },
      requestAnimationFrame: callback => callback()
    })
    assert.equal(properties.get('--startup-background'), dark ? '#0f0f0f' : '#f1f1f1')
    assert.equal(properties.get('--startup-foreground'), dark ? '#eeeeee' : '#212121')
  }
})

test('startup caching resolves both dynamic palettes and selected custom themes', t => {
  const original = androidDynamicColors.value
  t.after(() => { androidDynamicColors.value = original })
  androidDynamicColors.value = { supported: true, palette: { neutral1: { 50: '#fafafa', 900: '#151515' } } }
  assert.equal(getThemeBackground('dynamic', [], false), '#fafafa')
  assert.equal(getThemeBackground('dynamic', [], true), '#151515')
  const themes = [{ id: 'paper', colors: { background: '#fff8ee' } }, { id: 'ink', colors: { background: '#102030' } }]
  assert.equal(getThemeBackground('custom:paper', themes, false), '#fff8ee')
  assert.equal(getThemeBackground('custom:ink', themes, true), '#102030')
})

test('mobile appearance cache preserves colors and the visibility preference', () => {
  const palette = { background: '#112233', dark: true }
  const appearance = { light: palette, dark: palette, hideSplash: true }
  let saved
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      setItem(key, value) {
        assert.equal(key, 'opentubex-startup-appearance')
        saved = JSON.parse(value)
      }
    } })
    cacheStartupAppearance(appearance)
    assert.deepEqual(saved, appearance)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('unavailable') } })
    assert.doesNotThrow(() => cacheStartupAppearance(appearance))
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('saving edits to selected custom themes refreshes both mobile splash appearances', async t => {
  const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const watchers = source.slice(source.indexOf('watch(baseTheme, updateTheme)'), source.indexOf('const secColor ='))
  const cache = source.slice(source.indexOf('function cacheCapacitorStartupAppearance()'), source.indexOf('function updateSystemBarsStyle()'))
  for (const selection of ['custom:paper', 'system']) {
    const getters = reactive({
      getBaseTheme: selection, getSystemLightTheme: 'custom:paper', getSystemDarkTheme: 'custom:ink',
      getMainColor: 'Red', getHideStartupSplash: false,
      getCustomThemes: [{ id: 'paper', colors: { background: '#fff8ee' } }, { id: 'ink', colors: { background: '#102030' } }]
    })
    let saved
    const scope = effectScope()
    t.after(() => scope.stop())
    scope.run(() => vm.runInNewContext(`${cache}\n${watchers}\ncacheCapacitorStartupAppearance()`, {
      isCapacitor: true, appearanceSettingsReady: true,
      store: { getters }, baseTheme: computed(() => getters.getBaseTheme),
      appFont: ref('default'), updateAppFont: () => {},
      computed, watch, getThemeBackground, calculateColorLuminance: () => '#000000',
      cacheStartupAppearance: appearance => { saved = appearance },
      updateTheme: () => {}
    }))
    assert.equal(saved.light.background, '#fff8ee')
    getters.getCustomThemes = [
      { id: 'paper', colors: { background: '#faf0dd' } },
      { id: 'ink', colors: { background: '#203040' } }
    ]
    await nextTick()
    assert.equal(saved.light.background, '#faf0dd', 'Editing a theme keeps its ID but refreshes the cached colors')
    assert.equal(saved.dark.background, selection === 'system' ? '#203040' : '#faf0dd')
  }
})

test('Capacitor waits for data, tab presentation, and route content before revealing', async () => {
  const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const watcher = source.slice(source.indexOf('const STARTUP_PRELOAD_TIMEOUT_MS'), source.indexOf('watch(presentedTabId, async'))
  let callback
  let reveals = 0
  let releaseRoute
  const routeReady = new Promise(resolve => { releaseRoute = resolve })
  vm.runInNewContext(watcher, {
    isElectron: false, isCapacitor: true, usesLogicalTabs: true,
    dataReady: {}, presentedTabId: {},
    store: {}, router: { resolve: fullPath => fullPath },
    document: { getElementById: () => ({}) },
    watch: (_, handler) => { callback = handler },
    preloadResolvedRoute: () => routeReady,
    revealStartupSplash: () => { reveals++ },
    nextTick: async () => {}, setTimeout, clearTimeout, console
  })
  await callback([false, 'tab', 'loaded', '/history'], null, () => {})
  await callback([true, null, 'loading', '/history'], null, () => {})
  assert.equal(reveals, 0)
  const pending = callback([true, 'tab', 'loaded', '/history'], null, () => {})
  assert.equal(reveals, 0, 'the route chunk must finish first')
  releaseRoute()
  await pending
  assert.equal(reveals, 1)
})
