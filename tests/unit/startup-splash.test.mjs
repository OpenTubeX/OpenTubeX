import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { cacheStartupAppearance } from '../../src/renderer/helpers/startupSplash.js'

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

for (const hideSplash of [true, false]) {
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
      document: { documentElement: {}, getElementById: () => ({ setAttribute: () => {} }) },
      requestAnimationFrame: callback => { painted = true; callback() }
    }))
    assert.ok(painted)
  }
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
