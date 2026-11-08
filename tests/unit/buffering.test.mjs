import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUFFER_PRESETS,
  BUFFER_SETTING_RANGES,
  findBufferPreset,
  getBufferingConfig
} from '../../src/renderer/helpers/player/buffering.js'
import { createDefaultSettings } from '../../src/settingsDefaults.js'

test('the default settings keep the previous shaka-player configuration', () => {
  const settings = createDefaultSettings({ supportsLocalApi: true, isElectron: true })

  assert.equal(findBufferPreset(settings), 'default')
  assert.deepEqual(getBufferingConfig(settings), {
    bufferingGoal: 180,
    bufferBehind: 300,
    rebufferingGoal: 0.02
  })
})

test('presets are recognized from their values', () => {
  for (const [name, values] of Object.entries(BUFFER_PRESETS)) {
    assert.equal(findBufferPreset(values), name)
  }

  assert.equal(findBufferPreset({ ...BUFFER_PRESETS.default, bufferAhead: 60 }), 'custom')
})

test('presets fit the slider ranges', () => {
  for (const values of Object.values(BUFFER_PRESETS)) {
    for (const [key, { min, max, step }] of Object.entries(BUFFER_SETTING_RANGES)) {
      assert.ok(values[key] >= min && values[key] <= max, `${key} is in range`)
      assert.equal((values[key] - min) % step, 0, `${key} is on a slider step`)
    }
  }
})

test('the buffering goal can never be lower than the rebuffering goal', () => {
  // shaka-player rejects configurations where it is
  assert.ok(BUFFER_SETTING_RANGES.bufferAhead.min >= BUFFER_SETTING_RANGES.bufferBeforePlaying.max)
})

test('playback that resumes right away keeps shaka-player\'s buffering detection on', () => {
  const config = getBufferingConfig({ ...BUFFER_PRESETS.default, bufferBeforePlaying: 0 })
  assert.ok(config.rebufferingGoal > 0)

  assert.equal(getBufferingConfig({ ...BUFFER_PRESETS.default, bufferBeforePlaying: 5 }).rebufferingGoal, 5)
})

test('progressive files start playing as soon as the browser can play them', () => {
  assert.deepEqual(getBufferingConfig(BUFFER_PRESETS.smooth, true), {
    bufferingGoal: BUFFER_PRESETS.smooth.bufferAhead,
    bufferBehind: BUFFER_PRESETS.smooth.bufferBehind,
    rebufferingGoal: getBufferingConfig(BUFFER_PRESETS.default).rebufferingGoal
  })
})

test('out of range and unusable values are corrected', () => {
  assert.deepEqual(getBufferingConfig({ bufferAhead: 5000, bufferBehind: -1, bufferBeforePlaying: 50 }), {
    bufferingGoal: BUFFER_SETTING_RANGES.bufferAhead.max,
    bufferBehind: BUFFER_SETTING_RANGES.bufferBehind.min,
    rebufferingGoal: BUFFER_SETTING_RANGES.bufferBeforePlaying.max
  })

  assert.deepEqual(getBufferingConfig({ bufferAhead: NaN, bufferBehind: undefined, bufferBeforePlaying: Infinity }), {
    bufferingGoal: 180,
    bufferBehind: 300,
    rebufferingGoal: 0.02
  })
})
