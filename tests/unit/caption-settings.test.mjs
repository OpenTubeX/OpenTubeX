import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CAPTION_SETTINGS,
  getCaptionPlayerScale,
  getCaptionPlayerVariables,
  getCaptionStyle,
  getSecondaryCaptionPosition,
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

test('caps the scaled font size at a share of the player height', () => {
  // a regular player has room for the configured size, even at the maximum
  assert.equal(getCaptionPlayerVariables(562, 1)['--caption-font-size'], '20px')
  assert.equal(getCaptionPlayerVariables(562, 2)['--caption-font-size'], '20px')
  assert.equal(getCaptionPlayerVariables(562, 4)['--caption-font-size'], '14px')

  // 400% would be 40px in a mini player that is only 202px tall, so it is limited to 20px
  assert.equal(getCaptionPlayerVariables(202, 4)['--caption-font-size'], '5px')
  assert.equal(getCaptionPlayerVariables(202, 1)['--caption-font-size'], '10.1px')
})

test('leaves the font size uncapped until the player has been measured', () => {
  assert.deepEqual(getCaptionPlayerVariables(0, 4), { '--caption-font-size': '20px' })
})

test('defaults to Shaka\'s style with the captions at the bottom center', () => {
  assert.deepEqual(parseCaptionSettings('{}'), DEFAULT_CAPTION_SETTINGS)
  assert.deepEqual(parseCaptionSettings('not json'), DEFAULT_CAPTION_SETTINGS)
  assert.equal(DEFAULT_CAPTION_SETTINGS.positionArea, 'BOTTOM_CENTER')
})

test('keeps the options of Shaka\'s captions style', () => {
  const settings = {
    fontFamily: 'MONOSPACED_SERIF',
    fontColor: '#ff0',
    fontOpacity: 0.5,
    fontScaleFactor: 1.5,
    backgroundColor: '#080808',
    backgroundOpacity: 0,
    characterEdgeStyle: 'RAISED',
    positionArea: 'CENTER_LEFT',
  }
  assert.deepEqual(parseCaptionSettings(JSON.stringify(settings)), settings)

  // Choosing the defaults keeps them, including the source positions of the cues
  assert.deepEqual(parseCaptionSettings({ ...DEFAULT_CAPTION_SETTINGS, positionArea: 'DEFAULT' }), {
    ...DEFAULT_CAPTION_SETTINGS,
    positionArea: 'DEFAULT',
  })
})

test('reads the settings saved before Shaka\'s style options', () => {
  // The previous defaults become the new ones
  assert.deepEqual(parseCaptionSettings({
    textColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0.8,
    fontScale: 1,
    verticalPosition: 0,
    anchor: 'bottom-center',
    edgeStyle: 'none',
    edgeColor: '#000000',
  }), DEFAULT_CAPTION_SETTINGS)

  assert.deepEqual(parseCaptionSettings({
    textColor: '#FFFF00',
    backgroundColor: '#3f51b5',
    backgroundOpacity: 0.5,
    fontScale: 4,
    verticalPosition: 0.2,
    anchor: 'top-right',
    edgeStyle: 'dropShadow',
    edgeColor: '#ffffff',
  }), {
    ...DEFAULT_CAPTION_SETTINGS,
    // Shortened to the colors of Shaka's palette, other colors are kept
    fontColor: '#ff0',
    backgroundColor: '#3f51b5',
    backgroundOpacity: 0.5,
    fontScaleFactor: 4,
    characterEdgeStyle: 'DROP_SHADOW',
    positionArea: 'TOP_RIGHT',
  })

  // A font size between Shaka's sizes snaps to the closest one
  assert.equal(parseCaptionSettings({ fontScale: 1.3 }).fontScaleFactor, 1.25)
  assert.equal(parseCaptionSettings({ fontScale: 10 }).fontScaleFactor, 4)
  assert.equal(parseCaptionSettings({ fontScale: 0 }).fontScaleFactor, 0.5)
})

test('reads the caption settings of the legacy Video.js player', () => {
  const settings = parseCaptionSettings({ color: '#0f0', fontPercent: 1.5, edgeStyle: 'uniform' })
  assert.equal(settings.fontColor, '#0f0')
  assert.equal(settings.fontScaleFactor, 1.5)
  assert.equal(settings.characterEdgeStyle, 'OUTLINE')
})

test('drops unknown options', () => {
  assert.deepEqual(parseCaptionSettings({
    fontFamily: 'Comic Sans',
    fontColor: 'red',
    fontOpacity: 'x',
    characterEdgeStyle: 7,
    positionArea: 'MIDDLE',
  }), DEFAULT_CAPTION_SETTINGS)
})

test('places the secondary captions at the opposite edge', () => {
  assert.deepEqual(getSecondaryCaptionPosition('BOTTOM_CENTER'), { atTop: true, align: 'center' })
  assert.deepEqual(getSecondaryCaptionPosition('DEFAULT'), { atTop: true, align: 'center' })
  assert.deepEqual(getSecondaryCaptionPosition('CENTER_RIGHT'), { atTop: true, align: 'right' })
  assert.deepEqual(getSecondaryCaptionPosition('TOP_LEFT'), { atTop: false, align: 'left' })
})

test('styles the captions Shaka does not render like Shaka', () => {
  const style = getCaptionStyle(DEFAULT_CAPTION_SETTINGS)
  assert.equal(style.background, 'rgb(0 0 0 / 0.8)')
  assert.equal(style.text.color, 'rgb(255 255 255 / 1)')
  assert.equal(style.text.textShadow, 'none')
  assert.equal(style.text.fontFamily, 'inherit')

  const custom = getCaptionStyle({
    ...DEFAULT_CAPTION_SETTINGS,
    fontColor: '#ff0',
    fontOpacity: 0.5,
    backgroundColor: '#00f',
    characterEdgeStyle: 'OUTLINE',
    fontScaleFactor: 2,
  })
  // A background color without an opacity is opaque, like in Shaka
  assert.equal(custom.background, 'rgb(0 0 255 / 1)')
  assert.equal(custom.text.color, 'rgb(255 255 0 / 0.5)')
  assert.match(custom.text.textShadow, /rgb\(34 34 34 \/ 0\.5\)/)
  assert.equal(custom.text.fontSize, 'calc(var(--caption-font-size, 20px) * 2)')

  assert.equal(getCaptionStyle({ ...DEFAULT_CAPTION_SETTINGS, backgroundOpacity: 0.25 }).background, 'rgb(0 0 0 / 0.25)')
})
