import assert from 'node:assert/strict'
import test from 'node:test'

import odysee from '../../src/platforms/odysee.js'

const CHANNEL_ID = 'a'.repeat(40)
const PLAYLIST_ID = 'c'.repeat(40)
/** @param {number} index */
const claimId = index => index.toString(16).padStart(40, '0')

function channelClaim(overrides = {}) {
  return {
    value_type: 'channel',
    claim_id: CHANNEL_ID,
    name: '@Creator',
    canonical_url: 'lbry://@Creator#a',
    value: {
      title: 'The Creator',
      description: ' About the channel ',
      thumbnail: { url: 'https://thumbs.example.test/avatar.webp' },
      cover: { url: 'http://thumbs.example.test/cover.webp' }
    },
    ...overrides
  }
}

function streamClaim(id, value = {}, overrides = {}) {
  return {
    value_type: 'stream',
    claim_id: id,
    name: `video-${id.slice(-2)}`,
    canonical_url: `lbry://@Creator#a/video-${id.slice(-2)}#${id.slice(-2)}`,
    timestamp: 1700000100,
    signing_channel: channelClaim(),
    value: {
      title: `Video ${id.slice(-2)}`,
      stream_type: 'video',
      source: { media_type: 'video/mp4' },
      release_time: '1700000000',
      video: { duration: 60 },
      thumbnail: { url: 'https://thumbs.example.test/video.webp' },
      ...value
    },
    ...overrides
  }
}

/**
 * Answers requests with the JSON the handler returns for them.
 * @param {(request: { url: URL, body: any }) => unknown} handler
 */
function fakeFetch(handler) {
  const requests = []
  const fetch = async (url, init) => {
    const request = { url: new URL(url), body: init.body ? JSON.parse(init.body) : null, init }
    requests.push(request)
    return Response.json(handler(request))
  }
  return { fetch, requests }
}

test('reads channel references from channel pages and playlist IDs from playlist pages', () => {
  const { parseChannelUrl, parsePlaylistUrl } = odysee
  assert.equal(parseChannelUrl('https://odysee.com/@Creator:a1?view=content'), '@Creator:a1')
  assert.equal(parseChannelUrl('https://odysee.com/@Creator#A1'), '@Creator:a1')
  assert.equal(parseChannelUrl('https://www.odysee.com/@Creator/'), '@Creator')
  assert.equal(parseChannelUrl('https://odysee.com/@K%C3%BCnstler:5'), '@Künstler:5')
  assert.equal(parseChannelUrl('lbry://@Creator#a1'), '@Creator:a1')
  assert.equal(parseChannelUrl('https://odysee.com/@Creator:a1/video:b2'), null)
  assert.equal(parseChannelUrl('lbry://@Creator#a1/video#b2'), null)
  assert.equal(parseChannelUrl('https://odysee.com/video:b2'), null)
  assert.equal(parseChannelUrl(`https://odysee.com/$/playlist/${PLAYLIST_ID}`), null)
  assert.equal(parseChannelUrl('https://odysee.com/@Creator:xyz'), null)
  assert.equal(parseChannelUrl('https://odysee.com/@Bad%22Name'), null)
  assert.equal(parseChannelUrl('https://odysee.com.example.test/@Creator'), null)
  assert.equal(parseChannelUrl('https://user:pass@odysee.com/@Creator'), null)

  assert.equal(parsePlaylistUrl(`https://odysee.com/$/playlist/${PLAYLIST_ID}?index=2`), PLAYLIST_ID)
  assert.equal(parsePlaylistUrl(`https://odysee.com/$/playlist/${PLAYLIST_ID.slice(1)}`), null)
  assert.equal(parsePlaylistUrl('https://odysee.com/@Creator:a/list:b'), null)
  assert.equal(parsePlaylistUrl(`https://odysee.example.test/$/playlist/${PLAYLIST_ID}`), null)
})

test('looks up channels by claim ID and by name, and finds no unknown channels', async () => {
  const expected = {
    platform: 'odysee',
    id: CHANNEL_ID,
    name: 'The Creator',
    url: 'https://odysee.com/@Creator:a',
    avatar: 'https://thumbs.example.test/avatar.webp',
    description: 'About the channel'
  }
  const { fetch, requests } = fakeFetch(({ body }) => body.method === 'claim_search'
    ? { jsonrpc: '2.0', result: { items: [channelClaim()] } }
    : { jsonrpc: '2.0', result: { [body.params.urls[0]]: body.params.urls[0] === 'lbry://@Creator#a' ? channelClaim() : { error: { name: 'NOT_FOUND' } } } })

  assert.deepEqual(await odysee.getChannel(fetch, CHANNEL_ID), expected)
  assert.deepEqual(await odysee.getChannel(fetch, '@Creator:a'), expected)
  assert.equal(await odysee.getChannel(fetch, '@Missing'), null)
  assert.equal(await odysee.getChannel(fetch, '@Bad"Name'), null)

  assert.deepEqual(requests.map(({ url, body }) => [url.searchParams.get('m'), body.params.claim_ids ?? body.params.urls]), [
    ['claim_search', [CHANNEL_ID]],
    ['resolve', ['lbry://@Creator#a']],
    ['resolve', ['lbry://@Missing']]
  ])
  assert.deepEqual(requests[0].body.params.claim_type, ['channel'])
  assert.ok(requests.every(({ init }) => init.credentials === 'omit' && init.referrerPolicy === 'no-referrer'))

  const failing = fakeFetch(() => ({ jsonrpc: '2.0', error: { code: -32080, message: 'authentication token missing' } }))
  await assert.rejects(odysee.getChannel(failing.fetch, CHANNEL_ID), /authentication token missing/)
})

test('lists the playable videos of a channel page by page', async () => {
  const future = String(Math.floor(Date.now() / 1000) + 3600)
  const items = [
    streamClaim(claimId(1)),
    streamClaim(claimId(2), { fee: { amount: '1', currency: 'LBC' } }),
    streamClaim(claimId(3), { tags: ['c:members-only'] }),
    streamClaim(claimId(4), { stream_type: 'document' }),
    streamClaim(claimId(5), { stream_type: 'audio', release_time: undefined, video: undefined, audio: { duration: 30 } }),
    streamClaim(claimId(6), { release_time: future, tags: ['c:scheduled:hide'] }),
    streamClaim(claimId(7), { release_time: future, tags: ['c:scheduled:show'] })
  ]
  const { fetch, requests } = fakeFetch(({ body }) => ({ result: { items, page: body.params.page, total_pages: 3 } }))
  const channel = { platform: 'odysee', id: CHANNEL_ID, name: 'The Creator', url: 'https://odysee.com/@Creator:a' }

  const first = await odysee.getChannelPage(fetch, channel, 'videos', null)
  assert.equal(first.continuation, '2')
  assert.deepEqual(first.results[0], {
    kind: 'item',
    item: {
      platform: 'odysee',
      id: claimId(1),
      url: 'https://odysee.com/@Creator:a/video-01:01',
      title: 'Video 01',
      author: 'The Creator',
      channelId: CHANNEL_ID,
      thumbnail: 'https://thumbs.example.test/video.webp',
      published: 1700000000000,
      duration: 60
    }
  })
  // Paid, members-only, document and hidden scheduled claims are left out
  assert.deepEqual(first.results.map(result => result.kind === 'item' && result.item.id), [claimId(1), claimId(5), claimId(7)])
  assert.deepEqual(first.results.map(result => result.kind === 'item' && [result.item.published, result.item.isAudio, result.item.isUpcoming]), [
    [1700000000000, undefined, undefined],
    [1700000100000, true, undefined],
    [Number(future) * 1000, undefined, true]
  ])

  const last = await odysee.getChannelPage(fetch, channel, 'videos', '3')
  assert.equal(last.continuation, null)
  assert.deepEqual(requests.map(({ body }) => body.params.page), [1, 3])
  const { channel_ids: channelIds, claim_type: claimType, order_by: orderBy } = requests[0].body.params
  assert.deepEqual({ channelIds, claimType, orderBy }, { channelIds: [CHANNEL_ID], claimType: ['stream'], orderBy: ['release_time'] })

  assert.deepEqual(await odysee.getChannelPage(fetch, channel, 'videos', 'not-a-page'), { results: [], continuation: null })
  assert.equal(requests.length, 2)
})

test('loads playlist items in the order of the playlist', async () => {
  const ids = Array.from({ length: 25 }, (_, index) => claimId(index + 1))
  const collection = {
    value_type: 'collection',
    claim_id: PLAYLIST_ID,
    name: 'favorites',
    canonical_url: 'lbry://@Creator#a/favorites#c',
    signing_channel: channelClaim(),
    value: { title: 'Favorites', claims: ids, thumbnail: { url: 'https://thumbs.example.test/list.webp' } }
  }
  const { fetch, requests } = fakeFetch(({ body }) => {
    if (body.params.claim_ids[0] === PLAYLIST_ID) return { result: { items: [collection] } }
    // claim_search answers in its own order and without deleted claims
    return { result: { items: body.params.claim_ids.filter(id => id !== claimId(2)).map(id => streamClaim(id)).reverse() } }
  })

  const first = await odysee.getPlaylist(fetch, PLAYLIST_ID, null)
  assert.deepEqual(first.playlist, {
    platform: 'odysee',
    id: PLAYLIST_ID,
    url: `https://odysee.com/$/playlist/${PLAYLIST_ID}`,
    title: 'Favorites',
    author: 'The Creator',
    channelId: CHANNEL_ID,
    thumbnail: 'https://thumbs.example.test/list.webp',
    itemCount: 25
  })
  assert.deepEqual(first.page.results.map(result => result.kind === 'item' && result.item.id), ids.slice(0, 20).filter(id => id !== claimId(2)))
  assert.equal(first.page.continuation, '20')

  const second = await odysee.getPlaylist(fetch, PLAYLIST_ID, '20')
  assert.deepEqual(second.page.results.map(result => result.kind === 'item' && result.item.id), ids.slice(20))
  assert.equal(second.page.continuation, null)
  assert.deepEqual(requests.map(({ body }) => body.params.claim_ids.length), [1, 20, 1, 5])
  assert.deepEqual(requests[0].body.params.claim_type, ['collection'])
})

test('searches videos and channels in the order Lighthouse ranks them', async () => {
  const videoIds = Array.from({ length: 20 }, (_, index) => claimId(index + 1))
  const channelIds = [CHANNEL_ID, 'b'.repeat(40)]
  const { fetch, requests } = fakeFetch(({ url, body }) => {
    if (url.hostname === 'lighthouse.odysee.tv') {
      return url.searchParams.get('claimType') === 'file'
        ? videoIds.map(claimId => ({ claimId, name: 'video' }))
        : [...channelIds, 'not-a-claim-id'].map(claimId => ({ claimId, name: '@channel' }))
    }
    const claims = body.params.claim_type[0] === 'stream'
      ? body.params.claim_ids.map(id => streamClaim(id))
      : body.params.claim_ids.map(id => channelClaim({ claim_id: id, name: `@Channel-${id[0]}`, canonical_url: `lbry://@Channel-${id[0]}#${id[0]}` }))
    return { result: { items: claims.reverse() } }
  })

  const videos = await odysee.search(fetch, ' linux tips ', 'videos', null)
  assert.deepEqual(videos.results.map(result => result.kind === 'item' && result.item.id), videoIds)
  assert.equal(videos.continuation, '20')
  const search = requests[0].url.searchParams
  assert.deepEqual([search.get('s'), search.get('from'), search.get('claimType')], ['linux tips', '0', 'file'])

  const channels = await odysee.search(fetch, 'linux', 'channels', '40')
  assert.deepEqual(channels.results.map(result => result.kind === 'channel' && [result.channel.id, result.channel.url]), [
    [CHANNEL_ID, 'https://odysee.com/@Channel-a:a'],
    ['b'.repeat(40), 'https://odysee.com/@Channel-b:b']
  ])
  assert.equal(channels.continuation, null)
  assert.equal(requests[2].url.searchParams.get('from'), '40')
  assert.equal(requests[2].url.searchParams.get('claimType'), 'channel')
  assert.deepEqual(requests[3].body.params.claim_ids, channelIds)

  assert.deepEqual(await odysee.search(fetch, '  ', 'videos', null), { results: [], continuation: null })
  assert.equal(requests.length, 4)
})
