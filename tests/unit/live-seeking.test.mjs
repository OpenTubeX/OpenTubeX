import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    const seekingIsPossible = computed(() => {')
const end = source.indexOf('\n    })', start) + '\n    })'.length

function canSeekLive(props) {
  return vm.runInNewContext(`${source.slice(start, end)}\nseekingIsPossible.value`, {
    computed: getter => ({ value: getter() }),
    props: { isLive: true, playbackEngine: 'built-in', ...props }
  })
}

for (const playbackEngine of ['built-in', 'yt-dlp']) {
  for (const [manifestMimeType, manifestSrc] of [
    ['application/dash+xml', 'https://example.com/live.mpd'],
    ['application/x-mpegurl', 'https://example.com/manifest_duration/3600/live.m3u8'],
    ['application/x-mpegurl', 'https://example.com/playlist_type/DVR/live.m3u8']
  ]) {
    test(`${playbackEngine} hides seeking when DVR is disabled, even with ${manifestSrc}`, () => {
      assert.equal(canSeekLive({ playbackEngine, manifestMimeType, manifestSrc, isLiveDvrEnabled: false }), false)
    })
  }
}

for (const manifestMimeType of ['application/sabr+json', 'application/dash+xml', 'application/x-mpegurl']) {
  test(`built-in live playback never offers seeking with ${manifestMimeType}`, () => {
    for (const isLiveDvrEnabled of [true, false, null]) {
      assert.equal(canSeekLive({
        manifestMimeType,
        manifestSrc: 'https://example.com/manifest_duration/3600/live',
        isLiveDvrEnabled
      }), false)
    }
  })
}

test('keeps yt-dlp seeking for DVR-enabled livestreams and premieres', () => {
  assert.equal(canSeekLive({ playbackEngine: 'yt-dlp', manifestMimeType: 'application/dash+xml', isLiveDvrEnabled: true }), true)
})

test('keeps manifest-based seeking when the backend has no DVR metadata', () => {
  assert.equal(canSeekLive({ playbackEngine: 'yt-dlp', manifestMimeType: 'application/dash+xml', isLiveDvrEnabled: null }), true)
  assert.equal(canSeekLive({ manifestMimeType: 'application/x-mpegurl', manifestSrc: 'https://example.com/manifest_duration/30/live.m3u8' }), false)
})

test('DVR metadata does not disable seeking for ordinary videos or ended streams', () => {
  assert.equal(canSeekLive({ isLive: false, manifestMimeType: 'application/dash+xml', isLiveDvrEnabled: false }), true)
})

function absoluteSeekFixture(props) {
  const seekingAllowed = canSeekLive({ manifestMimeType: 'application/dash+xml', ...props })
  const state = {
    seekingIsPossible: { value: seekingAllowed },
    hasPlaybackPosition: { value: false },
    hasLoaded: { value: true },
    pendingMetadataSeek: null,
    seekBarMouseDown: false,
    videoLayoutReady: { value: true },
    applyPendingPresentationModes() {},
    updateAutoPip() {},
    handleVideoResize() {},
    canSeek: () => seekingAllowed,
    accumulatedSeekSeconds: 5,
    video: { value: { currentTime: 10, duration: 30, paused: true, pause() {}, fastSeek(time) { this.currentTime = time } } },
    mediaTabId: 'live-test',
    mediaSessionStopped: false,
    tabMediaCoordinator: {
      setActionHandlers(_id, _owner, handlers) { state.handlers = handlers },
      setPlaybackState() {}
    },
  }
  const functions = ['setCurrentTime', 'rememberSeekPosition', 'registerMediaSessionHandlers', 'handleSeekBarInput', 'handleSeekBarMouseChange', 'handleCanPlay'].map(name => {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const api = vm.runInNewContext(`${functions}\nregisterMediaSessionHandlers();\n({ setCurrentTime, handleSeekBarInput, handleSeekBarMouseChange, handleCanPlay })`, state)
  return { state, ...api }
}

for (const props of [
  { playbackEngine: 'built-in', isLiveDvrEnabled: true },
  { playbackEngine: 'yt-dlp', isLiveDvrEnabled: false }
]) {
  test(`${props.playbackEngine} blocks timestamp and Media Session seeking when live seeking is disabled`, () => {
    const { state, setCurrentTime } = absoluteSeekFixture(props)
    setCurrentTime(3)
    assert.equal(state.video.value.currentTime, 10)
    assert.equal(state.hasPlaybackPosition.value, false)
    for (const fastSeek of [true, false]) {
      state.handlers.seekto({ seekTime: 2, fastSeek })
      assert.equal(state.video.value.currentTime, 10)
    }
    state.handlers.stop()
    assert.equal(state.video.value.currentTime, 10)
  })
}

test('absolute seeking still works for ordinary videos and yt-dlp DVR', () => {
  for (const props of [{ isLive: false }, { playbackEngine: 'yt-dlp', isLiveDvrEnabled: true }]) {
    const { state, setCurrentTime } = absoluteSeekFixture(props)
    setCurrentTime(3)
    assert.equal(state.video.value.currentTime, 3)
    assert.equal(state.hasPlaybackPosition.value, true)
    for (const fastSeek of [true, false]) {
      state.video.value.currentTime = 10
      state.handlers.seekto({ seekTime: 2, fastSeek })
      assert.equal(state.video.value.currentTime, 2)
    }
  }
})

test('retains the latest absolute seek before metadata, including zero', () => {
  const { state, setCurrentTime } = absoluteSeekFixture({ isLive: false })
  state.video.value.readyState = 0
  for (const time of [15, 5, 0]) {
    setCurrentTime(time)
    assert.equal(state.pendingMetadataSeek, time)
    assert.equal(state.hasPlaybackPosition.value, true)
  }
})

test('consumes the startup seek even when canplay precedes Shaka loaded', () => {
  const { state, setCurrentTime, handleCanPlay } = absoluteSeekFixture({ isLive: false })
  state.hasLoaded.value = false
  state.video.value.readyState = 0
  setCurrentTime(5)
  state.video.value.readyState = 3
  handleCanPlay()
  assert.equal(state.video.value.currentTime, 5)
  assert.equal(state.pendingMetadataSeek, null)
  state.hasLoaded.value = true
  state.video.value.currentTime = 20
  handleCanPlay()
  assert.equal(state.video.value.currentTime, 20)
})

test('loading completion consumes a native seek made after canplay', () => {
  const { state, setCurrentTime, handleCanPlay } = absoluteSeekFixture({ isLive: false })
  state.hasLoaded.value = false
  state.video.value.readyState = 4
  handleCanPlay()
  setCurrentTime(5)
  assert.equal(state.pendingMetadataSeek, 5)
  state.video.value.currentTime = 6
  const loadedStart = source.indexOf('    async function handleLoaded() {')
  const loadedEnd = source.indexOf('      // Background tabs', loadedStart)
  Object.assign(state, {
    togglePlaybackRate: null,
    isLive: { value: false },
    restorePendingPlaybackRate() {},
    player: { isLive: () => false, getManifest: () => null }
  })
  vm.runInNewContext(`${source.slice(loadedStart, loadedEnd)}\n    }\nhandleLoaded()`, state)
  assert.equal(state.pendingMetadataSeek, null)
  assert.equal(state.video.value.currentTime, 6)
  state.video.value.currentTime = 20
  handleCanPlay()
  assert.equal(state.video.value.currentTime, 20)
})

test('retains a queued seek when a timeline pointer interaction is canceled', () => {
  const { state, setCurrentTime, handleSeekBarInput } = absoluteSeekFixture({ isLive: false })
  state.video.value.readyState = 0
  setCurrentTime(15)
  handleSeekBarInput({ type: 'pointerdown', target: { matches: () => true } })
  assert.equal(state.pendingMetadataSeek, 15)
})

test('records a first timeline input while buffering without an earlier chapter seek', () => {
  const { state, handleSeekBarInput } = absoluteSeekFixture({ isLive: false })
  state.video.value.readyState = 1
  handleSeekBarInput({ type: 'input', target: { matches: () => true, value: '5' } })
  assert.equal(state.pendingMetadataSeek, 5)
})

test('retains a first timeline seek when data is ready but canplay has not fired', () => {
  const { state, handleSeekBarInput } = absoluteSeekFixture({ isLive: false })
  state.video.value.readyState = 4
  state.videoLayoutReady.value = false
  handleSeekBarInput({ type: 'input', target: { matches: () => true, value: '5' } })
  assert.equal(state.pendingMetadataSeek, 5)
})

test('a mouse drag retains the latest timeline value and consumes its release', () => {
  const { state, handleSeekBarInput, handleSeekBarMouseChange } = absoluteSeekFixture({ isLive: false })
  state.video.value.readyState = 1
  handleSeekBarInput({ type: 'mousedown', target: { matches: () => true, value: '5' } })
  state.ui = { getControls: () => ({ getDisplayTime: () => 15 }) }
  handleSeekBarMouseChange({ type: 'mousemove' })
  assert.equal(state.pendingMetadataSeek, 15)
  assert.equal(state.seekBarMouseDown, true)
  handleSeekBarMouseChange({ type: 'mouseup' })
  assert.equal(state.pendingMetadataSeek, 15)
  assert.equal(state.seekBarMouseDown, false)
})

for (const action of ['chapter', 'media session', 'timeline']) {
  test(`a newer ${action} seek replaces a seek queued before metadata`, () => {
    const { state, setCurrentTime, handleSeekBarInput } = absoluteSeekFixture({ isLive: false })
    state.video.value.readyState = 0
    setCurrentTime(15)
    state.video.value.readyState = 1
    if (action === 'chapter') setCurrentTime(5)
    if (action === 'media session') state.handlers.seekto({ seekTime: 5 })
    if (action === 'timeline') handleSeekBarInput({ type: 'input', target: { matches: () => true, value: '5' } })
    assert.equal(state.pendingMetadataSeek, 5)
  })
}

for (const userSeek of [false, true]) {
  test(`native metadata restores saved progress after autoplay begins with userSeek=${userSeek}`, async () => {
    const mediaElement = new EventTarget()
    mediaElement.currentTime = userSeek ? 5 : 0.002
    mediaElement.seeking = userSeek
    const player = new EventTarget()
    player.getManifest = () => null
    player.updateStartTime = () => {}
    player.load = async () => {
      player.dispatchEvent(new Event('canupdatestarttime'))
      mediaElement.dispatchEvent(new Event('loadedmetadata'))
    }
    const match = source.match(/    async function loadPlaybackSource\([^]*?\n    }/)
    assert.ok(match)
    const loadPlaybackSource = vm.runInNewContext(`${match[0]}\nloadPlaybackSource`, {
      player,
      video: { value: mediaElement },
      pendingMetadataSeek: null,
      hasPlaybackPosition: { value: userSeek }
    })
    await loadPlaybackSource('https://example.com/video', 15, 'video/webm')
    assert.equal(mediaElement.currentTime, userSeek ? 5 : 15)
  })
}
