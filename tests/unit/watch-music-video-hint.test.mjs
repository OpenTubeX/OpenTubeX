import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
function watchMethod(name) {
  const start = source.indexOf(`    ${name}`)
  const end = source.indexOf('\n    },', start)
  return vm.runInNewContext(`({ ${source.slice(start, end)}\n} })`)
}
const { isMusicVideo } = watchMethod('isMusicVideo: function')
const { initializePlaybackRate } = watchMethod('initializePlaybackRate()')

test('treats videos as music from their genre or the list hint in the route', () => {
  assert.equal(isMusicVideo.call({ videoGenreIsMusic: true, tabRoute: { query: {} } }), true)
  assert.equal(isMusicVideo.call({ videoGenreIsMusic: false, tabRoute: { query: { musicVideo: 'true' } } }), true)
  assert.equal(isMusicVideo.call({ videoGenreIsMusic: false, tabRoute: { query: {} } }), false)
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
