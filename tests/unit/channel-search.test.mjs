import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHANNEL_SEARCH_FILTERS,
  filterChannelSearchResults,
  getInvidiousChannelSearchResultType,
  getLocalChannelSearchResultType,
} from '../../src/renderer/views/Channel/channel-search.js'

test('classifies local channel search results by content type', () => {
  assert.equal(
    getLocalChannelSearchResultType({ type: 'Playlist' }),
    CHANNEL_SEARCH_FILTERS.PLAYLISTS
  )
  assert.equal(
    getLocalChannelSearchResultType({ type: 'Video', is_live: true }),
    CHANNEL_SEARCH_FILTERS.LIVE
  )
  assert.equal(
    getLocalChannelSearchResultType({
      type: 'Video',
      endpoint: { metadata: { url: '/shorts/example' } },
    }),
    CHANNEL_SEARCH_FILTERS.SHORTS
  )
  assert.equal(
    getLocalChannelSearchResultType({
      type: 'Video',
      duration: { seconds: 30 },
    }),
    CHANNEL_SEARCH_FILTERS.VIDEOS
  )
})

test('classifies the content types exposed by Invidious channel search', () => {
  assert.equal(
    getInvidiousChannelSearchResultType({ type: 'playlist' }),
    CHANNEL_SEARCH_FILTERS.PLAYLISTS
  )
  assert.equal(
    getInvidiousChannelSearchResultType({ type: 'video', isUpcoming: true }),
    CHANNEL_SEARCH_FILTERS.LIVE
  )
  assert.equal(
    getInvidiousChannelSearchResultType({ type: 'video', lengthSeconds: 30 }),
    CHANNEL_SEARCH_FILTERS.VIDEOS
  )
})

test('filters channel results without changing their server order', () => {
  const results = [
    { title: 'Video', channelSearchResultType: CHANNEL_SEARCH_FILTERS.VIDEOS },
    { title: 'Short', channelSearchResultType: CHANNEL_SEARCH_FILTERS.SHORTS },
    { title: 'Playlist', channelSearchResultType: CHANNEL_SEARCH_FILTERS.PLAYLISTS },
  ]

  assert.equal(filterChannelSearchResults(results, CHANNEL_SEARCH_FILTERS.ALL), results)
  assert.deepEqual(
    filterChannelSearchResults(results, CHANNEL_SEARCH_FILTERS.SHORTS),
    [results[1]]
  )
})
