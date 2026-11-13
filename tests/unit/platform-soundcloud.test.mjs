import assert from 'node:assert/strict'
import test from 'node:test'

import soundcloud, { resetSoundCloudClientId } from '../../src/platforms/soundcloud.js'

const API = 'https://api-v2.soundcloud.com'
const CLIENT_A = 'A'.repeat(32)
const CLIENT_B = 'B'.repeat(32)

const HOME = `<html><body>
<script crossorigin src="https://a-v2.sndcdn.com/assets/1-early.js"></script>
<script src="https://cdn.example.test/other.js"></script>
<script crossorigin src="https://a-v2.sndcdn.com/assets/2-app.js"></script>
<script crossorigin src="https://a-v2.sndcdn.com/assets/3-late.js"></script>
</body></html>`

const USER = {
  kind: 'user',
  id: 183,
  username: 'Artist',
  permalink: 'artist',
  permalink_url: 'https://soundcloud.com/artist',
  avatar_url: 'https://i1.sndcdn.com/avatars-183-large.jpg',
  description: ' About the artist ',
  followers_count: 1200,
  visuals: { visuals: [{ visual_url: 'https://i1.sndcdn.com/visuals-183-original.jpg' }] }
}

function track(id, overrides = {}) {
  return {
    kind: 'track',
    id,
    title: `Track ${id}`,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
    artwork_url: `https://i1.sndcdn.com/artworks-${id}-large.jpg`,
    duration: 185_400,
    playback_count: 12,
    display_date: '2026-01-02T10:00:00Z',
    created_at: '2025-12-01T10:00:00Z',
    sharing: 'public',
    public: true,
    user: { kind: 'user', id: 183, username: 'Artist', avatar_url: 'https://i1.sndcdn.com/avatars-183-large.jpg' },
    ...overrides
  }
}

/**
 * Answers the web page, its scripts and the API routes, which get the parsed
 * request URL. The API rejects other client IDs than `state.clientId`, which
 * the app script holds.
 */
function fakeSoundCloud(routes, state = { clientId: CLIENT_A }) {
  const requests = []
  const fetcher = async (url, init) => {
    requests.push(url)
    assert.equal(init.credentials, 'omit')
    assert.ok(init.signal instanceof AbortSignal)
    const parsed = new URL(url)
    if (url === 'https://soundcloud.com/') return new Response(HOME)
    if (parsed.pathname === '/assets/1-early.js') return new Response(`a={client_id:"${'Z'.repeat(32)}"}`)
    if (parsed.pathname === '/assets/2-app.js') return new Response(`e={client_id:"${state.clientId}",env:"production"}`)
    if (parsed.pathname === '/assets/3-late.js') return new Response('g={client_id:"984739005367.apps.googleusercontent.com"}')
    if (parsed.origin !== API) return new Response('', { status: 404 })
    if (parsed.searchParams.get('client_id') !== state.clientId) return new Response('', { status: 401 })
    const route = routes[parsed.pathname]
    return route ? Response.json(route(parsed)) : new Response('', { status: 404 })
  }
  return { fetcher, requests, state }
}

test.beforeEach(() => resetSoundCloudClientId())

test('reads channels from SoundCloud addresses only', () => {
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com/Artist'), 'artist')
  assert.equal(soundcloud.parseChannelUrl('https://m.soundcloud.com/artist/popular-tracks'), 'artist')
  assert.equal(soundcloud.parseChannelUrl('soundcloud.com/artist/sets/'), 'artist')
  assert.equal(soundcloud.parseChannelUrl('https://www.soundcloud.com/artist/tracks?page=2#top'), 'artist')
  // All-digit permalinks would read as user IDs
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com/123'), '@123')
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com/artist/track-1'), null)
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com/artist/sets/mix'), null)
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com/discover'), null)
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com/'), null)
  assert.equal(soundcloud.parseChannelUrl('https://soundcloud.com.example.test/artist'), null)
  assert.equal(soundcloud.parseChannelUrl('https://user:pass@soundcloud.com/artist'), null)
  assert.equal(soundcloud.parseChannelUrl('artist'), null)
})

test('finds the client ID in the last app script that has one and looks up channels', async () => {
  const { fetcher, requests } = fakeSoundCloud({
    '/resolve': url => url.searchParams.get('url') === 'https://soundcloud.com/artist' ? USER : null,
    '/users/183': () => USER
  })

  const channel = await soundcloud.getChannel(fetcher, 'artist')

  assert.deepEqual(channel, {
    platform: 'soundcloud',
    id: '183',
    name: 'Artist',
    url: 'https://soundcloud.com/artist',
    avatar: 'https://i1.sndcdn.com/avatars-183-t500x500.jpg',
    banner: 'https://i1.sndcdn.com/visuals-183-original.jpg',
    description: 'About the artist',
    followerCount: 1200
  })
  assert.deepEqual(requests.slice(0, 3), [
    'https://soundcloud.com/',
    'https://a-v2.sndcdn.com/assets/3-late.js',
    'https://a-v2.sndcdn.com/assets/2-app.js'
  ])
  assert.equal(new URL(requests[3]).searchParams.get('client_id'), CLIENT_A)

  // The client ID is kept
  assert.equal((await soundcloud.getChannel(fetcher, '183'))?.id, '183')
  assert.equal(requests.length, 5)
  assert.equal(new URL(requests[4]).pathname, '/users/183')

  assert.equal(await soundcloud.getChannel(fetcher, 'unknown'), null)
  assert.equal(await soundcloud.getChannel(fetcher, '../users/183'), null)
  assert.equal(requests.length, 6)
})

test('gets a new client ID once when SoundCloud rejects the cached one', async () => {
  const { fetcher, requests, state } = fakeSoundCloud({ '/users/183': () => USER })
  await soundcloud.getChannel(fetcher, '183')
  state.clientId = CLIENT_B

  assert.equal((await soundcloud.getChannel(fetcher, '183'))?.id, '183')
  assert.equal(requests.filter(url => url === 'https://soundcloud.com/').length, 2)
  assert.deepEqual(requests.filter(url => new URL(url).origin === API).map(url => new URL(url).searchParams.get('client_id')),
    [CLIENT_A, CLIENT_A, CLIENT_B])

  // An ID that the API keeps rejecting fails instead of looping
  const rejecting = fakeSoundCloud({}, { clientId: 'none' })
  await assert.rejects(soundcloud.getChannel(rejecting.fetcher, '183'), /HTTP 401/)
})

test('pages through the tracks of a channel, newest first for the feed', async () => {
  const next = `${API}/users/183/tracks?offset=2026-01-01T00%3A00%3A00.000Z%2Ctracks%2C1&limit=20`
  const pages = {
    // Empty in the middle of the list
    '2026-01-01T00:00:00.000Z,tracks,1': { collection: [], next_href: `${API}/users/183/tracks?offset=older&limit=20` },
    older: { collection: [track(0, { display_date: '2025-01-01T10:00:00Z' })], next_href: null }
  }
  const { fetcher, requests } = fakeSoundCloud({
    '/users/183/tracks': url => url.searchParams.has('offset')
      ? pages[url.searchParams.get('offset')]
      : {
          collection: [
            track(1, { display_date: '2026-01-01T10:00:00Z', artwork_url: null }),
            track(2, { sharing: 'private' }),
            track(3, { display_date: '2026-01-03T10:00:00Z', permalink_url: 'https://example.test/track-3' }),
            track(4, { display_date: '2026-01-04T10:00:00Z' })
          ],
          next_href: next
        }
  })
  const channel = { platform: 'soundcloud', id: '183', name: 'Artist', url: 'https://soundcloud.com/artist' }

  const page = await soundcloud.getChannelPage(fetcher, channel, 'tracks', null, AbortSignal.timeout(1000))

  assert.deepEqual(page.results[0], {
    kind: 'item',
    item: {
      platform: 'soundcloud',
      id: '1',
      url: 'https://soundcloud.com/artist/track-1',
      title: 'Track 1',
      author: 'Artist',
      channelId: '183',
      thumbnail: 'https://i1.sndcdn.com/avatars-183-t500x500.jpg',
      published: Date.parse('2026-01-01T10:00:00Z'),
      duration: 185,
      viewCount: 12,
      isAudio: true
    }
  })
  // Without the private track and the one that isn't on SoundCloud
  assert.deepEqual(page.results.map(result => result.item.id), ['1', '4'])
  assert.equal(page.continuation, next)

  const last = await soundcloud.getChannelPage(fetcher, channel, 'tracks', page.continuation)
  const [skipped, request] = requests.slice(-2).map(url => new URL(url))
  assert.equal(skipped.searchParams.get('offset'), '2026-01-01T00:00:00.000Z,tracks,1')
  assert.equal(request.searchParams.get('offset'), 'older')
  assert.equal(request.searchParams.get('client_id'), CLIENT_A)
  assert.equal(request.searchParams.get('linked_partitioning'), '1')
  assert.deepEqual(last.results.map(result => result.item.id), ['0'])
  assert.equal(last.continuation, null)

  // A list that keeps coming back empty stops after a few pages, and offers the next one
  let emptyPages = 0
  const endless = fakeSoundCloud({
    '/users/183/tracks': () => ({ collection: [], next_href: `${API}/users/183/tracks?offset=${++emptyPages}` })
  })
  const empty = await soundcloud.getChannelPage(endless.fetcher, channel, 'tracks', null)
  assert.deepEqual(empty.results, [])
  assert.equal(new URL(empty.continuation).searchParams.get('offset'), String(emptyPages))

  await assert.rejects(soundcloud.getChannelPage(fetcher, channel, 'tracks', 'https://example.test/users/183/tracks'), /continuation/)
  await assert.rejects(soundcloud.getChannelPage(fetcher, channel, 'tracks', `${API}/users/184/tracks`), /continuation/)

  assert.deepEqual((await soundcloud.getLatestItems(fetcher, channel)).map(item => item.id), ['4', '1'])
})

test('fills the bare tracks of a set a page at a time', async () => {
  const tracks = [track(1), track(2), ...Array.from({ length: 60 }, (_, index) => ({ kind: 'track', id: index + 3 }))]
  const playlist = {
    kind: 'playlist',
    id: 777,
    title: 'Night Mix',
    permalink_url: 'https://soundcloud.com/artist/sets/night-mix',
    artwork_url: null,
    track_count: 62,
    sharing: 'public',
    user: { id: 183, username: 'Artist' },
    tracks
  }
  const idRequests = []
  const { fetcher, requests } = fakeSoundCloud({
    '/resolve': url => url.searchParams.get('url') === 'https://soundcloud.com/artist/sets/night-mix' ? playlist : null,
    '/playlists/777': () => playlist,
    '/tracks': url => {
      const ids = url.searchParams.get('ids').split(',').map(Number)
      idRequests.push(ids)
      // In another order, and without a deleted track
      return ids.filter(id => id !== 60).reverse().map(id => track(id))
    }
  })

  const first = await soundcloud.getPlaylist(fetcher, 'artist/sets/night-mix', null)

  assert.deepEqual(first.playlist, {
    platform: 'soundcloud',
    id: '777',
    url: 'https://soundcloud.com/artist/sets/night-mix',
    title: 'Night Mix',
    author: 'Artist',
    channelId: '183',
    thumbnail: 'https://i1.sndcdn.com/artworks-1-t500x500.jpg',
    itemCount: 62
  })
  assert.deepEqual(first.page.results.map(result => result.item.id), Array.from({ length: 50 }, (_, index) => String(index + 1)))
  assert.deepEqual(idRequests[0], Array.from({ length: 48 }, (_, index) => index + 3))
  assert.equal(first.page.continuation, '50')

  const second = await soundcloud.getPlaylist(fetcher, '777', first.page.continuation)
  assert.equal(new URL(requests.at(-2)).pathname, '/playlists/777')
  assert.deepEqual(second.page.results.map(result => result.item.id),
    ['51', '52', '53', '54', '55', '56', '57', '58', '59', '61', '62'])
  assert.equal(second.page.continuation, null)

  await assert.rejects(soundcloud.getPlaylist(fetcher, '777', 'https://example.test/'), /continuation/)
  assert.deepEqual(await soundcloud.getPlaylist(fetcher, 'artist/sets/unknown', null),
    { playlist: null, page: { results: [], continuation: null } })

  // A page whose tracks are all gone is skipped
  const gone = fakeSoundCloud({
    '/playlists/778': () => ({ ...playlist, id: 778, tracks: Array.from({ length: 60 }, (_, index) => ({ kind: 'track', id: index + 1 })) }),
    '/tracks': url => url.searchParams.get('ids').split(',').map(Number).filter(id => id > 50).map(id => track(id))
  })
  const rest = await soundcloud.getPlaylist(gone.fetcher, '778', null)
  assert.deepEqual(rest.page.results.map(result => result.item.id), Array.from({ length: 10 }, (_, index) => String(index + 51)))
  assert.equal(rest.page.continuation, null)
})

test('searches tracks, channels and sets', async () => {
  const routes = {
    '/search/tracks': () => ({ collection: [track(5)], next_href: `${API}/search/tracks?q=night&offset=20&limit=20` }),
    '/search/users': () => ({ collection: [USER], next_href: null }),
    '/search/playlists': () => ({
      collection: [{
        kind: 'playlist',
        id: 9,
        title: 'Set',
        permalink_url: 'https://soundcloud.com/artist/sets/set',
        artwork_url: 'https://i1.sndcdn.com/artworks-9-large.jpg',
        track_count: 3,
        user: { id: 183, username: 'Artist' }
      }, { kind: 'playlist', id: 10, title: 'Secret', permalink_url: 'https://soundcloud.com/artist/sets/secret', sharing: 'private' }],
      next_href: null
    })
  }
  const { fetcher, requests } = fakeSoundCloud(routes)

  const tracks = await soundcloud.search(fetcher, ' night ', 'tracks', null)
  assert.deepEqual(tracks.results.map(result => [result.kind, result.item.id]), [['item', '5']])
  assert.equal(new URL(requests.at(-1)).searchParams.get('q'), 'night')
  assert.equal(tracks.continuation, `${API}/search/tracks?q=night&offset=20&limit=20`)

  const channels = await soundcloud.search(fetcher, 'night', 'channels', null)
  assert.deepEqual(channels.results.map(result => [result.kind, result.channel.id]), [['channel', '183']])
  assert.equal(channels.continuation, null)

  const sets = await soundcloud.search(fetcher, 'night', 'playlists', null)
  assert.deepEqual(sets.results, [{
    kind: 'playlist',
    playlist: {
      platform: 'soundcloud',
      id: '9',
      url: 'https://soundcloud.com/artist/sets/set',
      title: 'Set',
      author: 'Artist',
      channelId: '183',
      thumbnail: 'https://i1.sndcdn.com/artworks-9-t500x500.jpg',
      itemCount: 3
    }
  }])

  const count = requests.length
  assert.deepEqual(await soundcloud.search(fetcher, '  ', 'tracks', null), { results: [], continuation: null })
  assert.equal(requests.length, count)
})
