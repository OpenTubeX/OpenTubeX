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

test('searches categories page by page and skips categories without a valid address', async () => {
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
})

test('loads a category with its live streams, nothing for unknown ones, and fails without its streams', async () => {
  const { fetcher, requests } = answer(({ variables }) => variables.slug === 'chess'
    ? { data: { game: { ...game(), streams: { edges: [{ node: stream('11') }, { node: stream('12', null) }, null] } } } }
    : variables.slug === 'refused'
      ? { errors: [{ message: 'failed integrity check', path: ['game', 'streams'] }], data: { game: { ...game(), streams: null } } }
      : { data: { game: null } })

  const result = await twitch.getCategory(fetcher, 'chess')
  assert.equal(result.category.name, 'Chess')
  // The stream without a channel is left out
  assert.deepEqual(result.items.map(item => [item.id, item.channelId, item.url, item.isLive]), [
    ['11', '1001', 'https://www.twitch.tv/streamer', true]
  ])

  assert.equal(await twitch.getCategory(fetcher, 'unknown'), null)
  assert.equal(await twitch.getCategory(fetcher, 'Not/A Slug'), null)
  await assert.rejects(twitch.getCategory(fetcher, 'refused'))
  assert.equal(requests.length, 3)
})

test('browses the most watched categories and streams, and fails when Twitch refuses both', async () => {
  const { fetcher } = answer(() => ({
    data: {
      games: { edges: [{ node: game() }] },
      streams: { edges: [{ node: stream('21') }] }
    }
  }))
  const browse = await twitch.getBrowse(fetcher)
  assert.deepEqual(browse.categories.map(category => category.id), ['chess'])
  assert.deepEqual(browse.items.map(item => item.id), ['21'])

  // Twitch answers like this when it wants an integrity token
  const refused = answer(() => ({
    errors: [{ message: 'failed integrity check', path: ['games'] }, { message: 'failed integrity check', path: ['streams'] }],
    data: { games: null, streams: null }
  }))
  await assert.rejects(twitch.getBrowse(refused.fetcher))
})
