import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterUnavailableInvidiousPlaylistVideos,
  hasMoreInvidiousPlaylistPages,
  mergeInvidiousPlaylistVideos,
} from '../../src/renderer/helpers/api/invidious-playlists.js'

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
  assert.deepEqual(filterUnavailableInvidiousPlaylistVideos([unavailable]), [])
})

test('keeps playlist videos when any identifying metadata is present', () => {
  const videos = [
    { title: 'Untitled channel video', author: '', authorId: null },
    { title: '', author: 'Channel', authorId: null },
    { title: '', author: '', authorId: 'channel-id' }
  ]

  assert.deepEqual(filterUnavailableInvidiousPlaylistVideos(videos), videos)
})

test('merges overlapping Invidious playlist pages by playlist position', () => {
  const firstPage = [
    { index: 0, videoId: 'same-video', title: 'First occurrence' },
    { index: 1, videoId: 'other-video', title: 'Existing item' },
  ]
  const nextPage = [
    { index: 1, videoId: 'other-video', title: 'Overlapping item' },
    { index: 2, videoId: 'same-video', title: 'Second occurrence' },
  ]

  assert.deepEqual(mergeInvidiousPlaylistVideos(firstPage, nextPage), [
    firstPage[0],
    firstPage[1],
    nextPage[1],
  ])
})

test('falls back to video IDs when a playlist response omits positions', () => {
  const firstPage = [{ videoId: 'first-video' }]

  assert.deepEqual(mergeInvidiousPlaylistVideos(firstPage, [
    { videoId: 'first-video' },
    { videoId: 'second-video' },
  ]), [
    firstPage[0],
    { videoId: 'second-video' },
  ])
})

test('bounds later pages by the Invidious page stride', () => {
  assert.equal(hasMoreInvidiousPlaylistPages(250, 1, 200, 200), true)
  assert.equal(hasMoreInvidiousPlaylistPages(250, 2, 250, 200), false)
  assert.equal(hasMoreInvidiousPlaylistPages(250, 3, 200, 200), false)
  assert.equal(hasMoreInvidiousPlaylistPages(300, 1, 0, 100), true)
  assert.equal(hasMoreInvidiousPlaylistPages(300, 1, 100, 0), false)
})
