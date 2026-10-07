import assert from 'node:assert/strict'
import test from 'node:test'
import { buildYtDlpSearchArguments, normalizeYtDlpSearchResults, completeYtDlpSearchPlaylists } from '../../src/ytDlpSearch.js'

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
  const info = {
    entries: [null, { id: 'invalid', title: 'Invalid' }, {
      id: 'dQw4w9WgXcQ',
      title: 'Search result',
      channel: 'Creator',
      channel_id: 'UCcreator',
      duration: 120,
      view_count: 42,
      timestamp: 100,
      thumbnails: [{ url: 'https://i.ytimg.com/example.jpg' }]
    }]
  }
  const { results, hasMoreResults } = normalizeYtDlpSearchResults(info)
  assert.equal(results.length, 1)
  assert.equal(results[0].videoId, 'dQw4w9WgXcQ')
  assert.equal(results[0].title, 'Search result')
  assert.equal(results[0].author, 'Creator')
  assert.equal(results[0].lengthSeconds, 120)
  assert.equal(results[0].published, 100000)
  assert.equal(results[0].videoThumbnails[0].url, info.entries[2].thumbnails[0].url)
  assert.equal(hasMoreResults, false)
})

test('marks full pages for continuation and empty pages as exhausted', () => {
  assert.equal(normalizeYtDlpSearchResults({ entries: Array(20).fill({ id: 'dQw4w9WgXcQ', title: 'Video' }) }).hasMoreResults, true)
  assert.equal(normalizeYtDlpSearchResults({ entries: [] }).hasMoreResults, false)
  assert.throws(() => normalizeYtDlpSearchResults({}))
})

test('stops continuation at the last supported search page', () => {
  const response = { entries: Array(20).fill({ id: 'dQw4w9WgXcQ', title: 'Video' }) }
  assert.equal(normalizeYtDlpSearchResults(response, 99).hasMoreResults, true)
  assert.equal(normalizeYtDlpSearchResults(response, 100).hasMoreResults, false)
})

test('maps channel and playlist results into the existing list data formats', () => {
  const { results } = normalizeYtDlpSearchResults({
    entries: [
      { id: 'UC' + 'x'.repeat(22), title: 'Creator', channel_follower_count: 42, thumbnails: [{ url: 'https://example.test/avatar' }] },
      { id: 'PLplaylist', ie_key: 'YoutubeTab', title: 'Playlist', channel: 'Creator', channel_id: 'UCcreator', playlist_count: 3, thumbnails: [{ url: 'https://example.test/playlist' }] }
    ]
  })
  assert.equal(results[0].type, 'channel')
  assert.equal(results[0].authorThumbnails[0].url, 'https://example.test/avatar')
  assert.equal(results[0].subCount, 42)
  assert.equal(results[1].type, 'playlist')
  assert.equal(results[1].thumbnail, 'https://example.test/playlist')
  assert.equal(results[1].dataSource, 'local')
  assert.equal(results[1].channelId, 'UCcreator')
  assert.equal(results[1].videoCount, 3)
})

test('does not report a missing playlist count as zero', () => {
  const { results } = normalizeYtDlpSearchResults({ entries: [{
    id: 'PLWgYtX0fBKnQ', ie_key: 'YoutubeTab', title: 'OpenTubeX playlist',
    thumbnails: [{ url: 'https://i.ytimg.com/vi/NIqqE7fdOPU/hq720.jpg' }]
  }] })
  assert.equal(results[0].videoCount, undefined)
  assert.equal(results[0].dataSource, 'local')
  assert.equal(results[0].thumbnail, 'https://i.ytimg.com/vi/NIqqE7fdOPU/hq720.jpg')
})

test('completes flat playlist metadata without replacing a search thumbnail or using the loaded entry count', async () => {
  const { results } = normalizeYtDlpSearchResults({ entries: [
    { id: 'PLmissing', ie_key: 'YoutubeTab', title: 'Missing metadata' },
    { id: 'PLcount', ie_key: 'YoutubeTab', title: 'Missing count', thumbnails: [{ url: 'https://i.ytimg.com/search.jpg' }] },
    { id: 'PLcomplete', ie_key: 'YoutubeTab', title: 'Complete', playlist_count: 0, thumbnails: [{ url: 'https://i.ytimg.com/empty.jpg' }] },
    { id: 'dQw4w9WgXcQ', title: 'Video' }
  ] })
  const requested = []
  const completed = await completeYtDlpSearchPlaylists(results, async id => {
    requested.push(id)
    return { playlist_count: 10, entries: [{ id: 'NIqqE7fdOPU' }], thumbnails: [{ url: 'https://i.ytimg.com/playlist.jpg' }] }
  })
  assert.deepEqual(requested, ['PLmissing', 'PLcount'])
  assert.equal(completed[0].videoCount, 10)
  assert.equal(completed[0].thumbnail, 'https://i.ytimg.com/playlist.jpg')
  assert.equal(completed[1].videoCount, 10)
  assert.equal(completed[1].thumbnail, 'https://i.ytimg.com/search.jpg')
  assert.equal(completed[2].videoCount, 0)
  assert.equal(completed[3], results[3])
})

test('retains search results and an unknown count when playlist metadata cannot be loaded', async () => {
  const { results } = normalizeYtDlpSearchResults({ entries: [{ id: 'PLunavailable', ie_key: 'YoutubeTab', title: 'Unavailable' }] })
  const completed = await completeYtDlpSearchPlaylists(results, async () => { throw new Error('Unavailable') })
  assert.deepEqual(completed, results)
  assert.equal(completed[0].videoCount, undefined)
})

test('limits playlist enrichment to two concurrent lookups on a full playlist page', async () => {
  const { results } = normalizeYtDlpSearchResults({ entries: Array.from({ length: 20 }, (_, index) => ({
    id: `PL${index}`, ie_key: 'YoutubeTab', title: `Playlist ${index}`
  })) })
  let release
  const gate = new Promise(resolve => { release = resolve })
  let active = 0
  let maximumActive = 0
  const pending = completeYtDlpSearchPlaylists(results, async () => {
    active++
    maximumActive = Math.max(maximumActive, active)
    await gate
    active--
    return { playlist_count: 10 }
  })
  try {
    assert.equal(active, 2)
  } finally {
    release()
    await pending
  }
  assert.equal(maximumActive, 2)
  assert.deepEqual((await pending).map(result => result.playlistId), results.map(result => result.playlistId))
  assert.ok((await pending).every(result => result.videoCount === 10))
})

test('aborts active lookups at the shared deadline and leaves queued results intact', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { results } = normalizeYtDlpSearchResults({ entries: Array.from({ length: 20 }, (_, index) => ({
    id: `PL${index}`, ie_key: 'YoutubeTab', title: `Playlist ${index}`,
    thumbnails: [{ url: `https://i.ytimg.com/${index}.jpg` }]
  })) })
  const signals = []
  const pending = completeYtDlpSearchPlaylists(results, async (id, signal) => {
    signals.push(signal)
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  assert.equal(signals.length, 2)
  t.mock.timers.tick(10_000)
  assert.deepEqual(await pending, results)
  assert.equal(signals.length, 2)
  assert.ok(signals.every(signal => signal.aborted))
})
