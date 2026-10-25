import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref } from 'vue'

const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const handleLoadedSource = playerSource.slice(
  playerSource.indexOf('    async function handleLoaded() {'),
  playerSource.indexOf('    async function unloadForFormatSwitch() {')
)

const wrapSelectionSource = playerSource.slice(
  playerSource.indexOf('    function wrapTextTrackSelection() {'),
  playerSource.indexOf('    const playerWidth = computed(')
)

function createLoad () {
  let releaseCaption
  const calls = []
  const player = {
    isLive: () => false,
    getAudioTracks: () => [],
    getTextTracks: () => { calls.push('getTextTracks'); return [] },
  }
  const releases = []
  const context = vm.createContext({
    shortsPaused: ref(false),
    video: ref({ paused: true, duration: 30, videoWidth: 0, videoHeight: 0 }),
    hasLoaded: ref(false),
    videoLayoutReady: ref(false),
    pendingMetadataSeek: null,
    isLive: ref(false),
    localCaptions: ref([]),
    hasMultipleAudioTracks: ref(false),
    togglePlaybackRate: null,
    restoreCaptionIndex: null,
    suppressInitialAutoplay: false,
    props: { shortsPlayer: false, format: 'dash', captions: [{ url: 'https://example.com/en.vtt' }], chapters: [], storyboardSrc: null },
    player,
    loadGeneration: 0,
    process: { env: { SUPPORTS_LOCAL_API: false } },
    deduplicateAudioTracks: tracks => new Set(tracks),
    nextTick,
    emit() {},
    restorePendingPlaybackRate() {},
    rememberInlinePlayerLayoutHeight() {},
    addCaptionTrack: () => new Promise(resolve => { releaseCaption = resolve; releases.push(resolve) }),
    handleError() {},
    loadChapterThumbnails() { calls.push('loadChapterThumbnails') },
    syncShortsCaptionsEnabled() {},
    refreshChapterMarkers() {},
    refreshAbRepeatMarkers() {},
    applyPendingPresentationModes() {},
  })
  const handleLoaded = vm.runInContext(`${handleLoadedSource}\nhandleLoaded`, context)
  return { context, player, calls, start: () => handleLoaded(), releaseCaption: () => releaseCaption(), releases }
}

test('finishes player setup once the caption tracks are in', async () => {
  const load = createLoad()
  const loading = load.start()
  load.releaseCaption()
  await loading
  assert.deepEqual(load.calls, ['loadChapterThumbnails', 'getTextTracks'])
})

test('stops player setup when teardown began while caption tracks were loading', async () => {
  const load = createLoad()
  const loading = load.start()
  // destroyPlayer() clears hasLoaded synchronously and nulls the player only
  // after its own awaits, so the player object is still there at this point.
  load.context.hasLoaded.value = false
  load.releaseCaption()
  await loading
  assert.deepEqual(load.calls, [], 'a player being destroyed must not be touched')
})

test('stops player setup when the player was replaced while caption tracks were loading', async () => {
  const load = createLoad()
  const loading = load.start()
  load.context.player = { ...load.player }
  load.releaseCaption()
  await loading
  assert.deepEqual(load.calls, [], 'a newer player instance owns its own loaded handling')
})

test('only the latest load on the same player finishes setup', async () => {
  const load = createLoad()
  const first = load.start()
  const second = load.start()
  load.releases[0]()
  await first
  assert.deepEqual(load.calls, [], 'the superseded load must not restore captions or emit state')
  load.releases[1]()
  await second
  assert.deepEqual(load.calls, ['loadChapterThumbnails', 'getTextTracks'])
})

test('a caption the user picks while the tracks load is not replaced by the restored one', async () => {
  const load = createLoad()
  const tracks = [{ id: 1, label: 'English', active: true }, { id: 2, label: 'movie.srt', active: false }]
  const selected = []
  Object.assign(load.player, {
    getTextTracks: () => tracks,
    getConfiguration: () => ({ preferredText: [] }),
    configure() {},
    selectTextTrack: track => selected.push(track?.label ?? null),
  })
  // A format switch restores the caption that was on before it
  Object.assign(load.context, {
    restoreCaptionIndex: 0,
    initialCaption: null,
    lastSelectedCaptionTrack: null,
    findMatchingTextTrack: () => null,
    clearDisplayedCaptions() {},
    rememberAutoTranslatedCaption() {},
  })
  vm.runInContext(`${wrapSelectionSource}\nwrapTextTrackSelection()`, load.context)

  const loading = load.start()
  load.player.selectTextTrack(tracks[1])
  load.releaseCaption()
  await loading
  assert.deepEqual(selected, [null, 'movie.srt'])
})
