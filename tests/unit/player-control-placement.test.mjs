import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { DEFAULT_CONTROL_BAR_BUTTONS, getControlBarButtonDefinitions, getRemovedControlBarButtons } from '../../src/renderer/helpers/controlBarButtons.js'
import { getDefaultPlayerMenuControls, withoutControlBarButtons } from '../../src/renderer/helpers/playerMenuControls.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
function computedSource(name) {
  const start = source.indexOf(`    const ${name} = computed(() => {`)
  assert.notEqual(start, -1)
  return source.slice(start, source.indexOf('\n    })', start) + '\n    })'.length)
}

function controls({ props = {}, overflow = false, controlBarButtons = DEFAULT_CONTROL_BAR_BUTTONS, hidden = [], menuOrder = getDefaultPlayerMenuControls(false), screenshot = false, mobile = false } = {}) {
  const state = {
    computed: getter => ({ get value() { return getter() } }),
    props: { captions: [], chapters: [], format: 'dash', autoplayPossible: true, theatrePossible: true, playbackEngine: 'yt-dlp', manifestMimeType: 'application/dash+xml', ...props },
    process: { env: {} },
    isLive: { value: Boolean(props.isLive) },
    localCaptions: { value: [] },
    onlyUseOverFlowMenu: { value: overflow },
    useQuickPlaybackSpeedBar: { value: false },
    isCapacitorMobilePlayer: () => mobile,
    store: { getters: { getControlBarButtons: controlBarButtons, getHiddenPlayerMenuControls: withoutControlBarButtons(hidden, controlBarButtons), getPlayerMenuControls: menuOrder } },
    DEFAULT_CONTROL_BAR_BUTTONS,
    getControlBarButtonDefinitions,
    getRemovedControlBarButtons,
    getBigButtons: () => [],
    TrackLabelFormat: {},
    CAPTION_FONT_SCALE_FACTORS: [],
    volumeBoostPossible: false,
    removeFromArrayIfExists(array, item) {
      const index = array.indexOf(item)
      if (index !== -1) array.splice(index, 1)
    },
  }
  for (const name of [
    'displayVideoPlayButton', 'contextMenuElements', 'hasMultipleAudioTracks', 'useVrMode',
    'enableScreenshot', 'useSponsorBlock', 'audioPlayerMode', 'videoZoomPossible',
    'showLightsOffToggle', 'showMonoAudioToggle', 'showMusicModeToggle', 'showSkipSilenceButton',
    'voiceOverTranslationAvailable', 'disableAbRepeat', 'seekHistoryAvailable',
  ]) state[name] = { value: false }
  state.enableScreenshot = { value: screenshot }
  return vm.runInNewContext(`${computedSource('seekingIsPossible')}\n${computedSource('uiConfig')}\nuiConfig.value`, state)
}

const BAR_WITH_MENU_CONTROLS = ['quality', 'playbackRate', 'audioTracks', 'loop', ...DEFAULT_CONTROL_BAR_BUTTONS]

test('menu controls on the control bar leave the menu', () => {
  const config = controls({ controlBarButtons: BAR_WITH_MENU_CONTROLS })
  const bar = config.controlPanelElements
  assert.deepEqual([...bar.slice(bar.indexOf('quality'), bar.indexOf('quality') + 4)], ['quality', 'playback_rate', 'ft_audio_tracks', 'ft_loop'])
  for (const element of ['quality', 'playback_rate', 'ft_audio_tracks', 'ft_loop']) {
    assert.equal(config.overflowMenuButtons.includes(element), false, element)
  }
  assert.ok(controls().overflowMenuButtons.includes('ft_loop'))
})

test('the compact layout keeps control bar buttons in the menu', () => {
  const config = controls({ overflow: true, controlBarButtons: BAR_WITH_MENU_CONTROLS, hidden: ['quality', 'loop'] })
  for (const element of ['quality', 'playback_rate', 'ft_audio_tracks', 'ft_loop']) {
    assert.ok(config.overflowMenuButtons.includes(element), element)
    assert.equal(config.controlPanelElements.includes(element), false, element)
  }
})

test('the legacy format puts its own quality control on the control bar', () => {
  const config = controls({ props: { format: 'legacy' }, controlBarButtons: BAR_WITH_MENU_CONTROLS })
  assert.ok(config.controlPanelElements.includes('ft_legacy_quality'))
  assert.equal(config.overflowMenuButtons.includes('ft_legacy_quality'), false)
})

test('livestreams leave speed and loop off the control bar', () => {
  const config = controls({ props: { isLive: true }, controlBarButtons: BAR_WITH_MENU_CONTROLS })
  assert.equal(config.controlPanelElements.includes('playback_rate'), false)
  assert.equal(config.controlPanelElements.includes('ft_loop'), false)
})

for (const overflow of [false, true]) {
  test(`hidden controls leave the player with overflow=${overflow}`, () => {
    const config = controls({
      overflow,
      controlBarButtons: ['menu', 'fullscreen'],
      hidden: ['quality', 'playbackRate', 'captions', 'audioTracks', 'sleepTimer', 'autoplay', 'chapters', 'ambientMode', 'loop', 'pictureInPicture', 'theatreMode', 'fullWindow'],
    })
    const elements = [...config.overflowMenuButtons, ...config.controlPanelElements]
    for (const element of [
      'quality', 'playback_rate', 'captions', 'ft_caption_toggle', 'ft_audio_tracks', 'ft_sleep_timer', 'ft_autoplay_toggle', 'ft_chapters',
      'ft_ambient_mode', 'ft_loop', 'picture_in_picture', 'ft_theatre_mode', 'ft_full_window',
    ]) {
      assert.equal(elements.includes(element), false, element)
    }
  })

  test(`the player menu follows the custom order with overflow=${overflow}`, () => {
    const defaults = getDefaultPlayerMenuControls(false)
    const config = controls({ overflow, menuOrder: ['ambientMode', 'sleepTimer', ...defaults.filter(id => id !== 'ambientMode' && id !== 'sleepTimer')] })
    assert.deepEqual([...config.overflowMenuButtons.slice(0, 2)], ['ft_ambient_mode', 'ft_sleep_timer'])
  })
}

test('the caption toggle on the control bar keeps the caption menu', () => {
  const config = controls({ hidden: ['captions'] })
  assert.ok(config.controlPanelElements.includes('ft_caption_toggle'))
  assert.ok(config.overflowMenuButtons.includes('captions'))
})

test('controls on the control bar cannot be hidden', () => {
  const config = controls({ overflow: true, hidden: ['pictureInPicture', 'autoplay'] })
  assert.ok(config.overflowMenuButtons.includes('picture_in_picture'))
  assert.ok(config.overflowMenuButtons.includes('ft_autoplay_toggle'))
})

test('the screenshot button follows its placement while screenshots are enabled', () => {
  const onBar = controls({ screenshot: true })
  assert.equal(onBar.controlPanelElements.indexOf('ft_screenshot'), onBar.controlPanelElements.indexOf('ft_autoplay_toggle') - 1)
  assert.equal(onBar.overflowMenuButtons.includes('ft_screenshot'), false)

  const inMenu = controls({ screenshot: true, controlBarButtons: ['captions', 'menu', 'fullscreen'] })
  assert.equal(inMenu.controlPanelElements.includes('ft_screenshot'), false)
  assert.ok(inMenu.overflowMenuButtons.includes('ft_screenshot'))

  for (const overflow of [false, true]) {
    const disabled = controls({ overflow })
    assert.equal([...disabled.controlPanelElements, ...disabled.overflowMenuButtons].includes('ft_screenshot'), false)
  }
})

test('the chapters button sits next to the time on the control bar and joins the menu otherwise', () => {
  const onBar = controls()
  assert.ok(onBar.controlPanelElements.indexOf('ft_chapters') < onBar.controlPanelElements.indexOf('spacer'))
  assert.equal(onBar.overflowMenuButtons.includes('ft_chapters'), false)

  const menuOrder = ['chapters', ...getDefaultPlayerMenuControls(false).filter(id => id !== 'chapters')]
  const inMenu = controls({ controlBarButtons: DEFAULT_CONTROL_BAR_BUTTONS.filter(id => id !== 'chapters'), menuOrder })
  assert.equal(inMenu.controlPanelElements.includes('ft_chapters'), false)
  assert.equal(inMenu.overflowMenuButtons[0], 'ft_chapters')

  // The compact controls only show it in the menu.
  const compact = controls({ overflow: true })
  assert.equal(compact.controlPanelElements.includes('ft_chapters'), false)
  assert.ok(compact.overflowMenuButtons.includes('ft_chapters'))
})

test('the compact controls of phones keep their control bar buttons out of the menu', () => {
  const config = controls({ mobile: true, overflow: true, controlBarButtons: ['chapters', 'captions', 'pictureInPicture', 'menu', 'fullscreen'] })
  assert.ok(config.controlPanelElements.includes('ft_chapters'))
  assert.ok(config.controlPanelElements.includes('picture_in_picture'))
  assert.equal(config.overflowMenuButtons.includes('ft_chapters'), false)
  assert.equal(config.overflowMenuButtons.includes('picture_in_picture'), false)
  // The caption toggle keeps the caption menu.
  assert.ok(config.overflowMenuButtons.includes('captions'))

  const removed = controls({ mobile: true, overflow: true, controlBarButtons: ['captions', 'menu', 'fullscreen'] })
  assert.ok(removed.overflowMenuButtons.includes('ft_chapters'))
  assert.ok(removed.overflowMenuButtons.includes('picture_in_picture'))
})
