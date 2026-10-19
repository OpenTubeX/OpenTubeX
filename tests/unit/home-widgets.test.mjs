import assert from 'node:assert/strict'
import test from 'node:test'

import { createContinueWatchingWidgetVideos, getHomeWidgetPage } from '../../src/renderer/helpers/homeWidgetData.js'

test('Quick access widget links open only their fixed pages', () => {
  assert.deepEqual(getHomeWidgetPage('opentubex://open/search'), { page: 'search', route: null })
  assert.deepEqual(getHomeWidgetPage('opentubex-nightly://open/subscriptions'), { page: 'subscriptions', route: { path: '/subscriptions' } })
  assert.deepEqual(getHomeWidgetPage('opentubex://open/watch-later'), {
    page: 'watch-later',
    route: { path: '/playlist/watchLater', query: { playlistType: 'user' } }
  })
  for (const url of [
    'opentubex://open/settings', 'opentubex://open/__proto__', 'opentubex://open/search/../settings',
    'opentubex://https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://open/search', '', undefined
  ]) {
    assert.equal(getHomeWidgetPage(url), null, url)
  }
})

test('Continue watching widget keeps the newest valid videos with whole-second progress', () => {
  const entries = [
    { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', watchProgress: 7.9, lengthSeconds: 19 },
    { videoId: 'local-file', title: 'Not a YouTube video', watchProgress: 3, lengthSeconds: 10 },
    { videoId: 'dQw4w9WgXcQ', title: 42, watchProgress: 10, lengthSeconds: 'unknown' },
    ...['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(videoId => ({ videoId, title: videoId, watchProgress: 1, lengthSeconds: 2 })),
  ]
  const videos = createContinueWatchingWidgetVideos(entries, videoId => videoId === 'dQw4w9WgXcQ' ? null : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`)
  assert.deepEqual(videos.map(video => video.videoId), ['jNQXAC9IVRw', 'dQw4w9WgXcQ', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
  assert.deepEqual(videos[0], {
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    author: 'jawed',
    watchProgress: 7,
    lengthSeconds: 19,
    thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg',
  })
  assert.deepEqual(videos[1], { videoId: 'dQw4w9WgXcQ', title: '42', author: '', watchProgress: 10, lengthSeconds: 0, thumbnail: '' })
})
