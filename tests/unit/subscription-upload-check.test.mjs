import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSubscriptionRss } from '../../src/renderer/helpers/api/feed-rss.js'
import { hasNoNewSubscriptionUploads } from '../../src/renderer/helpers/subscriptionUploadCheck.js'

const fetchedAt = Date.parse('2026-01-10T00:00:00Z')

function channelFeed(entries) {
  return `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><author><name>Channel</name></author>${entries.map(({ videoId, path, published }) =>
    `<entry><yt:videoId>${videoId}</yt:videoId><title>Upload</title><link rel="alternate" href="https://www.youtube.com/${path}${videoId}"/><published>${published}</published></entry>`
  ).join('')}</feed>`
}

test('only uploads published since the last fetch count, and only for the feed their link type belongs to', () => {
  const { videos: uploads } = parseSubscriptionRss(channelFeed([
    { videoId: 'newShort', path: 'shorts/', published: '2026-01-11T00:00:00Z' },
    { videoId: 'knownVideo', path: 'watch?v=', published: '2026-01-09T23:30:00Z' },
    // Published long before the last fetch, which did not return it
    { videoId: 'liveRecording', path: 'watch?v=', published: '2026-01-08T00:00:00Z' }
  ]), 'UC0')
  const cache = { timestamp: fetchedAt }
  const known = new Set(['knownVideo'])

  assert.equal(hasNoNewSubscriptionUploads('videos', cache, uploads, known), true)
  assert.equal(hasNoNewSubscriptionUploads('live', cache, uploads, known), true)
  assert.equal(hasNoNewSubscriptionUploads('shorts', cache, uploads, known), false)
  assert.equal(hasNoNewSubscriptionUploads('videos', cache, uploads, new Set()), false, 'uploads shortly before the last fetch may be new')
})

test('a full upload feed that starts after the last fetch may have dropped new uploads', () => {
  const uploads = Array.from({ length: 15 }, (_, index) => ({
    videoId: `short${index}`,
    published: fetchedAt + (index + 1) * 60_000,
    isShort: true
  }))

  assert.equal(hasNoNewSubscriptionUploads('videos', { timestamp: fetchedAt }, uploads, new Set()), false)
  assert.equal(hasNoNewSubscriptionUploads('videos', { timestamp: fetchedAt }, uploads.slice(1), new Set()), true)
})
