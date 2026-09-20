import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, reactive, ref } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    const showOfflineMessage = computed(')
const expression = source.slice(start, source.indexOf('\n    // #endregion offline message', start))

for (const format of ['legacy', 'audio']) {
  test(`offline warning stays hidden while seeking downloaded ${format} media`, () => {
    const props = reactive({ localFilePlayback: true, format })
    const isOffline = ref(true)
    const isBuffering = ref(false)
    const visible = vm.runInNewContext(`${expression}\nshowOfflineMessage`, { computed, props, isOffline, isBuffering })
    assert.equal(visible.value, false)
    isBuffering.value = true
    assert.equal(visible.value, false, 'local seeking must not show a network warning')
    props.localFilePlayback = false
    assert.equal(visible.value, true, 'online streams still warn while buffering offline')
    isOffline.value = false
    assert.equal(visible.value, false)
    isOffline.value = true
    isBuffering.value = false
    assert.equal(visible.value, false)
  })
}

test('voice-over translation is unavailable offline and returns after reconnecting', () => {
  const start = source.indexOf('    const voiceOverTranslationAvailable = computed(')
  const expression = source.slice(start, source.indexOf('    const voiceOverTranslationAutoPrepare', start))
  const props = reactive({ offline: true, videoId: 'video' })
  const available = vm.runInNewContext(`${expression}\nvoiceOverTranslationAvailable`, {
    computed, props, process: { env: { IS_ELECTRON: true } },
    useVoiceOverTranslationSetting: ref(true), isLive: ref(false),
  })
  assert.equal(available.value, false)
  props.offline = false
  assert.equal(available.value, true)
})

for (const [loaded, loading] of [[false, false], [true, false], [false, true]]) {
  test(`reconnecting SponsorBlock ${loaded ? 'reuses loaded segments and decisions' : loading ? 'keeps the pending request' : 'initializes missing segments'}`, () => {
    const start = source.indexOf('    watch(useSponsorBlock, enabled => {')
    const end = source.indexOf('\n    })', start) + '\n    })'.length
    let change
    let setups = 0
    let schedules = 0
    const restored = []
    const helperStart = source.indexOf('    function syncSponsorBlockPlaybackState()')
    const helper = source.slice(helperStart, source.indexOf('    async function refreshSponsorBlockInfo()', helperStart))
    vm.runInNewContext(`${helper}\n${source.slice(start, end)}`, {
      watch: (_source, callback) => { change = callback }, useSponsorBlock: ref(true),
      sponsorBlockLoadedVideoId: loaded ? 'video' : null, sponsorBlockInfoLoading: ref(loading),
      props: { videoId: 'video', sponsorBlockAutoSkipDisabled: false },
      video: ref({ currentTime: 42, paused: true }), sponsorBlockSegments: [{}], canSeek: () => true,
      syncPromptSponsorBlockSegments: time => restored.push(['prompt', time]),
      updateSponsorBlockHighlightState: time => restored.push(['highlight', time]),
      syncSponsorBlockMuteSegments: (time, enabled) => restored.push(['mute', time, enabled]),
      setupSponsorBlock: () => { setups++ }, scheduleSponsorBlockSkip() { schedules++ },
      closeSponsorBlockInfo() {}, sponsorBlockMuteController: { reset() {} },
      clearSponsorBlockMuteSegments() {}, cancelSponsorBlockSkipSchedule() {},
    })
    change(true)
    assert.equal(setups, loaded || loading ? 0 : 1)
    assert.equal(schedules, loaded ? 1 : 0)
    assert.deepEqual(restored, loaded ? [['prompt', 42], ['highlight', 42], ['mute', 42, true]] : [])
  })
}

for (const nextVideoId of ['first', 'second']) {
  test(`a stale SponsorBlock response cannot finish the current request for ${nextVideoId}`, async () => {
    const start = source.indexOf('    async function setupSponsorBlock() {')
    const end = source.indexOf('    async function refreshSponsorBlockInfo()', start)
    const requests = []
    const props = { videoId: 'first' }
    const loading = ref(false)
    const harness = vm.runInNewContext(`
      let sponsorBlockLoadedVideoId = null;
      let sponsorBlockRequestGeneration = 0;
      ${source.slice(start, end)}
      ({ setupSponsorBlock, loaded: () => sponsorBlockLoadedVideoId })
    `, {
      props, sponsorBlockInfoLoading: loading, sponsorBlockInfoSegments: ref([]),
      hasSponsorBlockMusicOfftopicSegment: ref(false), activeSponsorBlockHighlightSegment: ref(null),
      clearSponsorBlockNotFoundRefetchTimeout() {}, cancelSponsorBlockSkipSchedule() {},
      clearSponsorBlockMuteSegments() {}, updateSponsorBlockHighlightState() {}, emitSponsorBlockInfoState() {},
      getSponsorBlockSegments: () => new Promise(resolve => requests.push(resolve)),
      SPONSORBLOCK_INFO_CATEGORIES: [], SPONSORBLOCK_INFO_ACTION_TYPES: [], ui: null, player: null,
    })
    const first = harness.setupSponsorBlock()
    props.videoId = nextVideoId
    const second = harness.setupSponsorBlock()
    requests[0]({ segments: [], averageDuration: 0 })
    await first
    assert.equal(loading.value, true, 'the stale response must not finish the newer pending request')
    assert.equal(harness.loaded(), null)
    requests[1]({ segments: [], averageDuration: 0 })
    await second
    assert.equal(loading.value, false)
    assert.equal(harness.loaded(), nextVideoId)
  })
}

test('temporary offline cleanup preserves manual SponsorBlock mute decisions', () => {
  const start = source.indexOf('    function clearSponsorBlockMuteSegments(')
  const end = source.indexOf('\n    }', start) + '\n    }'.length
  const manuallyMuted = new Set(['manual'])
  const doNotMute = new Set(['unmuted'])
  const clear = vm.runInNewContext(`${source.slice(start, end)}\nclearSponsorBlockMuteSegments`, {
    manuallyMutedSponsorBlockSegments: manuallyMuted, sponsorBlockDoNotMuteSegments: doNotMute,
    notifiedSponsorBlockMuteSegments: new Set(), skippedSponsorBlockSegments: ref([]),
    sponsorBlockMuteController: { setSourceActive() {} },
  })
  clear(true)
  assert.equal(manuallyMuted.has('manual'), true)
  assert.equal(doNotMute.has('unmuted'), true)
  clear()
  assert.equal(manuallyMuted.size, 0)
  assert.equal(doNotMute.size, 0)
})
