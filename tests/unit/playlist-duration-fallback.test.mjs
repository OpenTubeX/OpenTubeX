import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fillMissingPlaylistVideoDurations,
  getRemotePlaylistSortOrderValues,
  getSortedPlaylistItems,
  SORT_BY_VALUES,
} from '../../src/renderer/helpers/playlists.js'

test('fills a missing playlist duration from the matching history entry', () => {
  const playlistItems = [
    { videoId: 'missing-duration', title: 'Missing duration' },
    { videoId: 'known-duration', title: 'Known duration', lengthSeconds: 90 },
  ]
  const historyCacheById = {
    'missing-duration': { videoId: 'missing-duration', lengthSeconds: 125 },
    'known-duration': { videoId: 'known-duration', lengthSeconds: 200 },
  }

  const { items, anyVideoMissingDuration } = fillMissingPlaylistVideoDurations(
    playlistItems,
    historyCacheById
  )

  assert.equal(anyVideoMissingDuration, false)
  assert.equal(items[0].lengthSeconds, 125)
  assert.equal(items[1].lengthSeconds, 90)
  assert.equal(playlistItems[0].lengthSeconds, undefined)
})

test('sorts playlist items by duration and tolerates missing text metadata', () => {
  const videos = [
    { videoId: 'v1', title: 'Beta', author: 'Zed', lengthSeconds: 180 },
    { videoId: 'v2', title: 'Alpha', lengthSeconds: '' },
    { videoId: 'v3', title: 'Gamma', author: 'Abe', lengthSeconds: 45 },
  ]

  assert.deepEqual(
    getSortedPlaylistItems(videos, SORT_BY_VALUES.VideoDurationAscending, 'en-US').map(v => v.videoId),
    ['v2', 'v3', 'v1']
  )
  assert.deepEqual(
    getSortedPlaylistItems(videos, SORT_BY_VALUES.VideoDurationDescending, 'en-US').map(v => v.videoId),
    ['v1', 'v3', 'v2']
  )
  assert.deepEqual(
    getSortedPlaylistItems(videos, SORT_BY_VALUES.AuthorAscending, 'en-US').map(v => v.videoId),
    ['v2', 'v3', 'v1']
  )
})

test('remote playlist sort options omit date-added and include publish dates only when available', () => {
  const withDates = getRemotePlaylistSortOrderValues(true)
  assert.equal(withDates[0], SORT_BY_VALUES.Custom)
  assert.equal(withDates.includes(SORT_BY_VALUES.DateAddedNewest), false)
  assert.equal(withDates.includes(SORT_BY_VALUES.DateAddedOldest), false)
  assert.equal(withDates.includes(SORT_BY_VALUES.PublishedNewest), true)
  assert.equal(withDates.includes(SORT_BY_VALUES.PublishedOldest), true)
  assert.equal(withDates.includes(SORT_BY_VALUES.VideoDurationAscending), true)
  assert.equal(withDates.includes(SORT_BY_VALUES.VideoDurationDescending), true)

  const withoutDates = getRemotePlaylistSortOrderValues(false)
  assert.equal(withoutDates.includes(SORT_BY_VALUES.PublishedNewest), false)
  assert.equal(withoutDates.includes(SORT_BY_VALUES.PublishedOldest), false)
  assert.equal(withoutDates.includes(SORT_BY_VALUES.VideoDurationAscending), true)
  assert.equal(withoutDates.includes(SORT_BY_VALUES.VideoDurationDescending), true)
})
