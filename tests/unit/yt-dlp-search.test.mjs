import assert from 'node:assert/strict'
import test from 'node:test'
import { buildYtDlpSearchArguments, normalizeYtDlpSearchResults } from '../../src/ytDlpSearch.js'

test('preserves the query and YouTube.js filter encoding in paginated search URLs', () => {
  const query = 'age restricted search & --cookies other'
  const args = buildYtDlpSearchArguments(query, 'EgIQAQ%3D%3D', 2)
  const url = new URL(args.at(-1))
  assert.equal(url.origin, 'https://www.youtube.com')
  assert.equal(url.searchParams.get('search_query'), query)
  assert.equal(url.searchParams.get('sp'), 'EgIQAQ==')
  assert.equal(args[args.indexOf('--playlist-start') + 1], '21')
  assert.equal(args[args.indexOf('--playlist-end') + 1], '40')
  assert.ok(args.includes('--ignore-config'))
  assert.ok(args.includes('--flat-playlist'))
})

test('rejects invalid search requests before launching yt-dlp', () => {
  for (const query of ['', ' ', null, 'a'.repeat(101)]) {
    assert.throws(() => buildYtDlpSearchArguments(query))
  }
  for (const page of [0, -1, 1.5, 101, '1']) {
    assert.throws(() => buildYtDlpSearchArguments('query', '', page))
  }
  assert.throws(() => buildYtDlpSearchArguments('query', '%bad'))
})

test('maps flat search videos and skips invalid entries', () => {
  const info = { entries: [null, { id: 'invalid', title: 'Invalid' }, {
    id: 'dQw4w9WgXcQ', title: 'Search result', channel: 'Creator', channel_id: 'UCcreator',
    duration: 120, view_count: 42, timestamp: 100, thumbnails: [{ url: 'https://i.ytimg.com/example.jpg' }]
  }] }
  const { results, hasMoreResults } = normalizeYtDlpSearchResults(info)
  assert.equal(results.length, 1)
  assert.equal(results[0].videoId, 'dQw4w9WgXcQ')
  assert.equal(results[0].title, 'Search result')
  assert.equal(results[0].author, 'Creator')
  assert.equal(results[0].lengthSeconds, 120)
  assert.equal(results[0].published, 100_000)
  assert.equal(results[0].videoThumbnails[0].url, info.entries[2].thumbnails[0].url)
  assert.equal(hasMoreResults, false)
})

test('marks full pages for continuation and empty pages as exhausted', () => {
  assert.equal(normalizeYtDlpSearchResults({ entries: Array(20).fill({ id: 'dQw4w9WgXcQ', title: 'Video' }) }).hasMoreResults, true)
  assert.equal(normalizeYtDlpSearchResults({ entries: [] }).hasMoreResults, false)
  assert.throws(() => normalizeYtDlpSearchResults({}))
})

test('maps channel and playlist results into the existing list data formats', () => {
  const { results } = normalizeYtDlpSearchResults({ entries: [
    { id: 'UC' + 'x'.repeat(22), title: 'Creator', channel_follower_count: 42, thumbnails: [{ url: 'https://example.test/avatar' }] },
    { id: 'PLplaylist', ie_key: 'YoutubeTab', title: 'Playlist', channel: 'Creator', channel_id: 'UCcreator', playlist_count: 3, thumbnails: [{ url: 'https://example.test/playlist' }] }
  ] })
  assert.equal(results[0].type, 'channel')
  assert.equal(results[0].authorThumbnails[0].url, 'https://example.test/avatar')
  assert.equal(results[0].subCount, 42)
  assert.equal(results[1].type, 'playlist')
  assert.equal(results[1].playlistThumbnail, 'https://example.test/playlist')
  assert.equal(results[1].authorId, 'UCcreator')
  assert.equal(results[1].videoCount, 3)
})
