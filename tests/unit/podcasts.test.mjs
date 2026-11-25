import assert from 'node:assert/strict'
import test from 'node:test'

import { isMediaFileTitle, parseApplePodcastSearch, parsePodcastDuration, withMediaFileMetadata } from '../../src/renderer/helpers/podcasts.js'

test('reads episode durations in seconds and as timestamps', () => {
  assert.equal(parsePodcastDuration('3600'), 3600)
  assert.equal(parsePodcastDuration(' 1:02:03 '), 3723)
  assert.equal(parsePodcastDuration('45:30.6'), 2731)
  for (const invalid of ['', '0', 'one hour', '1:2:3:4', '-5']) {
    assert.equal(parsePodcastDuration(invalid), undefined, invalid)
  }
})

test('reads the podcasts of an Apple Podcasts search that can be followed', () => {
  const show = {
    collectionName: ' Show ',
    artistName: 'Host',
    feedUrl: 'https://podcast.example.test/rss',
    artworkUrl100: 'https://images.example.test/100.jpg',
  }
  assert.deepEqual(parseApplePodcastSearch({
    resultCount: 5,
    results: [
      show,
      // Listed twice
      { ...show, collectionName: 'Show again' },
      // Without a public feed
      { collectionName: 'Private show', artistName: 'Host' },
      { collectionName: 'Unsafe feed', feedUrl: 'javascript:alert(1)' },
      { collectionName: 'Other show', feedUrl: 'http://other.example.test/feed', artworkUrl100: 'file:///etc/passwd' },
    ],
  }), [
    { feedUrl: 'https://podcast.example.test/rss', title: 'Show', author: 'Host', artwork: 'https://images.example.test/100.jpg' },
    { feedUrl: 'http://other.example.test/feed', title: 'Other show', author: '', artwork: null },
  ])
  assert.throws(() => parseApplePodcastSearch({ errorMessage: 'Invalid term' }))
})

test('replaces what yt-dlp knows about a media file with the metadata of its feed', () => {
  const url = 'https://cdn.example.test/shows/Episode%2012.mp3?token=1'
  assert.equal(isMediaFileTitle('Episode 12', url), true)
  assert.equal(isMediaFileTitle('Episode 12.mp3', url), true)
  assert.equal(isMediaFileTitle(null, url), true)
  assert.equal(isMediaFileTitle('A real title', url), false)

  const info = {
    title: 'Episode 12',
    channel: null,
    channelUrl: null,
    channelThumbnail: null,
    thumbnail: null,
    duration: 3600,
    // The file's last modification
    externalMetadata: { timestamp: 1_800_000_000, chapters: [] },
  }
  assert.deepEqual(withMediaFileMetadata(info, {
    title: 'Episode 12: A title',
    creator: 'Example Podcast',
    creatorAvatar: 'https://images.example.test/cover.jpg',
    thumbnail: 'https://images.example.test/episode.jpg',
    published: 1_700_000_000_500,
    duration: 3500,
  }), {
    title: 'Episode 12: A title',
    channel: 'Example Podcast',
    channelUrl: null,
    channelThumbnail: 'https://images.example.test/cover.jpg',
    thumbnail: 'https://images.example.test/episode.jpg',
    // The file's own length wins over the feed's
    duration: 3600,
    externalMetadata: { timestamp: 1_700_000_000, chapters: [] },
  })
})
