import assert from 'node:assert/strict'
import test from 'node:test'

import { createDiscoveryApi } from '../../src/renderer/helpers/api/createDiscoveryApi.js'

function makeApi(overrides = {}) {
  const calls = []
  const api = createDiscoveryApi({
    searchLocal: async (...args) => { calls.push(['local', ...args]); return { results: [{ id: 'local' }], continuationData: { token: 'next' } } },
    continueLocal: async (...args) => { calls.push(['continuation', ...args]); return { results: [{ id: 'next' }], continuationData: null } },
    cacheLocalContinuation: continuation => JSON.stringify(continuation),
    searchInvidious: async (...args) => { calls.push(['invidious', ...args]); return [{ id: 'invidious' }] },
    getTrendingLocal: async (...args) => { calls.push(['trending', ...args]); return [{ id: 'trending' }] },
    getPopularInvidious: async () => { calls.push(['popular']); return [{ id: 'popular' }] },
    getChannelLocal: async () => ({ thumbnailUrl: 'local-thumbnail' }),
    getChannelInvidious: async () => ({ authorThumbnails: [{ url: 'invidious-thumbnail' }] }),
    youtubeImageToInvidious: (url, instance) => `${instance}/yt/${url}`,
    invidiousImageToInvidious: (url, instance) => `${instance}/iv/${url}`,
    ...overrides,
  })
  return { api, calls }
}

const search = { query: 'example', searchSettings: { type: 'all' }, safetyMode: true, page: 1 }

test('discovery search returns provider-neutral pagination state for Local and Invidious', async () => {
  const { api, calls } = makeApi()
  const local = await api.search({ ...search, preference: 'local' })
  assert.deepEqual(local, {
    provider: 'local', items: [{ id: 'local' }], continuation: { token: 'next' },
    cacheableContinuation: '{"token":"next"}', nextPage: 1, hasMore: true,
  })
  const invidious = await api.search({ ...search, preference: 'invidious' })
  assert.deepEqual(invidious, {
    provider: 'invidious', items: [{ id: 'invidious' }], continuation: null,
    cacheableContinuation: null, nextPage: 2, hasMore: true,
  })
  assert.deepEqual(calls, [
    ['local', 'example', { type: 'all' }, true],
    ['invidious', 'example', 1, { type: 'all' }],
  ])
})

test('discovery search continues the selected provider and marks exhausted pages', async () => {
  const { api, calls } = makeApi()
  const local = await api.search({ ...search, preference: 'local', provider: 'local', continuation: 'saved cursor' })
  assert.equal(local.hasMore, false)
  assert.equal(local.cacheableContinuation, null)
  const invidious = await api.search({ ...search, preference: 'invidious', provider: 'invidious', page: 3 })
  assert.equal(invidious.nextPage, 4)
  assert.deepEqual(calls, [
    ['continuation', 'saved cursor'],
    ['invidious', 'example', 3, { type: 'all' }],
  ])
})

test('discovery search reports the original provider error then falls back once', async () => {
  const failure = new Error('Local failed')
  const fallbackFailure = new Error('Invidious failed')
  const events = []
  const { api } = makeApi({
    searchLocal: async () => { throw failure },
    searchInvidious: async () => [{ id: 'fallback' }],
  })
  const result = await api.search({ ...search, preference: 'local', fallbackEnabled: true,
    onProviderError: (provider, error) => events.push([provider, error]),
    onFallback: (from, to) => events.push([from, to]),
  })
  assert.equal(result.provider, 'invidious')
  assert.deepEqual(events, [['local', failure], ['local', 'invidious']])

  const failed = makeApi({
    searchLocal: async () => { throw failure },
    searchInvidious: async () => { throw fallbackFailure },
  }).api
  await assert.rejects(failed.search({ ...search, preference: 'local', fallbackEnabled: true,
    onProviderError: (provider, error) => events.push([provider, error]),
  }), error => error === fallbackFailure)
  assert.deepEqual(events.slice(-2), [['local', failure], ['invidious', fallbackFailure]])
})

test('discovery search only falls back from the preferred provider when available', async () => {
  const failure = new Error('Invidious failed')
  let localCalls = 0
  const { api } = makeApi({
    searchInvidious: async () => { throw failure },
    searchLocal: async () => { localCalls++; return { results: [], continuationData: null } },
  })
  await assert.rejects(api.search({ ...search, preference: 'invidious', fallbackEnabled: true, localAvailable: false }), error => error === failure)
  assert.equal(localCalls, 0)
  const result = await api.search({ ...search, preference: 'invidious', fallbackEnabled: true, localAvailable: true })
  assert.equal(result.provider, 'local')
  assert.equal(localCalls, 1)
})

test('discovery API keeps single-provider feeds and channel thumbnails behind the same boundary', async () => {
  const { api, calls } = makeApi()
  assert.deepEqual(await api.getTrending('US', 'gaming'), [{ id: 'trending' }])
  assert.deepEqual(await api.getPopular(), [{ id: 'popular' }])
  assert.equal(await api.getSubscriptionChannelThumbnail('channel', 'local'), 'local-thumbnail')
  assert.equal(await api.getSubscriptionChannelThumbnail('channel', 'invidious'), 'invidious-thumbnail')
  assert.deepEqual(calls, [['trending', 'US', 'gaming'], ['popular']])
})

test('discovery API preserves subscription thumbnail routing and invalid imports', () => {
  const { api } = makeApi()
  assert.equal(api.formatSubscriptionThumbnail(null, 'local', 'https://iv.test'), null)
  assert.equal(api.formatSubscriptionThumbnail('not a url', 'local', 'https://iv.test'), null)
  assert.equal(api.formatSubscriptionThumbnail('//yt3.ggpht.com/a=s88-c', 'local', 'https://iv.test'), 'https://yt3.ggpht.com/a=s176-c')
  assert.equal(api.formatSubscriptionThumbnail('https://yt3.ggpht.com/a=s88-c', 'invidious', 'https://iv.test'), 'https://iv.test/yt/https://yt3.ggpht.com/a=s176-c')
  assert.equal(api.formatSubscriptionThumbnail('https://other.test/ggpht/avatar=s88-c', 'local', 'https://iv.test'), 'https://yt3.ggpht.com/avatar=s176-c')
  assert.equal(api.formatSubscriptionThumbnail('https://other.test/ggpht/avatar=s88-c', 'invidious', 'https://iv.test'), 'https://iv.test/iv/https://other.test/ggpht/avatar=s176-c')
})

test('discovery API reports Trending support for the same provider settings as navigation', () => {
  const { api } = makeApi()
  assert.equal(api.supportsTrending(true, 'local', false), true)
  assert.equal(api.supportsTrending(true, 'invidious', true), true)
  assert.equal(api.supportsTrending(true, 'invidious', false), false)
  assert.equal(api.supportsTrending(false, 'local', true), false)
})
