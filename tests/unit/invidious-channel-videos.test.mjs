import assert from 'node:assert/strict'
import test from 'node:test'

import {
  enrichFallbackInvidiousPublicationDates,
  usesFallbackInvidiousPublicationDate
} from '../../src/renderer/helpers/api/invidious-channel-videos.js'

const now = Date.parse('2026-08-12T16:00:00Z')

function video(extra = {}) {
  return {
    videoId: 'xLPCqKawpZc',
    published: now - 2 * 60_000,
    viewCount: 0,
    liveNow: false,
    isUpcoming: false,
    ...extra
  }
}

test('detects Invidious current-time publication fallbacks', () => {
  assert.equal(usesFallbackInvidiousPublicationDate(video(), now), true)
  assert.equal(usesFallbackInvidiousPublicationDate(video({ viewCount: 1 }), now), false)
  assert.equal(usesFallbackInvidiousPublicationDate(video({ published: now - 6 * 60_000 }), now), false)
  assert.equal(usesFallbackInvidiousPublicationDate(video({ liveNow: true }), now), false)
  assert.equal(usesFallbackInvidiousPublicationDate(video({ isUpcoming: true }), now), false)
})

test('replaces fallback publication and view metadata with video details', async () => {
  const exactPublishedSeconds = Date.parse('2025-12-30T21:00:06Z') / 1000
  const result = await enrichFallbackInvidiousPublicationDates(
    [video()],
    async videoId => {
      assert.equal(videoId, 'xLPCqKawpZc')
      return {
        published: exactPublishedSeconds,
        publishedText: '7 months ago',
        viewCount: 620_420,
        viewCountText: '620K views'
      }
    },
    now
  )

  assert.deepEqual(result[0], video({
    published: exactPublishedSeconds * 1000,
    publishedText: '7 months ago',
    viewCount: 620_420,
    viewCountText: '620K views',
    isInvidiousPublicationDateEnriched: true
  }))
})

test('does not request details for entries with valid channel metadata', async () => {
  const valid = video({ published: now - 7 * 30 * 24 * 60 * 60_000, viewCount: 620_420 })
  const result = await enrichFallbackInvidiousPublicationDates(
    [valid],
    async () => assert.fail('details should not be requested'),
    now
  )

  assert.equal(result[0], valid)
})

test('keeps channel metadata when video details cannot be fetched', async () => {
  const fallback = video()
  const result = await enrichFallbackInvidiousPublicationDates(
    [fallback],
    async () => { throw new Error('unavailable') },
    now
  )

  assert.equal(result[0], fallback)
})
