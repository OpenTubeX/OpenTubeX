import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { parseSubscriptionRss } from '../../src/renderer/helpers/api/feed-rss.js'

const subscriptions = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')

function loadParser(env) {
  const context = vm.createContext({
    process: { env },
    window: { ftElectron: { subscriptionAutoRefresh: { processFeed: async () => { throw new Error('native parser unavailable') } } } },
    parseSubscriptionRss,
    enrichSubscriptionRssEntries: async entries => entries,
  })
  const start = subscriptions.indexOf('export async function parseYouTubeRSSFeed(')
  const end = subscriptions.indexOf('\n/**', start)
  vm.runInContext(subscriptions.slice(start, end).replace('export ', ''), context)
  return context.parseYouTubeRSSFeed
}

const feed = '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><author><name>Channel</name></author>' +
  '<entry><yt:videoId>video</yt:videoId><title>Video</title><published>2026-10-09T10:00:00Z</published></entry></feed>'

for (const env of [{ IS_ELECTRON: true }, {}]) {
  test(`a successful 200 body that is not a feed is reported as a failure (${JSON.stringify(env)})`, async () => {
    const parseYouTubeRSSFeed = loadParser(env)
    assert.equal((await parseYouTubeRSSFeed(feed, 'UCtest')).videos.length, 1)

    // An interstitial, consent or challenge page must not look like a channel
    // without videos, or the refresh would overwrite the cached feed with nothing.
    await assert.rejects(parseYouTubeRSSFeed('<!DOCTYPE html><html><body>Please verify</body></html>', 'UCtest'))
    await assert.rejects(parseYouTubeRSSFeed('', 'UCtest'))
  })
}
