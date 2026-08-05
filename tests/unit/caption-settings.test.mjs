import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCaptionPlayerScale,
  getCaptionPlayerVariables,
  MAX_CAPTION_FONT_SCALE,
  MIN_CAPTION_FONT_SCALE,
  parseCaptionSettings,
} from '../../src/renderer/helpers/player/caption-settings.js'

test('keeps captions at their configured size in regular and fullscreen players', () => {
  // regular watch page player
  assert.equal(getCaptionPlayerScale(562), 1)

  // fullscreen must not blow the captions up
  assert.equal(getCaptionPlayerScale(1080), 1)
})

test('shrinks captions in small players', () => {
  // half the reference height means half sized captions
  assert.equal(getCaptionPlayerScale(200), 0.5)

  // the scroll mini player (360x202 by default)
  assert.equal(getCaptionPlayerScale(202), 0.505)

  // the smallest possible mini player is below the floor, which keeps captions legible
  assert.equal(getCaptionPlayerScale(135), 0.45)
})

test('falls back to the configured size when the player has not been measured yet', () => {
  assert.equal(getCaptionPlayerScale(0), 1)
  assert.equal(getCaptionPlayerScale(Number.NaN), 1)
  assert.equal(getCaptionPlayerScale(undefined), 1)
})

test('clamps the font size to the range the settings offer', () => {
  assert.equal(parseCaptionSettings({ fontScale: 10 }).fontScale, MAX_CAPTION_FONT_SCALE)
  assert.equal(parseCaptionSettings({ fontScale: 0 }).fontScale, MIN_CAPTION_FONT_SCALE)

  // the maximum was raised from 200%, previously saved settings are unaffected
  assert.equal(parseCaptionSettings({ fontScale: 2 }).fontScale, 2)
  assert.equal(parseCaptionSettings({ fontScale: 4 }).fontScale, 4)
})

test('caps the font size at a share of the player height', () => {
  // a regular player has room for the configured size, even at the maximum
  assert.equal(getCaptionPlayerVariables(562)['--caption-max-font-size'], '56px')

  // 400% would be 40px in a mini player that is only 202px tall
  assert.equal(getCaptionPlayerVariables(202)['--caption-max-font-size'], '20px')
})

test('leaves the font size uncapped until the player has been measured', () => {
  assert.equal(getCaptionPlayerVariables(0)['--caption-max-font-size'], undefined)
  assert.deepEqual(getCaptionPlayerVariables(0), { '--caption-player-scale': '1' })
})
