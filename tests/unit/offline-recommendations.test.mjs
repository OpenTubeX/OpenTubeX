import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { downloadWatchRoute, isPlayableDownloadFile } from '../../src/renderer/helpers/downloadPlayback.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const computed = runInNewContext(`({${source.slice(source.indexOf('    offlineDownloadSuggestions:'), source.indexOf('    hasScheduledPremiereStarted:'))}})`, {
  downloadWatchRoute, isPlayableDownloadFile, isVideoHiddenByPreferences: () => false,
})

test('offline recommendations retain saved thumbnails and exclude unavailable files and the current video', () => {
  const watch = {
    videoId: 'current',
    $store: { getters: { getYtDlpDownloads: {
      1: { id: 1, status: 'completed', mode: 'audio', videoId: 'saved', title: 'Saved audio', thumbnail: 'data:image/png;base64,saved', files: [
        { videoId: 'saved', path: '/saved.mp3', extension: 'mp3' },
        { videoId: 'current', path: '/current.mp3', extension: 'mp3' },
        { videoId: 'missing', path: '/missing.mp3', extension: 'mp3', available: false },
      ] },
    } } },
  }
  const suggestions = computed.offlineDownloadSuggestions.call(watch)
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].thumbnail, 'data:image/png;base64,saved')
  assert.deepEqual(suggestions[0].route, { path: '/watch/saved', query: { downloadId: '1', downloadFilePath: '/saved.mp3' } })
})

for (const localFilePlayback of [false, true]) {
  test(`${localFilePlayback ? 'downloaded' : 'streamed'} playback switches recommendations on connection changes without discarding online data`, () => {
    const { handleDownloadConnectionChange } = runInNewContext(`({${source.slice(source.indexOf('    handleDownloadConnectionChange('), source.indexOf('    handleUpcomingPlaylistVideosChange('))}})`)
    const online = [{ videoId: 'online' }]
    const offline = [{ videoId: 'saved', route: { path: '/watch/saved', query: { downloadId: '1' } } }]
    const watch = {
      isLoading: false, localFilePlayback, isOffline: false,
      recommendedVideos: online, offlineDownloadSuggestions: offline,
      abortAutoplayCountdown() {},
    }
    assert.equal(computed.displayedRecommendations.call(watch), online)
    handleDownloadConnectionChange.call(watch, { detail: 'offline' })
    assert.equal(computed.displayedRecommendations.call(watch), offline)
    watch.offlineDownloadSuggestions = []
    assert.equal(computed.displayedRecommendations.call(watch).length, 0)
    handleDownloadConnectionChange.call(watch, { detail: 'online' })
    assert.equal(computed.displayedRecommendations.call(watch), online)
    assert.equal(watch.localFilePlayback, localFilePlayback)
  })
}

test('offline playlist entries do not reuse another video’s record thumbnail', () => {
  const watch = {
    videoId: 'current',
    $store: { getters: { getYtDlpDownloads: {
      1: { id: 1, status: 'completed', mode: 'video', videoId: 'first', thumbnail: 'data:image/png;base64,first', files: [
        { videoId: 'first', path: '/first.mp4' },
        { videoId: 'second', path: '/second.mp4' },
      ] },
    } } },
  }
  const suggestions = computed.offlineDownloadSuggestions.call(watch)
  assert.equal(suggestions[0].thumbnail, 'data:image/png;base64,first')
  assert.equal(suggestions[1].thumbnail, '')
})

test('external single-media downloads retain their thumbnail without a record video ID', () => {
  const watch = {
    videoId: 'current',
    $store: { getters: { getYtDlpDownloads: {
      1: { id: 1, status: 'completed', mode: 'video', videoId: '', thumbnail: 'data:image/png;base64,external',
        retryPayload: { externalUrl: 'https://example.com/video' },
        files: [{ videoId: 'external001', path: '/external.mp4' }] },
      2: { id: 2, status: 'completed', mode: 'video', videoId: '', playlistId: 'playlist', thumbnail: 'data:image/png;base64,playlist',
        files: [{ videoId: 'playlist001', path: '/playlist.mp4' }] },
    } } },
  }
  const suggestions = computed.offlineDownloadSuggestions.call(watch)
  assert.equal(suggestions.find(video => video.videoId === 'external001').thumbnail, 'data:image/png;base64,external')
  assert.equal(suggestions.find(video => video.videoId === 'playlist001').thumbnail, '')
})
