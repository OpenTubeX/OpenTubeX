import assert from 'node:assert/strict'
import test from 'node:test'
import { filterVideosWithQuery } from '../../src/renderer/helpers/historySearch.js'

const videos = [
  { title: 'city night walking tour', author: 'Example Channel' },
  { title: 'Another video', author: 'Other creator' },
  { title: 'city river walking tour', author: 'Example Channel' },
]

test('history matches separated and reordered terms while preserving date order', () => {
  assert.deepEqual(filterVideosWithQuery(videos, 'city tour'), [videos[0], videos[2]])
  assert.deepEqual(filterVideosWithQuery(videos, ' tour   city '), [videos[0], videos[2]])
})

test('history matches every term across title and author and tolerates typos', () => {
  assert.deepEqual(filterVideosWithQuery(videos, 'night exmaple'), [videos[0]])
  assert.deepEqual(filterVideosWithQuery(videos, 'night zzzzzz'), [])
})

test('history handles missing metadata and empty queries', () => {
  assert.deepEqual(filterVideosWithQuery([{}, { title: null }], 'night'), [])
  assert.deepEqual(filterVideosWithQuery(videos, '   '), videos)
})

test('history retains case-sensitive matching', () => {
  assert.deepEqual(filterVideosWithQuery(videos, 'City tour', true), [])
  assert.deepEqual(filterVideosWithQuery(videos, 'city tour', true), [videos[0], videos[2]])
})

test('history normalizes case and accents for the default search', () => {
  const records = [{ title: 'Résumé vidéo', author: 'Créateur' }]
  assert.deepEqual(filterVideosWithQuery(records, 'VIDEO resume'), records)
  assert.deepEqual(filterVideosWithQuery(records, 'resume', true), [])
})
