import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPublicationDates,
  fetchMissingPublicationDates
} from '../../src/renderer/helpers/api/missing-publication.js'

const player = (videoId, publishDate) => ({
  videoDetails: { videoId },
  microformat: { playerMicroformatRenderer: { publishDate } }
})

test('fetches publication dates only for videos that lack one', async () => {
  const requested = []
  const dates = await fetchMissingPublicationDates([
    { type: 'video', videoId: 'topic' },
    { type: 'video', videoId: 'dated', published: 1 },
    { type: 'video', videoId: 'live', liveNow: true },
    { type: 'video', videoId: 'upcoming', isUpcoming: true },
    { type: 'video', videoId: 'short', isShort: true },
    { type: 'channel', id: 'channel' },
  ], async videoId => {
    requested.push(videoId)
    return player(videoId, '2020-01-01T00:00:00Z')
  })

  assert.deepEqual(requested, ['topic'])
  assert.deepEqual([...dates], [['topic', Date.parse('2020-01-01T00:00:00Z')]])
})

test('skips videos whose metadata fails, mismatches, or has no date', async () => {
  const dates = await fetchMissingPublicationDates([
    { type: 'video', videoId: 'error' },
    { type: 'video', videoId: 'mismatch' },
    { type: 'video', videoId: 'undated' },
    { type: 'video', videoId: 'ok' },
  ], async videoId => {
    if (videoId === 'error') throw new Error('network')
    if (videoId === 'mismatch') return player('other', '2020-01-01')
    if (videoId === 'undated') return player(videoId, undefined)
    return player(videoId, '2020-01-01')
  })

  assert.deepEqual([...dates], [['ok', Date.parse('2020-01-01')]])
})

test('applies dates to matching undated entries without touching others', () => {
  const undated = { type: 'video', videoId: 'a' }
  const dated = { type: 'video', videoId: 'b', published: 5 }
  const result = applyPublicationDates([undated, dated], new Map([['a', 10], ['b', 20]]))

  assert.deepEqual(result, [{ type: 'video', videoId: 'a', published: 10 }, dated])
  assert.equal(result[1], dated)
  assert.equal(undated.published, undefined)
})
