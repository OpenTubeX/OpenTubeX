import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { usesInvidiousApi } from '../../src/apiBackends.js'
import { parseRssUpcomingInfo } from '../../src/renderer/helpers/api/feed-rss.js'

const source = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
const start = source.indexOf('async function fetchRssVideoUpcomingInfoUncached(')
const end = source.indexOf('\n}\n', start) + 2
assert.ok(start >= 0 && end > start, 'Update the harness after changing the premiere lookup')

function lookUp(backend, { supportsLocalApi = true, invidiousVideo = null } = {}) {
  const requests = []
  const fetchUpcomingInfo = vm.runInNewContext(`${source.slice(start, end)}; fetchRssVideoUpcomingInfoUncached`, {
    AbortSignal,
    Date,
    RSS_ENRICHMENT_TIMEOUT_MS: 1000,
    process: { env: { SUPPORTS_LOCAL_API: supportsLocalApi } },
    store: { getters: { getBackendPreference: backend, getApiServerUrl: 'https://invidious.example' } },
    usesInvidiousApi,
    parseRssUpcomingInfo,
    invidiousFetch: async url => {
      requests.push(url)
      return { ok: true, json: async () => invidiousVideo }
    },
    localApiFetch: async url => {
      requests.push(url)
      return { ok: true, text: async () => '"isUpcoming":true,"scheduledStartTime":"1800000000"' }
    },
  })
  return { requests, info: fetchUpcomingInfo('abc') }
}

test('RSS premiere checks stay on the selected Invidious-compatible server', async () => {
  for (const [backend, supportsLocalApi] of [['invidious', true], ['yattee', true], ['local', false]]) {
    const upcoming = lookUp(backend, { supportsLocalApi, invidiousVideo: { videoId: 'abc', isUpcoming: true, premiereTimestamp: 1_800_000_000 } })
    assert.deepEqual({ ...await upcoming.info }, { isUpcoming: true, premiereDate: new Date(1_800_000_000_000) })
    assert.deepEqual(upcoming.requests, ['https://invidious.example/api/v1/videos/abc'])

    const published = lookUp(backend, { supportsLocalApi, invidiousVideo: { videoId: 'abc', isUpcoming: false } })
    assert.deepEqual({ ...await published.info }, { isUpcoming: false })

    const failed = lookUp(backend, { supportsLocalApi, invidiousVideo: { error: 'Video unavailable' } })
    assert.deepEqual({ ...await failed.info }, { isUpcoming: false, failed: true })
  }
})

test('RSS premiere checks use the YouTube watch page with the local API', async () => {
  const { requests, info } = lookUp('local')
  assert.equal((await info).isUpcoming, true)
  assert.deepEqual(requests, ['https://www.youtube.com/watch?v=abc'])
})
