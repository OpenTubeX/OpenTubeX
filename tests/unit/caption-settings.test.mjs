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

test('scales captions with the player, so they cover the same share of it in every size', () => {
  // a 960x540 player shows Shaka's size
  assert.equal(getCaptionPlayerScale(540), 1)

  // a larger watch page player and fullscreen grow them in proportion
  assert.equal(getCaptionPlayerScale(720), 720 / 540)
  assert.equal(getCaptionPlayerScale(1080), 2)

  // the scroll mini player (360x202 by default) shrinks them
  assert.equal(getCaptionPlayerScale(270), 0.5)
})

test('keeps captions legible in tiny players', () => {
  assert.equal(getCaptionPlayerScale(202), 0.5)
  assert.equal(getCaptionPlayerScale(135), 0.5)
})

test('falls back to the configured size when the player has not been measured yet', () => {
  assert.equal(getCaptionPlayerScale(0), 1)
  assert.equal(getCaptionPlayerScale(Number.NaN), 1)
  assert.equal(getCaptionPlayerScale(undefined), 1)
})

test('sizes captions relative to the player', () => {
  assert.equal(getCaptionPlayerVariables(540, 1)['--caption-font-size'], '20px')
  assert.equal(getCaptionPlayerVariables(1080, 1)['--caption-font-size'], '40px')
  assert.equal(getCaptionPlayerVariables(1080, 1.35)['--caption-font-size'], '40px')
})

test('caps the scaled font size at a share of the player height', () => {
  // 400% would take up 15% of the player per line, so it is limited to 10%
  assert.equal(getCaptionPlayerVariables(540, 4)['--caption-font-size'], '13.5px')
  assert.equal(getCaptionPlayerVariables(1080, 4)['--caption-font-size'], '27px')

  // in the mini player, the floor that keeps the default size legible makes 400% too large as well
  assert.equal(getCaptionPlayerVariables(202, 4)['--caption-font-size'], '5px')
  assert.equal(getCaptionPlayerVariables(202, 1)['--caption-font-size'], '10px')
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

  // 80% was only the default opacity of the default background
  assert.equal(parseCaptionSettings({ backgroundColor: '#3f51b5', backgroundOpacity: 0.8 }).backgroundOpacity, 0.8)
  assert.equal(parseCaptionSettings({ backgroundColor: '#000000', backgroundOpacity: 0.8 }).backgroundOpacity, null)

  // Font sizes between the presets are kept, snapped to the 5% steps of the slider
  assert.equal(parseCaptionSettings({ fontScale: 1.3 }).fontScaleFactor, 1.3)
  assert.equal(parseCaptionSettings({ fontScaleFactor: 1.35 }).fontScaleFactor, 1.35)
  assert.equal(parseCaptionSettings({ fontScaleFactor: 1.33 }).fontScaleFactor, 1.35)
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
  assert.deepEqual(getSecondaryCaptionPosition('BOTTOM_CENTER'), { atTop: true, align: 'center', alignItems: 'center' })
  assert.deepEqual(getSecondaryCaptionPosition('DEFAULT'), { atTop: true, align: 'center', alignItems: 'center' })
  assert.deepEqual(getSecondaryCaptionPosition('CENTER_RIGHT'), { atTop: true, align: 'right', alignItems: 'flex-end' })
  assert.deepEqual(getSecondaryCaptionPosition('TOP_LEFT'), { atTop: false, align: 'left', alignItems: 'flex-start' })
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
