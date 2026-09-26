import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { initializeApplicationData } from '../../src/renderer/helpers/appDataInitialization.js'

const source = await readFile(new URL('../../src/renderer/components/GeneralSettings/GeneralSettings.vue', import.meta.url), 'utf8')
const keys = ['landingPage', 'newTabPosition', 'tabCloseFocus', 'startupBehavior']
const selects = [...source.matchAll(/<FtSelect\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .filter(template => keys.some(key => template.includes(`setting-key="${key}"`)))
assert.equal(selects.length, keys.length)
const render = compile(`<div>${selects.join('\n')}</div>`)

for (const [platform, USING_ELECTRON, IS_CAPACITOR] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} renders the general tab settings supported by its tab system`, async () => {
    const bindings = {
      mode: 'general', USING_ELECTRON, IS_CAPACITOR, t: key => key,
      defaultPageNames: [], defaultPageValues: [],
      NEW_TAB_POSITION_VALUES: [], TAB_CLOSE_FOCUS_VALUES: [], STARTUP_BEHAVIOR_VALUES: [],
    }
    for (const key of keys) {
      bindings[key] = ''
      bindings[`${key}Names`] = []
      bindings[`update${key[0].toUpperCase()}${key.slice(1)}`] = () => {}
    }
    const app = createSSRApp({ render, setup: () => bindings })
    app.component('FtSelect', {
      inheritAttrs: false,
      setup: (_props, { attrs }) => () => h('select', { 'data-setting': attrs['setting-key'] }),
    })
    const html = await renderToString(app)
    for (const key of keys) {
      assert.equal(html.includes(`data-setting="${key}"`), key === 'landingPage' || USING_ELECTRON || IS_CAPACITOR, key)
    }
  })
}

test('mobile startup waits for saved settings before restoring tabs', async () => {
  let finishSettings
  const settingsReady = new Promise(resolve => { finishSettings = resolve })
  let restored = false
  const connectivityChoices = []
  const { startupReady } = initializeApplicationData({
    store: {
      dispatch: action => action === 'grabUserSettings' ? settingsReady : Promise.resolve({}),
    },
    loadTabs: ready => ready.then(() => { restored = true }),
    afterSettings: async () => { connectivityChoices.push(false) },
    loadThemes: async () => [],
    preloadInitialRoute: async () => {},
    allChannelsLabel: 'All Channels',
  })
  await Promise.resolve()
  assert.equal(restored, false)
  assert.deepEqual(connectivityChoices, [])
  finishSettings({})
  await startupReady
  assert.equal(restored, true)
  assert.deepEqual(connectivityChoices, [false])
})

const privacySource = await readFile(new URL('../../src/renderer/components/PrivacySettings.vue', import.meta.url), 'utf8')
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
