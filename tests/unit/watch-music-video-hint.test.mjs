import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
function watchMethod(name) {
  const start = source.indexOf(`    ${name}`)
  const end = source.indexOf('\n    },', start)
  return vm.runInNewContext(`({ ${source.slice(start, end)}\n} })`, { navigationDownloadId: () => undefined })
}
const { isMusicVideo } = watchMethod('isMusicVideo: function')
const { watchRouteForVideo: watchRouteInContext } = watchMethod('watchRouteForVideo: function')
// Objects from the vm context have its prototypes, so compare plain copies
const watchRouteForVideo = video => JSON.parse(JSON.stringify(watchRouteInContext.call({ $store: { getters: {} } }, video)))
const { initializePlaybackRate } = watchMethod('initializePlaybackRate()')

test('treats videos as music from their genre or the list hint in the route', () => {
  assert.equal(isMusicVideo.call({ videoGenreIsMusic: true, tabRoute: { query: {} } }), true)
  assert.equal(isMusicVideo.call({ videoGenreIsMusic: false, tabRoute: { query: { musicVideo: 'true' } } }), true)
  assert.equal(isMusicVideo.call({ videoGenreIsMusic: false, tabRoute: { query: {} } }), false)
})

test('carries the music hint into routes for queued and recommended videos', () => {
  assert.deepEqual(watchRouteForVideo({ videoId: 'abc', isMusic: true }), { path: '/watch/abc', query: { musicVideo: 'true' } })
  assert.deepEqual(watchRouteForVideo({ videoId: 'abc', isMusic: false }), { path: '/watch/abc' })
  assert.deepEqual(watchRouteForVideo({ videoId: 'abc' }), { path: '/watch/abc' })
})

test('starts music videos at normal speed', () => {
  const watch = {
    musicMode: false, channelId: 'channel', isMusicVideo: true, sabrReloadState: null,
    $store: { getters: { getDefaultPlayback: 2, getChannelPlaybackSpeeds: '{"channel":2.5}', getEnableChannelSettings: true } },
  }
  initializePlaybackRate.call(watch)
  assert.equal(watch.currentPlaybackRate, 1)
  watch.isMusicVideo = false
  initializePlaybackRate.call(watch)
  assert.equal(watch.currentPlaybackRate, 2.5)
})
