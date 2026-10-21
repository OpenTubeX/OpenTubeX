import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { DEFAULT_CONTROL_BAR_BUTTONS, getControlBarButtonDefinitions } from '../../src/renderer/helpers/controlBarButtons.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
function computedSource(name) {
  const start = source.indexOf(`    const ${name} = computed(() => {`)
  assert.notEqual(start, -1)
  return source.slice(start, source.indexOf('\n    })', start) + '\n    })'.length)
}

function controls(props, overflow = false, quickBar = true, playerIsLive = props.isLive) {
  const state = {
    computed: getter => ({ get value() { return getter() } }),
    props: { captions: [], chapters: [], format: 'dash', playbackEngine: 'yt-dlp', manifestMimeType: 'application/dash+xml', ...props },
    process: { env: {} },
    isLive: { value: playerIsLive },
    onlyUseOverFlowMenu: { value: overflow },
    useQuickPlaybackSpeedBar: { value: quickBar },
    isCapacitorMobilePlayer: () => false,
    store: { getters: { getControlBarButtons: DEFAULT_CONTROL_BAR_BUTTONS } },
    DEFAULT_CONTROL_BAR_BUTTONS,
    getControlBarButtonDefinitions,
    getBigButtons: () => [],
    TrackLabelFormat: {},
    volumeBoostPossible: false,
    removeFromArrayIfExists(array, item) {
      const index = array.indexOf(item)
      if (index !== -1) array.splice(index, 1)
    },
  }
  for (const name of [
    'displayVideoPlayButton', 'contextMenuElements', 'hasMultipleAudioTracks', 'useVrMode',
    'enableScreenshot', 'useSponsorBlock', 'audioPlayerMode', 'videoZoomPossible',
    'showLightsOffToggle', 'showMusicModeToggle', 'showSkipSilenceButton',
    'voiceOverTranslationAvailable', 'disableAbRepeat', 'seekHistoryAvailable',
  ]) state[name] = { value: false }
  return vm.runInNewContext(`${computedSource('seekingIsPossible')}\n${computedSource('uiConfig')}\nuiConfig.value`, state)
}

for (const overflow of [false, true]) {
  for (const [label, props, expected] of [
    ['DVR livestream or premiere', { isLive: true, isLiveDvrEnabled: true }, true],
    ['HLS DVR without metadata', { isLive: true, manifestMimeType: 'application/x-mpegurl', manifestSrc: 'https://example.com/playlist_type/DVR/live.m3u8' }, true],
    ['live DASH without DVR metadata', { isLive: true }, false],
    ['live DASH with unknown DVR metadata', { isLive: true, isLiveDvrEnabled: null }, false],
    ['disabled DVR', { isLive: true, isLiveDvrEnabled: false }, false],
    ['built-in live playback', { isLive: true, playbackEngine: 'built-in', isLiveDvrEnabled: true }, false],
    ['short live window', { isLive: true, manifestMimeType: 'application/x-mpegurl', manifestSrc: 'https://example.com/manifest_duration/30/live.m3u8' }, false],
    ['ordinary video', { isLive: false }, true],
  ]) {
    test(`${label}: playback speed controls with overflow=${overflow}`, () => {
      const config = controls(props, overflow)
      assert.equal(config.overflowMenuButtons.includes('playback_rate'), expected)
      assert.equal(config.controlPanelElements.includes('ft_quick_playback_rate_bar'), expected && !overflow)
    })
  }
}

test('DVR playback respects the disabled quick bar preference', () => {
  const config = controls({ isLive: true, isLiveDvrEnabled: true }, false, false)
  assert.equal(config.overflowMenuButtons.includes('playback_rate'), true)
  assert.equal(config.controlPanelElements.includes('ft_quick_playback_rate_bar'), false)
})

for (const overflow of [false, true]) {
  test(`Shaka-detected live playback without live metadata hides speed controls with overflow=${overflow}`, () => {
    const config = controls({
      isLive: false,
      manifestMimeType: 'application/x-mpegurl',
      manifestSrc: 'https://example.com/live.m3u8',
    }, overflow, true, true)
    assert.equal(config.overflowMenuButtons.includes('playback_rate'), false)
    assert.equal(config.controlPanelElements.includes('ft_quick_playback_rate_bar'), false)
  })
}
