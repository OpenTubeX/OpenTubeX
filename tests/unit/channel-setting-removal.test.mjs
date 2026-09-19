import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const preferences = readFileSync(new URL('../../src/renderer/helpers/channel-preferences.js', import.meta.url), 'utf8')
const preferenceApi = vm.runInNewContext(
  preferences.slice(preferences.indexOf('export const CHANNEL_PREFERENCE_TYPES'), preferences.indexOf('/**\n * @typedef {{ name:'))
    .replaceAll('export ', '') + '\n({ removeChannelPreference, CHANNEL_PREFERENCE_TYPES })'
)

test('removes each channel override, including false and zero, while preserving other channels', async () => {
  for (const [index, { type, valuesKey }] of preferenceApi.CHANNEL_PREFERENCE_TYPES.entries()) {
    const suffix = valuesKey[0].toUpperCase() + valuesKey.slice(1)
    const saved = JSON.stringify({ current: [1.5, '720', false, 0][index], other: 1 })
    const calls = []
    const store = {
      getters: { [`get${suffix}`]: saved },
      dispatch: async (...args) => calls.push(args)
    }
    await preferenceApi.removeChannelPreference(store, 'current', type)
    assert.deepEqual(calls, [[`update${suffix}`, '{"other":1}']])
    assert.equal(store.getters[`get${suffix}`], saved)
    await preferenceApi.removeChannelPreference(store, '', type)
    await preferenceApi.removeChannelPreference(store, 'current', 'invalid')
    assert.equal(calls.length, 1)
  }
})

const barSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/player-components/QuickPlaybackRateBar.js', import.meta.url), 'utf8')
const { QuickPlaybackRateBar, setQuickPlaybackRateBarContext } = vm.runInNewContext(
  barSource.slice(barSource.indexOf('const quickPlaybackRateBarContexts')).replaceAll('export ', '') +
    '\n({ QuickPlaybackRateBar, setQuickPlaybackRateBarContext })',
  {
    shaka: { ui: { Element: class {} } },
    i18n: { global: { t: key => key } },
    h: (component, props) => ({ component, props }),
    render() {},
    Fragment: {},
    FtIcon: {}
  }
)

test('quick speed action switches between saving and removal as current and saved rates change', () => {
  let savedRate = 1.5
  let currentRate = 1.5
  const bar = Object.create(QuickPlaybackRateBar.prototype)
  bar.controls = {}
  bar.player = { getPlaybackRate: () => currentRate }
  bar.saveButton_ = { dataset: {}, classList: { add() {}, remove() {} } }
  bar.rateButtons_ = []
  setQuickPlaybackRateBarContext(bar.controls, {
    getSavedChannelPlaybackRate: () => savedRate,
    getCanSaveChannelPlaybackSpeed: () => true
  })
  bar.updateButtonStates_()
  assert.equal(bar.saveButton_.dataset.remove, 'true')
  assert.equal(bar.saveButton_.ariaLabel, 'Settings.Channel Settings.Forget Value')
  currentRate = 2
  bar.updateButtonStates_()
  assert.equal(bar.saveButton_.dataset.remove, 'false')
  assert.equal(bar.saveButton_.ariaLabel, 'Video.Save Channel Playback Speed')
  savedRate = null
  bar.updateButtonStates_()
  assert.equal(bar.saveButton_.dataset.remove, 'false')
})
