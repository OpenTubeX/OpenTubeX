import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref, watch } from 'vue'

import { DEFAULT_CONTROL_BAR_BUTTONS, getControlBarButtonDefinitions } from '../../src/renderer/helpers/controlBarButtons.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start !== -1 && end !== -1, `missing ${startMarker}`)
  return source.slice(start, end)
}

function sliceWatcher(startMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start !== -1, `missing ${startMarker}`)
  return source.slice(start, source.indexOf('\n    })\n', start) + '\n    })'.length)
}

const configureSource = slice('    function getBigButtons(', '    function closeChaptersOverlay() {')
const uiConfigWatcherSource = sliceWatcher('    watch(uiConfig, ')
const loadedWatcherSource = sliceWatcher('    watch(hasLoaded, (loaded) => {')

function setupPlayer({ theatrePossible = true, useSponsorBlock = true } = {}) {
  const configureCalls = []
  const props = reactive({
    chapters: [],
    captions: [{ url: 'https://example.com/en.vtt' }],
    shortsPlayer: false,
    format: 'dash',
    externalUrl: '',
    liveChatAvailable: false,
    theatrePossible,
    autoplayPossible: true,
    canSkipPrevious: false,
    canSkipNext: false,
    playbackEngine: 'built-in',
  })
  const context = vm.createContext({
    props,
    computed,
    watch,
    nextTick,
    process: { env: {} },
    document: { pictureInPictureEnabled: false },
    requestAnimationFrame: callback => callback(),
    shaka: { util: { FakeEvent: class {} } },
    TrackLabelFormat: { LABEL: 'label', LANGUAGE: 'language', LANGUAGE_ROLE: 'language-role' },
    removeFromArrayIfExists(array, element) {
      const index = array.indexOf(element)
      if (index !== -1) array.splice(index, 1)
    },
    isCapacitorMobilePlayer: () => false,
    DEFAULT_CONTROL_BAR_BUTTONS,
    getControlBarButtonDefinitions,
    store: { getters: { getControlBarButtons: DEFAULT_CONTROL_BAR_BUTTONS } },
    isLive: ref(false),
    onlyUseOverFlowMenu: ref(false),
    displayVideoPlayButton: ref(true),
    contextMenuElements: ref(['ft_loop']),
    hasMultipleAudioTracks: ref(false),
    seekingIsPossible: ref(true),
    seekHistoryAvailable: ref(false),
    useVrMode: ref(false),
    useQuickPlaybackSpeedBar: ref(false),
    enableScreenshot: ref(false),
    useSponsorBlock: ref(useSponsorBlock),
    audioPlayerMode: ref(false),
    videoZoomPossible: ref(false),
    volumeBoostPossible: true,
    showLightsOffToggle: ref(false),
    showMusicModeToggle: ref(false),
    showSkipSilenceButton: ref(false),
    voiceOverTranslationAvailable: ref(false),
    disableAbRepeat: ref(false),
    fullscreenOnRotationEnabled: ref(false),
    androidFullscreenHost: null,
    container: ref({ querySelector: () => null }),
    playbackRates: ref([1]),
    defaultSkipInterval: ref(5),
    video: ref({ muted: false, volume: 1 }),
    hasLoaded: ref(false),
    pendingUiReconfigure: false,
    appliedUiConfigKey: '',
    configuringCustomPlayerControls: false,
    ui: {
      configure(config) { configureCalls.push(config) },
      getControls: () => ({ dispatchEvent() {} }),
    },
    player: {},
    reRegisterOwnElements() {},
    registerMediaSessionHandlers() {},
    syncPlayPauseControlIcons() {},
    syncMuteControlIcons() {},
    syncPipToggleState() {},
  })
  vm.runInContext(`${configureSource}\n${uiConfigWatcherSource}\n${loadedWatcherSource}`, context)
  context.configureUI(true)
  return { context, props, configureCalls }
}

async function load(context, { multipleAudioTracks = false } = {}) {
  // handleLoaded sets these synchronously before its first await.
  context.hasLoaded.value = true
  context.isLive.value = false
  context.hasMultipleAudioTracks.value = multipleAudioTracks
  await nextTick()
}

const chapters = [{ title: 'Intro', startSeconds: 0 }, { title: 'Main', startSeconds: 60 }]

test('chapters arriving before or after load do not rebuild the controls', async () => {
  const { context, props, configureCalls } = setupPlayer()
  props.chapters = chapters
  await nextTick()
  await load(context)
  props.chapters = [...chapters, { title: 'Outro', startSeconds: 120 }]
  await nextTick()
  props.chapters = []
  await nextTick()

  assert.equal(configureCalls.length, 1, 'only the initial configure should rebuild the controls')
  assert.ok(configureCalls[0].controlPanelElements.includes('ft_chapters'))
})

test('the chapters control stays registered in the overflow-only layout', async () => {
  const { context, configureCalls } = setupPlayer()
  context.onlyUseOverFlowMenu.value = true
  await load(context)
  assert.equal(configureCalls.length, 2)
  assert.ok(configureCalls[1].overflowMenuButtons.includes('ft_chapters'))
})

test('deferred and load-time reconfigures coalesce into one rebuild', async () => {
  const { context, props, configureCalls } = setupPlayer()
  // A real layout change before the player has loaded is deferred.
  context.onlyUseOverFlowMenu.value = true
  props.chapters = chapters
  await nextTick()
  assert.equal(configureCalls.length, 1)
  assert.equal(context.pendingUiReconfigure, true)

  await load(context, { multipleAudioTracks: true })
  assert.equal(configureCalls.length, 2, 'loading should flush the pending change and the audio track label change together')
  assert.equal(configureCalls[1].trackLabelFormat, 'label')
  assert.equal(context.pendingUiReconfigure, false)
})

test('an unchanged configuration does not rebuild the controls', async () => {
  // The theatre button condition still reads the chapter count here, so the
  // computed reruns, but its output stays the same while SponsorBlock is on.
  const { context, props, configureCalls } = setupPlayer({ theatrePossible: false })
  await load(context)
  props.chapters = chapters
  await nextTick()
  assert.equal(configureCalls.length, 1)
})

test('a real configuration change after load still rebuilds once', async () => {
  const { context, props, configureCalls } = setupPlayer()
  await load(context)
  props.canSkipNext = true
  await nextTick()
  assert.equal(configureCalls.length, 2)
  assert.ok(configureCalls[1].controlPanelElements.includes('ft_skip_next'))
})
