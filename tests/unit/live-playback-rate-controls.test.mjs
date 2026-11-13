import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { getDefaultPlayerMenuControls } from '../../src/renderer/helpers/playerMenuControls.js'
import { DEFAULT_CONTROL_BAR_BUTTONS, getControlBarButtonDefinitions, getRemovedControlBarButtons } from '../../src/renderer/helpers/controlBarButtons.js'

const source = readFileSync(new URL('../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', import.meta.url), 'utf8')
function computedSource(name) {
  const start = source.indexOf(`const ${name} = computed(() => {`)
  assert.notEqual(start, -1)
  return source.slice(start, source.indexOf('\n})', start) + '\n})'.length)
}

function controls(props, overflow = false, quickBar = true, playerIsLive = props.isLive) {
  const state = {
    computed: getter => ({ get value() { return getter() } }),
    props: { captions: [], chapters: [], format: 'dash', playbackEngine: 'yt-dlp', manifestMimeType: 'application/dash+xml', ...props },
    process: { env: {} },
    isLive: { value: playerIsLive },
    localCaptions: { value: [] },
    onlyUseOverFlowMenu: { value: overflow },
    useQuickPlaybackSpeedBar: { value: quickBar },
    isCapacitorMobilePlayer: () => false,
    store: { getters: { getControlBarButtons: DEFAULT_CONTROL_BAR_BUTTONS, getHiddenPlayerMenuControls: [], getPlayerMenuControls: getDefaultPlayerMenuControls(false) } },
    DEFAULT_CONTROL_BAR_BUTTONS,
    getControlBarButtonDefinitions,
    getRemovedControlBarButtons,
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
    'showLightsOffToggle', 'showMonoAudioToggle', 'showMusicModeToggle', 'showSkipSilenceButton',
    'voiceOverTranslationAvailable', 'disableAbRepeat', 'seekHistoryAvailable',
  ]) state[name] = { value: false }
  return vm.runInNewContext(`${computedSource('seekingIsPossible')}\n${computedSource('uiConfig')}\nuiConfig.value`, state)
}

for (const [label, props, expected, overflow] of [
  ['DVR livestream or premiere', { isLive: true, isLiveDvrEnabled: true }, true, false],
  ['DVR livestream or premiere', { isLive: true, isLiveDvrEnabled: true }, true, true],
  ['HLS DVR without metadata', { isLive: true, manifestMimeType: 'application/x-mpegurl', manifestSrc: 'https://example.com/playlist_type/DVR/live.m3u8' }, true, false],
  ['live DASH without DVR metadata', { isLive: true }, false, false],
]) {
  test(`${label}: playback speed controls with overflow=${overflow}`, () => {
    const config = controls(props, overflow)
    assert.equal(config.overflowMenuButtons.includes('playback_rate'), expected)
    assert.equal(config.controlPanelElements.includes('ft_quick_playback_rate_bar'), expected && !overflow)
  })
}

test('Shaka-detected live playback without live metadata hides speed controls with overflow=false', () => {
  const config = controls({
    isLive: false,
    manifestMimeType: 'application/x-mpegurl',
    manifestSrc: 'https://example.com/live.m3u8',
  }, false, true, true)
  assert.equal(config.overflowMenuButtons.includes('playback_rate'), false)
  assert.equal(config.controlPanelElements.includes('ft_quick_playback_rate_bar'), false)
})
