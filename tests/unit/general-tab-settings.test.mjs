import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { compile, computed, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = await readFile(new URL('../../src/renderer/components/Settings/General/GeneralSettings.vue', import.meta.url), 'utf8')
const keys = ['landingPage', 'newTabPosition', 'tabCloseFocus', 'startupBehavior']
// The Startup and Tabs section, the first of the General page, holds the tab settings.
const startupSection = source.match(/<FtSettingsSection[\s\S]*?<\/FtSettingsSection>/)[0]
for (const key of keys) assert.ok(startupSection.includes(`setting-key="${key}"`), key)
const render = compile(`<div>${startupSection}</div>`)

for (const [platform, USING_ELECTRON, IS_CAPACITOR] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} renders the general tab settings supported by its tab system`, async () => {
    const bindings = {
      USING_ELECTRON,
      IS_CAPACITOR,
      t: key => key,
      store: { getters: { getTabsEnabled: true }, dispatch: () => {} },
      defaultPageNames: [],
      defaultPageValues: [],
      defaultPageIcons: [],
      NEW_TAB_POSITION_VALUES: [],
      TAB_CLOSE_FOCUS_VALUES: [],
      STARTUP_BEHAVIOR_VALUES: [],
    }
    for (const key of keys) {
      bindings[key] = ''
      bindings[`${key}Names`] = []
      bindings[`update${key[0].toUpperCase()}${key.slice(1)}`] = () => {}
    }
    const app = createSSRApp({ render, setup: () => bindings })
    const control = { inheritAttrs: false, setup: (_props, { attrs }) => () => h('select', { 'data-setting': attrs['setting-key'] }) }
    const container = { setup: (_props, { slots }) => () => h('div', slots.default?.({})) }
    app.component('FtSelect', control)
    app.component('FtToggleSwitch', control)
    app.component('FtSettingsSection', container)
    app.component('FtSettingsRow', container)
    const html = await renderToString(app)
    for (const key of keys) {
      assert.equal(html.includes(`data-setting="${key}"`), key === 'landingPage' || USING_ELECTRON || IS_CAPACITOR, key)
    }
  })
}

test('mobile startup waits for saved settings before restoring tabs', async () => {
  const app = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = app.indexOf('  let tabsReady = Promise.resolve()')
  const initialization = app.slice(start, app.indexOf('  const customThemesReady =', start))
  let finishSettings
  const settingsReady = new Promise(resolve => { finishSettings = resolve })
  let restored = false
  const connectivityChoices = []
  const { tabsReady } = vm.runInNewContext(`${initialization}; ({ tabsReady })`, {
    isElectron: false,
    isCapacitor: true,
    isAndroid: true,
    handleRestoredAndroidAppData: async () => {},
    enableCapacitorIntegrations: async () => () => {},
    pageSwipe: { value: null },
    organizerSwipeActive: { value: false },
    computed,
    supportsYtDlp: true,
    route: {},
    ytDlp: { addYtDlpBinaryUpdatedListener: () => {} },
    invalidateAllYtDlpPlaybackSources: () => {},
    store: {
      dispatch: () => settingsReady,
      getters: { getInternetConnectivityChecks: false },
      watch(getter, callback) { callback(getter()); return () => {} },
    },
    initializeNetworkRecovery: () => ({ setInternetChecksEnabled: value => connectivityChoices.push(value) }),
    initializeCapacitorYtDlp: () => {},
    initializeCapacitorTabPreviews: () => {},
    initializeCapacitorTabAvatars: () => {},
    capacitorTabService: { initialize: async () => { restored = true } },
    getWebViewHeapStatistics: () => null,
  })
  await Promise.resolve()
  assert.equal(restored, false)
  assert.deepEqual(connectivityChoices, [])
  finishSettings({})
  await tabsReady
  assert.equal(restored, true)
  assert.deepEqual(connectivityChoices, [false])
})

const privacySource = await readFile(new URL('../../src/renderer/components/Settings/Privacy/PrivacySettings.vue', import.meta.url), 'utf8')
const historyToggle = [...privacySource.matchAll(/<FtToggleSwitch\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .find(template => template.includes('setting-key="rememberTabNavigationHistory"'))
assert.ok(historyToggle)
for (const [platform, USING_ELECTRON, IS_CAPACITOR] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} exposes navigation history persistence only with logical tabs`, async () => {
    const app = createSSRApp({
      render: compile(historyToggle),
      setup: () => ({ USING_ELECTRON, IS_CAPACITOR, rememberTabNavigationHistory: false, updateRememberTabNavigationHistory: () => {} }),
    })
    app.config.globalProperties.$t = key => key
    app.component('FtToggleSwitch', {
      inheritAttrs: false,
      setup: (_props, { attrs }) => () => h('button', { 'data-setting': attrs['setting-key'] }),
    })
    const html = await renderToString(app)
    assert.equal(html.includes('data-setting="rememberTabNavigationHistory"'), USING_ELECTRON || IS_CAPACITOR)
  })
}
