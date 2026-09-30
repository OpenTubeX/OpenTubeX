import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { effectScope, nextTick, ref, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useSleepTimer.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')

function createTimer(t, stored = null) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const entries = new Map(stored ? [['OpenTubeX/sleepTimer', JSON.stringify(stored)]] : [])
  const storage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  }
  const videoId = ref('video-one')
  const video = { currentTime: 9, playbackRate: 1, paused: false, seeking: false }
  let expired = 0
  let restore
  const scope = effectScope()
  const create = vm.runInNewContext(`${source}; useSleepTimer`, {
    onMounted: callback => { restore = callback },
    onBeforeUnmount: () => {},
    ref, watch, sessionStorage: storage, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  const timer = scope.run(() => create({
    getVideoId: () => videoId.value,
    getCurrentTime: () => video.currentTime,
    getPlaybackRate: () => video.playbackRate,
    isPaused: () => video.paused,
    isSeeking: () => video.seeking,
    onExpired: () => { expired++ },
    pausePlayback: () => { video.paused = true },
    seekTo: seconds => { video.currentTime = seconds },
  }))
  restore()
  t.after(() => scope.stop())
  return { timer, video, videoId, entries, get expired() { return expired } }
}

test('stops just before the selected chapter ends and clears the one-shot timer', t => {
  const player = createTimer(t)
  player.timer.startEndOfChapter(10)
  assert.equal(player.timer.mode.value, 'end-of-chapter')
  assert.equal(JSON.parse(player.entries.get('OpenTubeX/sleepTimer')).endSeconds, 10)

  player.video.currentTime = 9.96
  t.mock.timers.tick(950)

  assert.equal(player.video.paused, true)
  assert.ok(player.video.currentTime < 10)
  assert.equal(player.timer.mode.value, null)
  assert.equal(player.expired, 1)
  assert.equal(player.entries.size, 0)
})

test('seeking past the selected chapter cancels its timer', t => {
  const player = createTimer(t)
  player.timer.startEndOfChapter(10)
  player.video.seeking = true
  player.timer.checkChapterBoundary()
  player.video.currentTime = 12
  player.video.seeking = false
  player.timer.handleSeeked()
  t.mock.timers.tick(2000)

  assert.equal(player.video.paused, false)
  assert.equal(player.timer.mode.value, null)
  assert.equal(player.expired, 0)
})

test('restores a chapter timer for the same video and suppresses autoplay at video end', t => {
  const player = createTimer(t, { mode: 'end-of-chapter', videoId: 'video-one', endSeconds: 10 })
  assert.equal(player.timer.mode.value, 'end-of-chapter')
  assert.equal(player.timer.consumeEndOfVideo(), true)
  assert.equal(player.expired, 1)
  assert.equal(player.entries.size, 0)
})

test('changing videos clears a selected chapter timer', async t => {
  const player = createTimer(t)
  player.timer.startEndOfChapter(10)
  player.videoId.value = 'video-two'
  await nextTick()
  assert.equal(player.timer.mode.value, null)
  assert.equal(player.entries.size, 0)
})
