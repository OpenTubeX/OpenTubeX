import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, reactive, ref } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', import.meta.url), 'utf8')
const sponsorBlockSource = await readFile(new URL('../../src/renderer/components/FtShakaVideoPlayer/opentubex/useSponsorBlockPlayback.js', import.meta.url), 'utf8')
const start = source.indexOf('\nconst showOfflineMessage = computed(') + 1
const expression = source.slice(start, source.indexOf('\n// #endregion offline message', start))

test('SponsorBlock refresh waits for connectivity and pending votes', async () => {
  const start = sponsorBlockSource.indexOf('  async function refreshSponsorBlockInfo() {')
  const end = sponsorBlockSource.indexOf('  async function refreshSponsorBlockContributionStats()', start)
  const props = { offline: true }
  const pendingVote = ref(null)
  let refreshes = 0
  const refresh = vm.runInNewContext(`${sponsorBlockSource.slice(start, end)}\nrefreshSponsorBlockInfo`, {
    props,
    sponsorBlockEnableSubmission: ref(false),
    sponsorBlockVotePending: pendingVote,
    setupSponsorBlock: async () => { refreshes++ }
  })
  await refresh()
  assert.equal(refreshes, 0)
  props.offline = false
  pendingVote.value = 'segment'
  await refresh()
  assert.equal(refreshes, 0)
  pendingVote.value = null
  await refresh()
  assert.equal(refreshes, 1)
})

test('offline warning stays hidden while seeking downloaded audio media', () => {
  const props = reactive({ localFilePlayback: true, format: 'audio' })
  const isOffline = ref(true)
  const isBuffering = ref(false)
  const mediaWaiting = ref(false)
  const visible = vm.runInNewContext(`${expression}\nshowOfflineMessage`, { computed, props, isOffline, isBuffering, mediaWaiting })
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
  mediaWaiting.value = true
  assert.equal(visible.value, true, 'Shaka stops reporting buffering after a failed stream, but the video still waits')
})

for (const [loaded, loading] of [[false, false], [true, false], [false, true]]) {
  test(`reconnecting SponsorBlock ${loaded ? 'reuses loaded segments and decisions' : loading ? 'keeps the pending request' : 'initializes missing segments'}`, () => {
    const start = source.indexOf('\nwatch(useSponsorBlock, enabled => {') + 1
    const end = source.indexOf('\n})', start) + '\n})'.length
    let change
    let setups = 0
    let schedules = 0
    const restored = []
    const helperStart = sponsorBlockSource.indexOf('  function syncSponsorBlockPlaybackState()')
    const helper = sponsorBlockSource.slice(helperStart, sponsorBlockSource.indexOf('  async function refreshSponsorBlockInfo()', helperStart))
    vm.runInNewContext(`${helper}\n${source.slice(start, end)}`, {
      watch: (_source, callback) => { change = callback },
      useSponsorBlock: ref(true),
      sponsorBlockLoadedVideoId: loaded ? 'video' : null,
      sponsorBlockInfoLoading: ref(loading),
      props: { videoId: 'video', sponsorBlockAutoSkipDisabled: false },
      video: ref({ currentTime: 42, paused: true }),
      sponsorBlockSegments: [{}],
      canSeek: () => true,
      syncPromptSponsorBlockSegments: time => restored.push(['prompt', time]),
      updateSponsorBlockHighlightState: time => restored.push(['highlight', time]),
      syncSponsorBlockMuteSegments: (time, enabled) => restored.push(['mute', time, enabled]),
      setupSponsorBlock: () => { setups++ },
      scheduleSponsorBlockSkip() { schedules++ },
      closeSponsorBlockInfo() {},
      sponsorBlockMuteController: { reset() {} },
      clearSponsorBlockMuteSegments() {},
      cancelSponsorBlockSkipSchedule() {},
    })
    change(true)
    assert.equal(setups, loaded || loading ? 0 : 1)
    assert.equal(schedules, loaded ? 1 : 0)
    assert.deepEqual(restored, loaded ? [['prompt', 42], ['highlight', 42], ['mute', 42, true]] : [])
  })
}

test('a stale SponsorBlock response cannot finish the current request for first', async () => {
  const start = source.indexOf('\nasync function setupSponsorBlock() {') + 1
  const end = source.indexOf('\nfunction skipSponsorBlockSegments(', start)
  const requests = []
  const props = { videoId: 'first' }
  const loading = ref(false)
  const harness = vm.runInNewContext(`
    let sponsorBlockLoadedVideoId = null;
    let sponsorBlockRequestGeneration = 0;
    ${source.slice(start, end)}
    ({ setupSponsorBlock, loaded: () => sponsorBlockLoadedVideoId })
  `, {
    props,
    sponsorBlockInfoLoading: loading,
    sponsorBlockInfoSegments: ref([]),
    hasSponsorBlockMusicOfftopicSegment: ref(false),
    resetSponsorBlockPlaybackState() {},
    emitSponsorBlockInfoState() {},
    getSponsorBlockSegments: () => new Promise(resolve => requests.push(resolve)),
    SPONSORBLOCK_INFO_CATEGORIES: [],
    SPONSORBLOCK_INFO_ACTION_TYPES: [],
    ui: null,
    player: null,
  })
  const first = harness.setupSponsorBlock()
  props.videoId = 'first'
  const second = harness.setupSponsorBlock()
  requests[0]({ segments: [], averageDuration: 0 })
  await first
  assert.equal(loading.value, true, 'the stale response must not finish the newer pending request')
  assert.equal(harness.loaded(), null)
  requests[1]({ segments: [], averageDuration: 0 })
  await second
  assert.equal(loading.value, false)
  assert.equal(harness.loaded(), 'first')
})

for (const [change, hasSegments] of [['none', false], ['none', true], ['video', false], ['generation', true]]) {
  test(`SponsorBlock refetch with ${hasSegments ? 'segments' : 'no segments'} handles ${change} change`, async () => {
    const start = sponsorBlockSource.indexOf('  async function refetchSponsorBlockSegmentsWhenNotFound() {')
    const end = sponsorBlockSource.indexOf('  function resetSponsorBlockPlaybackState()', start)
    let respond
    const effects = []
    const originalSegments = []
    const info = ref(originalSegments)
    const context = vm.createContext({
      props: { videoId: 'first' },
      sponsorBlockRequestGeneration: 1,
      getRequestGeneration: () => context.sponsorBlockRequestGeneration,
      getSponsorBlockSegments: videoId => {
        assert.equal(videoId, 'first')
        return new Promise(resolve => { respond = resolve })
      },
      SPONSORBLOCK_INFO_CATEGORIES: [],
      SPONSORBLOCK_INFO_ACTION_TYPES: [],
      SPONSORBLOCK_PLAYBACK_ACTION_TYPES: ['skip'],
      sponsorSkips: ref({ seekBar: ['sponsor'] }),
      getUi: () => ({}),
      getPlayer: () => ({}),
      sponsorBlockInfoSegments: info,
      setSegments() {},
      setAverageVideoDuration() {},
      hasSponsorBlockMusicOfftopicSegment: ref(false),
      refreshSponsorBlockMarkers: () => effects.push('markers'),
      syncSponsorBlockPlaybackState: () => effects.push('sync'),
      scheduleSponsorBlockNotFoundRefetch: () => effects.push('retry'),
      emitSponsorBlockInfoState: () => effects.push('emit'),
    })
    const refetch = vm.runInContext(`${sponsorBlockSource.slice(start, end)}\nrefetchSponsorBlockSegmentsWhenNotFound`, context)
    const pending = refetch()
    if (change === 'video') context.props.videoId = 'second'
    if (change === 'generation') context.sponsorBlockRequestGeneration++
    const segments = hasSegments ? [{ category: 'sponsor', actionType: 'skip' }] : []
    respond({ segments, averageDuration: 100 })
    await pending
    assert.deepEqual(effects, change === 'none' ? hasSegments ? ['markers', 'sync', 'emit'] : ['retry', 'emit'] : [])
    assert.deepEqual(info.value, change === 'none' && hasSegments ? segments : originalSegments)
  })
}

test('temporary offline cleanup preserves manual SponsorBlock mute decisions', () => {
  const start = sponsorBlockSource.indexOf('  function clearSponsorBlockMuteSegments(')
  const end = sponsorBlockSource.indexOf('\n  }', start) + '\n  }'.length
  const manuallyMuted = new Set(['manual'])
  const doNotMute = new Set(['unmuted'])
  const clear = vm.runInNewContext(`${sponsorBlockSource.slice(start, end)}\nclearSponsorBlockMuteSegments`, {
    manuallyMutedSponsorBlockSegments: manuallyMuted,
    sponsorBlockDoNotMuteSegments: doNotMute,
    notifiedSponsorBlockMuteSegments: new Set(),
    skippedSponsorBlockSegments: ref([]),
    sponsorBlockMuteController: { setSourceActive() {} },
  })
  clear(true)
  assert.equal(manuallyMuted.has('manual'), true)
  assert.equal(doNotMute.has('unmuted'), true)
  clear()
  assert.equal(manuallyMuted.size, 0)
  assert.equal(doNotMute.size, 0)
})
