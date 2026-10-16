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

function createLoad () {
  let releaseCaption
  const calls = []
  const player = {
    isLive: () => false,
    getAudioTracks: () => [],
    getTextTracks: () => { calls.push('getTextTracks'); return [] },
  }
  const context = vm.createContext({
    shortsPaused: ref(false),
    video: ref({ paused: true, duration: 30, videoWidth: 0, videoHeight: 0 }),
    hasLoaded: ref(false),
    videoLayoutReady: ref(false),
    pendingMetadataSeek: null,
    isLive: ref(false),
    hasMultipleAudioTracks: ref(false),
    togglePlaybackRate: null,
    restoreCaptionIndex: null,
    suppressInitialAutoplay: false,
    props: { shortsPlayer: false, format: 'dash', captions: [{ url: 'https://example.com/en.vtt' }], chapters: [], storyboardSrc: null },
    player,
    process: { env: { SUPPORTS_LOCAL_API: false } },
    deduplicateAudioTracks: tracks => new Set(tracks),
    nextTick,
    emit() {},
    restorePendingPlaybackRate() {},
    rememberInlinePlayerLayoutHeight() {},
    addCaptionTrack: () => new Promise(resolve => { releaseCaption = resolve }),
    handleError() {},
    loadChapterThumbnails() { calls.push('loadChapterThumbnails') },
    syncShortsCaptionsEnabled() {},
    refreshAbRepeatMarkers() {},
    applyPendingPresentationModes() {},
  })
  const handleLoaded = vm.runInContext(`${handleLoadedSource}\nhandleLoaded`, context)
  return { context, player, calls, start: () => handleLoaded(), releaseCaption: () => releaseCaption() }
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
