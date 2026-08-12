import assert from 'node:assert/strict'
import test from 'node:test'

import { filterUnavailableInvidiousPlaylistVideos } from '../../src/renderer/helpers/api/invidious-playlists.js'

test('filters unavailable Invidious playlist videos', () => {
  const available = {
    title: 'Available video',
    author: 'Channel',
    authorId: 'channel-id'
  }
  const unavailable = {
    title: '',
    author: '',
    authorId: null,
    videoId: 'unavailable-video'
  }

  assert.deepEqual(
    filterUnavailableInvidiousPlaylistVideos([available, unavailable]),
    [available]
  )
})

test('keeps playlist videos when any identifying metadata is present', () => {
  const videos = [
    { title: 'Untitled channel video', author: '', authorId: null },
    { title: '', author: 'Channel', authorId: null },
    { title: '', author: '', authorId: 'channel-id' }
  ]

  assert.deepEqual(filterUnavailableInvidiousPlaylistVideos(videos), videos)
})
