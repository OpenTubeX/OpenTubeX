import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { mergeUpcomingSubscriptionFeedPublished } from '../../src/renderer/helpers/subscription-entries.js'

const source = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')

function sliceFunction(signature) {
  const start = source.indexOf(signature)
  const end = source.indexOf('\n}\n', start) + 2
  assert.ok(start >= 0 && end > start, `Update the harness after changing ${signature}`)
  return source.slice(start, end)
}

const harnessSource = [
  sliceFunction('async function enrichScrapedUpcomingPublicationDates('),
  sliceFunction('async function getChannelLiveLocal(')
].join('\n')

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const scheduledTime = Date.parse('2027-01-01T12:00:00Z')
const announcementTime = Date.parse('2026-10-20T12:00:00Z')

function fetchLiveTab(showScheduledLiveStreamsFirst) {
  const requests = []
  const getChannelLiveLocal = vm.runInNewContext(`${harnessSource}; getChannelLiveLocal`, {
    AbortSignal,
    RSS_ENRICHMENT_TIMEOUT_MS: 1000,
    activeRefresh: null,
    store: { getters: { getShowScheduledLiveStreamsFirst: showScheduledLiveStreamsFirst } },
    mergeUpcomingSubscriptionFeedPublished,
    getLocalChannelLiveStreams: async () => ({
      videos: [
        { videoId: 'scheduled', isUpcoming: true, premiereDate: new Date(scheduledTime), published: scheduledTime },
        { videoId: 'past', isUpcoming: false, published: announcementTime }
      ]
    }),
    localApiFetch: async url => {
      requests.push(url)
      return { ok: true, text: async () => '' }
    },
    parseYouTubeRSSPublicationDates: () => [{ videoId: 'scheduled', published: announcementTime }]
  })

  return { requests, result: getChannelLiveLocal({ id: CHANNEL_ID }, key => key, []) }
}

test('adds RSS announcement dates to scheduled Local API live streams when they stay in place', async () => {
  const { requests, result } = fetchLiveTab(false)
  const { videos } = await result

  assert.equal(videos[0].subscriptionFeedPublished, announcementTime)
  assert.equal(videos[1].subscriptionFeedPublished, undefined)
  assert.deepEqual(requests, [`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`])
})

test('skips the RSS lookup for live streams while scheduled entries are shown first', async () => {
  const { requests, result } = fetchLiveTab(true)
  const { videos } = await result

  assert.equal(videos[0].subscriptionFeedPublished, undefined)
  assert.deepEqual(requests, [])
})
