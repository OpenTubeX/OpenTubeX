import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const start = source.indexOf('function updateSystemBarsStyle() {')
const updateSource = source.slice(start, source.indexOf('\nfunction updateAppFont', start))

test('Android keeps its native startup surface while temporary settings load', () => {
  const start = source.indexOf('function updateTheme() {')
  const updateSource = source.slice(start, source.indexOf('\nfunction updateSystemBarsStyle', start))
  const applied = []
  const context = vm.createContext({
    isCapacitor: true,
    Capacitor: { getPlatform: () => 'android' },
    appearanceSettingsReady: false,
    baseTheme: { value: 'system' },
    systemUsesDarkTheme: { value: false },
    mainColor: { value: 'Red' }, secColor: { value: 'Blue' },
    store: { getters: { getSystemLightTheme: 'light', getCustomThemes: [] } },
    applyThemeToDocument: theme => applied.push(theme),
    updateSystemBarsStyle: () => {}
  })
  const update = vm.runInContext(`${updateSource}\nupdateTheme`, context)
  update() // The store initially defaults to the light system theme.
  context.baseTheme.value = 'dark'
  update() // Settings watchers run before appearance initialization finishes.
  assert.deepEqual(applied, [], 'Neither temporary theme paints over the cached native surface')
  context.appearanceSettingsReady = true
  update()
  assert.deepEqual(applied, ['dark'], 'The saved theme is the first renderer background')
})

test('status bar contrast uses the theme color while native video makes the WebView transparent', () => {
  const calls = []
  const backgrounds = []
  const baseTheme = { value: 'system' }
  let theme = '#f1f1f1'
  const update = vm.runInNewContext(`${updateSource}\nupdateSystemBarsStyle`, {
    Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
    document: { body: {} },
    baseTheme,
    getComputedStyle: () => ({ backgroundColor: 'rgba(0, 0, 0, 0)', getPropertyValue: name => name === '--bg-color' ? theme : '' }),
    calculateColorLuminance: color => color === '#f1f1f1' ? '#000000' : '#FFFFFF',
    setAndroidSystemBarsBackground: (color, followSystem) => { backgrounds.push([color, followSystem]); return Promise.resolve() },
    SystemBars: { setStyle: options => { calls.push(options.style); return Promise.resolve() } },
    SystemBarType: { StatusBar: 'status' }, SystemBarsStyle: { Light: 'light', Dark: 'dark' }
  })
  update()
  theme = '#111111'
  baseTheme.value = 'dark'
  update()
  assert.deepEqual(calls, ['light', 'dark'])
  assert.deepEqual(backgrounds, [['#f1f1f1', true], ['#111111', false]])
})

test('native inset colors expand short hex and skip platforms without AndroidUi', async () => {
  const source = (await readFile(new URL('../../src/renderer/helpers/androidUi.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace(/^export /gm, '')
  const calls = []
  let platform = 'android'
  const update = vm.runInNewContext(`${source}\nsetAndroidSystemBarsBackground`, {
    process: { env: { IS_CAPACITOR: true } },
    Capacitor: { getPlatform: () => platform },
    registerPlugin: () => ({ setSystemBarsBackground: options => { calls.push([options.color, options.followSystem]); return Promise.resolve() } })
  })
  await update('#000', false)
  await update('#f1f1f1', true)
  platform = 'ios'
  await update('#fff')
  assert.deepEqual(calls, [['#000000', false], ['#f1f1f1', true]])
})
