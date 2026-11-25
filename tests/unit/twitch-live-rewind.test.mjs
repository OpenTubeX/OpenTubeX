import assert from 'node:assert/strict'
import test from 'node:test'

import { useTwitchLiveRewind } from '../../src/renderer/components/FtShakaVideoPlayer/opentubex/useTwitchLiveRewind.js'

class FakeMediaElement {
  time = 0
  seeking = false
  get currentTime() { return this.time }
  set currentTime(time) { this.time = time }
}
globalThis.HTMLMediaElement = FakeMediaElement

test('a forward nudge behind the live playlist stays live, while a seek back loads the recording', async () => {
  const startedAt = Date.now() - 3600_000
  const liveOrigin = Date.now() - 110_000
  class FakePlayer {
    seekRange() { return { start: 100, end: 110 } }
    getPlayheadTimeAsDate() { return new Date(liveOrigin + videoElement.time * 1000) }
  }
  const player = new FakePlayer()
  const videoElement = new FakeMediaElement()
  const rewind = useTwitchLiveRewind({
    getPlayer: () => player,
    getControls: () => ({ isSeeking: () => false }),
    props: { manifestSrc: 'live', twitchLiveRecording: { manifestSrc: 'recording', startedAt } },
    video: { value: videoElement },
  })
  rewind.attach(player, videoElement)
  rewind.handleLoaded()
  // The live window moved past a stalled playhead
  videoElement.time = 99
  rewind.handleTimeUpdate()

  videoElement.currentTime = 99.1
  await new Promise(resolve => setTimeout(resolve))
  assert.equal(videoElement.time, 99.1)
  assert.equal(rewind.mode.value, 'live')

  videoElement.currentTime = 50
  assert.equal(videoElement.time, 99.1)
  await new Promise(resolve => setTimeout(resolve))
  assert.equal(rewind.mode.value, 'recording')
  assert.equal(rewind.manifestSrc.value, 'recording')
})

for (const pauseDuringLoad of [false, true]) {
  test(`a source replacement before autoplay starts ${pauseDuringLoad ? 'stays paused after a pause during the load' : 'keeps playing it'}`, async () => {
    const { readFile } = await import('node:fs/promises')
    const { runInNewContext } = await import('node:vm')
    const source = await readFile(new URL('../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', import.meta.url), 'utf8')
    const helper = ['isAwaitingAutoplay', 'isPausedByUser']
      .map(name => source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'))[0])
      .join('\n')
    const start = source.indexOf('  async ([newFormat, newSourceKey], [oldFormat, oldSourceKey]) => {')
    const watcher = source.slice(start, source.indexOf('\n  }\n)', start) + '\n  }'.length)
    const calls = []
    // Loaded, with autoplay still waiting for enough data
    const videoElement = {
      autoplay: true,
      paused: true,
      played: { length: 0 },
      readyState: 2,
      currentTime: 0,
      pause: () => calls.push('pause'),
      play: () => calls.push('play'),
    }
    const context = {
      HTMLMediaElement: { HAVE_ENOUGH_DATA: 4 },
      initialAutoplayCanceled: false,
      props: { autoplayRequested: false, captions: [], captionTranslations: [], pauseForStreamRecovery: false },
      formatSwitchGeneration: 0,
      pendingFormatSwitchState: null,
      restartedSourceKey: null,
      foregroundLoadAbortController: null,
      ignoreErrors: false,
      hasLoaded: { value: true },
      hasPlaybackPosition: { value: true },
      video: { value: videoElement },
      twitchLiveRewind: { takeSwitchStartTime: () => undefined },
      pendingMetadataSeek: null,
      player: { getTextTracks: () => [], getConfiguration: () => ({ abr: { enabled: true } }) },
      captionSources: new Map(),
      queuePlaybackRateRestore() {},
      preferAutoQuality: { value: true },
      restoreCaptionTranslation: null,
      restoreCaptionIndex: null,
      unloadForFormatSwitch: async () => {},
      setLegacyQuality: async () => {
        calls.push('load')
        // A pause, such as from the Media Session, cancels autoplay of the paused element
        if (pauseDuringLoad) context.initialAutoplayCanceled = true
      },
    }
    const switchSource = runInNewContext(`${helper}\n(${watcher})`, context)
    await switchSource(['legacy', 1], ['legacy', 0])
    assert.deepEqual(calls, ['pause', 'load', pauseDuringLoad ? 'pause' : 'play'])
  })
}
