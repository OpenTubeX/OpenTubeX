import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
function watchMethod(name, globals = {}) {
  const start = source.indexOf(`    ${name}`)
  const end = source.indexOf('\n    },', start)
  return vm.runInNewContext(`({ ${source.slice(start, end)}\n} })`, globals)
}
const { startTimeSeconds } = watchMethod('startTimeSeconds:')
const { initializePlaybackRate } = watchMethod('initializePlaybackRate()')
const view = {
  isLoading: false, isLive: false, musicMode: true,
  oneTimeTimestamp: null, timestamp: null, videoLengthSeconds: 60,
  watchedProgressSavingEnabled: true, historyEntryExists: true,
  historyEntry: { watchProgress: 10 },
}

test('music mode ignores saved progress and cached Shorts positions', () => {
  assert.equal(startTimeSeconds.call(view), 0)
  assert.equal(startTimeSeconds.call({ ...view, musicMode: false }), 10)
  const short = {
    ...view, customShortsPlayerActive: true,
    tabRoute: { query: { shortSource: 'channel' } },
    shortsPlaybackCache: { getPosition: () => 6 },
  }
  assert.equal(startTimeSeconds.call(short), 0)
  assert.equal(startTimeSeconds.call({ ...short, musicMode: false }), 6)
})

test('music mode preserves explicit seeks and playback recovery positions', () => {
  assert.equal(startTimeSeconds.call({ ...view, timestamp: 15 }), 15)
  assert.equal(startTimeSeconds.call({ ...view, oneTimeTimestamp: 8 }), 8)
  assert.equal(startTimeSeconds.call({ ...view, isLive: true }), null)
})

test('music mode ignores cached progress when navigating between Shorts', () => {
  const { navigateSubscriptionShort } = watchMethod('navigateSubscriptionShort:', { getShortThumbnailUrl: () => '' })
  for (const musicMode of [true, false]) {
    let destination
    let savedPosition = false
    const short = {
      ...view, musicMode,
      subscriptionShortsFeedActive: true,
      shortsNavigationLockedUntil: 0,
      subscriptionShortsFeed: [{ videoId: 'first' }, { videoId: 'second' }],
      subscriptionShortsFeedIndex: 0,
      saveShortsPlaybackPosition: () => { savedPosition = true },
      shortsPlaybackCache: { getPosition: () => 6 },
      tabRoute: { query: { shortSource: 'subscriptions' } },
      tabRouter: { push: route => { destination = route } },
      $store: { getters: { getThumbnailDataSaver: false } },
    }
    navigateSubscriptionShort.call(short, 1)
    assert.equal(savedPosition, true)
    assert.equal(destination.path, '/watch/second')
    assert.equal(destination.query.oneTimeTimestamp, musicMode ? undefined : '6')
    const oneTimeTimestamp = destination.query.oneTimeTimestamp === undefined
      ? null : Number(destination.query.oneTimeTimestamp)
    assert.equal(startTimeSeconds.call({ ...short, oneTimeTimestamp }), musicMode ? 0 : 6)
  }
})

test('music mode overrides global, channel, and recovery speeds without changing saved preferences', () => {
  const settings = {
    getDefaultPlayback: 2,
    getRememberPlaybackSpeedPerChannel: true,
    getChannelPlaybackSpeeds: '{"channel":2.5}',
  }
  const watch = {
    musicMode: true, channelId: 'channel', videoGenreIsMusic: false,
    sabrReloadState: { playbackRate: 3 }, $store: { getters: settings },
  }
  initializePlaybackRate.call(watch)
  assert.equal(watch.currentPlaybackRate, 1)
  watch.musicMode = false
  watch.sabrReloadState = null
  initializePlaybackRate.call(watch)
  assert.equal(watch.currentPlaybackRate, 2.5)
  assert.equal(settings.getDefaultPlayback, 2)
  assert.equal(settings.getChannelPlaybackSpeeds, '{"channel":2.5}')
})
