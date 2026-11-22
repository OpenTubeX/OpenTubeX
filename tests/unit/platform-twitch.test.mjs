import assert from 'node:assert/strict'
import test from 'node:test'

import twitch from '../../src/platforms/twitch.js'

/**
 * Answers GraphQL requests with the data the handler returns for them.
 * @param {(body: { query: string, variables: Record<string, unknown> }) => unknown} handler
 */
function answer(handler) {
  const requests = []
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return Response.json(handler(body))
  }
  return { fetcher, requests }
}

function game(overrides = {}) {
  return {
    slug: 'chess',
    displayName: ' Chess ',
    viewersCount: 1200,
    boxArtURL: 'https://cdn.example.test/chess-285x380.jpg',
    ...overrides
  }
}

function stream(id, broadcaster = { id: '1001', login: 'Streamer', displayName: 'Streamer' }) {
  return {
    id,
    title: `Stream ${id}`,
    createdAt: '2026-01-02T10:00:00Z',
    viewersCount: 50,
    previewImageURL: 'https://cdn.example.test/live.jpg',
    game: { displayName: 'Chess' },
    broadcaster
  }
}

test('searches categories page by page, skips categories without a valid address, and fails without results', async () => {
  const items = [game(), game({ slug: '../directory', displayName: 'Broken' }), ...Array.from({ length: 18 }, (_, index) => game({ slug: `game-${index}`, viewersCount: null }))]
  const { fetcher, requests } = answer(() => ({ data: { searchFor: { games: { cursor: 'MjA=', items } } } }))

  const page = await twitch.search(fetcher, ' chess ', 'categories', null)

  assert.match(requests[0].query, /index: GAME/)
  assert.deepEqual(requests[0].variables, { query: 'chess', cursor: null })
  assert.equal(page.results.length, 19)
  assert.deepEqual(page.results[0], {
    kind: 'category',
    category: {
      platform: 'twitch',
      id: 'chess',
      name: 'Chess',
      url: 'https://www.twitch.tv/directory/category/chess',
      thumbnail: 'https://cdn.example.test/chess-285x380.jpg',
      viewerCount: 1200
    }
  })
  assert.equal('viewerCount' in page.results[1].category, false)
  // The request held a full page, so there can be more
  assert.equal(page.continuation, 'MjA=')

  // A failed field must not look like a search without matches
  const failed = answer(() => ({ errors: [{ message: 'service error', path: ['searchFor', 'games'] }], data: { searchFor: { games: null } } }))
  await assert.rejects(twitch.search(failed.fetcher, 'chess', 'categories', null))
})

test('loads a category with its details and live streams, nothing for unknown ones, and fails without its streams', async () => {
  const details = { description: ' A board game. ', followersCount: 300, tags: [{ localizedName: 'Strategy' }, { localizedName: ' ' }, null] }
  const { fetcher, requests } = answer(({ variables }) => variables.slug === 'chess'
    ? { data: { game: { ...game(), ...details, streams: { edges: [{ node: stream('11', { id: '1001', login: 'Streamer', displayName: 'Streamer', profileImageURL: 'https://cdn.example.test/streamer-70x70.png' }) }, { node: stream('12', null) }, null] } } } }
    : variables.slug === 'refused'
      ? { errors: [{ message: 'failed integrity check', path: ['game', 'streams'] }], data: { game: { ...game(), streams: null } } }
      : { data: { game: null } })

  const result = await twitch.getCategory(fetcher, 'chess', 'live')
  assert.equal(result.category.name, 'Chess')
  assert.equal(result.category.description, 'A board game.')
  assert.equal(result.category.followerCount, 300)
  assert.deepEqual(result.category.tags, ['Strategy'])
  // Without filters, the most watched streams come first
  assert.deepEqual(requests[0].variables.options, { sort: 'VIEWER_COUNT' })
  // The stream without a channel is left out, and each stream shows its channel's avatar
  assert.deepEqual(result.items.map(item => [item.id, item.channelId, item.url, item.isLive, item.authorAvatar]), [
    ['11', '1001', 'https://www.twitch.tv/streamer', true, 'https://cdn.example.test/streamer-70x70.png']
  ])

  assert.equal(await twitch.getCategory(fetcher, 'unknown', 'live'), null)
  assert.equal(await twitch.getCategory(fetcher, 'Not/A Slug', 'live'), null)
  // A failed list is asked for once more before it fails
  await assert.rejects(twitch.getCategory(fetcher, 'refused', 'live'))
  assert.equal(requests.length, 4)
})

test('filters the streams of a category, leaving out languages and tags Twitch does not take', async () => {
  const { fetcher, requests } = answer(() => ({ data: { game: { ...game(), streams: { edges: [] } } } }))

  await twitch.getCategory(fetcher, 'chess', 'live', {
    sort: 'started',
    languages: ['de', 'yue', 'ase', 'other', 'xx'],
    tags: [' Deutsch ', '', 'a'.repeat(26)]
  })
  assert.deepEqual(requests[0].variables.options, {
    sort: 'RECENT',
    broadcasterLanguages: ['DE', 'ZH_HK', 'ASL', 'OTHER'],
    freeformTags: ['Deutsch']
  })

  // Orders of other tabs don't sort streams
  await twitch.getCategory(fetcher, 'chess', 'live', { sort: 'views', languages: [], tags: [] })
  assert.deepEqual(requests[1].variables.options, { sort: 'VIEWER_COUNT' })
})

test('loads the videos and clips of a category with their filters, and retries a list that fails once', async () => {
  const owner = { id: '1001', login: 'Streamer', displayName: 'Streamer', profileImageURL: 'https://cdn.example.test/streamer-70x70.png' }
  const video = { id: '31', title: 'Past broadcast', publishedAt: '2026-01-02T10:00:00Z', lengthSeconds: 3600, viewCount: 5, owner }
  const clip = { slug: 'Funny-Clip_1', title: 'Clip', createdAt: '2026-01-02T10:00:00Z', durationSeconds: 30, viewCount: 9, broadcaster: owner }
  let clipFailures = 1
  const { fetcher, requests } = answer(({ query }) => {
    if (query.includes('clips(')) {
      return clipFailures-- > 0
        ? { errors: [{ message: 'service error', path: ['game', 'clips'] }], data: { game: { ...game(), clips: null } } }
        : { data: { game: { ...game(), clips: { edges: [{ node: clip }, { node: { ...clip, slug: 'x', broadcaster: null } }] } } } }
    }
    return { data: { game: { ...game(), videos: { edges: [{ node: video }] } } } }
  })

  const videos = await twitch.getCategory(fetcher, 'chess', 'videos')
  assert.deepEqual(videos.items.map(item => [item.id, item.url, item.channelId, item.authorAvatar]), [
    ['31', 'https://www.twitch.tv/videos/31', '1001', 'https://cdn.example.test/streamer-70x70.png']
  ])
  // Without filters, every type of video comes, the most viewed first
  assert.deepEqual(requests[0].variables, { slug: 'chess', sort: 'VIEWS', types: null, languages: null })

  await twitch.getCategory(fetcher, 'chess', 'videos', { sort: 'published', type: 'archive', languages: ['de', 'yue'] })
  // Videos name their languages in lowercase
  assert.deepEqual(requests[1].variables, { slug: 'chess', sort: 'TIME', types: ['ARCHIVE'], languages: ['de', 'zh-hk'] })

  const clips = await twitch.getCategory(fetcher, 'chess', 'clips', { sort: 'top_day', languages: ['de'] })
  assert.deepEqual(clips.items.map(item => [item.id, item.url]), [['Funny-Clip_1', 'https://www.twitch.tv/streamer/clip/Funny-Clip_1']])
  assert.equal(requests.length, 4)
  assert.deepEqual(requests[3].variables.criteria, { period: 'LAST_DAY', sort: 'VIEWS_DESC', languages: ['DE'] })

  // Without filters, the most viewed clips of the week come
  clipFailures = 0
  await twitch.getCategory(fetcher, 'chess', 'clips')
  assert.deepEqual(requests[4].variables.criteria, { period: 'LAST_WEEK', sort: 'VIEWS_DESC' })
})

test('suggests stream tags, and fails when Twitch refuses the search', async () => {
  const { fetcher, requests } = answer(() => ({ data: { searchFreeformTags: { edges: [{ node: { tagName: 'Deutsch' } }, { node: { tagName: '' } }, null] } } }))
  assert.deepEqual(await twitch.searchStreamTags(fetcher, ' deu '), ['Deutsch'])
  assert.equal(requests[0].variables.query, 'deu')
  // Nothing Twitch could match needs a request
  assert.deepEqual(await twitch.searchStreamTags(fetcher, '  '), [])
  assert.equal(requests.length, 1)

  const failed = answer(() => ({ errors: [{ message: 'service error' }], data: { searchFreeformTags: null } }))
  await assert.rejects(twitch.searchStreamTags(failed.fetcher, 'deu'))
})

test('loads the most watched categories and filtered live streams, and fails when Twitch refuses either', async () => {
  const { fetcher, requests } = answer(() => ({
    data: {
      games: { edges: [{ node: game() }] },
      streams: { edges: [{ node: stream('21') }] }
    }
  }))
  assert.deepEqual((await twitch.getTopCategories(fetcher)).map(category => category.id), ['chess'])
  assert.deepEqual((await twitch.getLiveStreams(fetcher, { sort: 'relevance', languages: ['de'], tags: ['IRL'] })).map(item => item.id), ['21'])
  assert.deepEqual(requests[1].variables.options, { sort: 'RELEVANCE', broadcasterLanguages: ['DE'], freeformTags: ['IRL'] })

  // Twitch answers like this when it wants an integrity token
  const refused = answer(() => ({
    errors: [{ message: 'failed integrity check', path: ['streams'] }],
    data: { games: null, streams: null }
  }))
  await assert.rejects(twitch.getTopCategories(refused.fetcher))
  await assert.rejects(twitch.getLiveStreams(refused.fetcher))
})
