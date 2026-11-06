import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive, ref } from 'vue'
import { usePlaybackRate } from '../../src/renderer/components/ft-shaka-video-player/opentubex/usePlaybackRate.js'

function fixture({ paused = false } = {}) {
  const video = {
    playbackRate: 1.5,
    defaultPlaybackRate: 1,
    paused,
    play() { video.paused = false },
    pause() { video.paused = true },
  }
  const userSet = []
  const player = {
    getPlaybackRate: () => video.playbackRate,
    trickPlay(rate) { video.playbackRate = rate },
    cancelTrickPlay() { video.playbackRate = video.defaultPlaybackRate },
  }
  const api = usePlaybackRate({
    video: ref(video),
    getPlayer: () => player,
    hasLoaded: ref(true),
    isLive: ref(false),
    musicMode: ref(false),
    hasSponsorBlockMusicOfftopicSegment: ref(false),
    shortsNavigationSuspended: ref(false),
    props: reactive({ currentPlaybackRate: 1.5, videoIsMusic: false }),
    defaultPlaybackRate: ref(1),
    maxVideoPlaybackRate: ref(4),
    savedChannelPlaybackRate: ref(null),
    holdToDoublePlaybackSpeed: ref(true),
    onPlaybackRateUpdated() {},
    onPlaybackRateUserSet: rate => userSet.push(rate),
    updatePendingPlaybackRateMenu() {},
    showValueChange() {},
    showToast() {},
    t: key => key,
  })
  return { api, video, userSet }
}

test('holding doubles the chosen speed after the hold delay and restores it on release', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { api, video } = fixture()
  api.startTemporaryPlaybackRateHold('keyboard')
  assert.equal(api.isTemporaryPlaybackRateHoldPending('keyboard'), true)
  t.mock.timers.tick(624)
  assert.equal(api.isTemporaryPlaybackRateActive(), false)
  t.mock.timers.tick(1)
  assert.equal(api.isTemporaryPlaybackRateSourceActive('keyboard'), true)
  assert.equal(api.isTemporaryPlaybackRateHoldPending('keyboard'), false)
  assert.equal(video.playbackRate, 3)
  assert.equal(api.temporaryPlaybackRateIndicatorMessage.value, '3x')
  assert.equal(api.showTemporaryPlaybackRateIndicator.value, true)
  assert.equal(api.getCurrentPlaybackRate(), 1.5, 'a hold does not change the chosen speed')

  api.finishTemporaryPlaybackRateHold('keyboard')
  assert.equal(api.isTemporaryPlaybackRateActive(), false)
  assert.equal(video.playbackRate, 1.5)
  assert.equal(api.showTemporaryPlaybackRateIndicator.value, false)
})

test('a hold that started while paused pauses again without revealing the controls', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { api, video } = fixture({ paused: true })
  api.startTemporaryPlaybackRateHold('pointer')
  t.mock.timers.tick(625)
  assert.equal(video.paused, false)
  api.cancelTemporaryPlaybackRateHolds()
  assert.equal(video.paused, true)
  assert.equal(api.consumeTemporaryPlaybackRatePause(), true)
  assert.equal(api.consumeTemporaryPlaybackRatePause(), false, 'only the pause that ended the hold')
})

test('the hold continues until every held source is released', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { api, video } = fixture()
  api.startTemporaryPlaybackRateHold('keyboard')
  api.startTemporaryPlaybackRateHold('pointer')
  t.mock.timers.tick(625)
  api.finishTemporaryPlaybackRateHold('pointer')
  assert.equal(video.playbackRate, 3)
  api.finishTemporaryPlaybackRateHold('keyboard')
  assert.equal(video.playbackRate, 1.5)
})

test('toggling normal speed returns to the previous speed', () => {
  const { api, video, userSet } = fixture()
  api.toggleNormalPlaybackRate()
  assert.equal(video.playbackRate, 1)
  api.toggleNormalPlaybackRate()
  assert.equal(video.playbackRate, 1.5)
  assert.deepEqual(userSet, [1, 1.5])
})

test('a speed chosen in the player menu is reported once Shaka applies it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { api, video, userSet } = fixture()
  api.handlePlayerMenuPlaybackRateSelected()
  video.playbackRate = 2
  t.mock.timers.tick(10)
  assert.deepEqual(userSet, [2])
})
