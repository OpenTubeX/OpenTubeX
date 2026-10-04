import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { nextTick, ref, watch } from 'vue'
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

test('batched search preserves matches and order for a large library', async () => {
  const { filterVideosWithQueryAsync } = await import('../../src/renderer/helpers/historySearch.js')
  const library = Array.from({ length: 5000 }, (_, index) => ({
    title: `Night city tour ${index}`, author: index % 2 ? 'Example Channel' : 'Other Channel',
  }))
  for (const [query, caseSensitive, locale] of [['night exmaple', false, 'en-US'], ['Night', true, 'en-US'], ['tour', false, 'de-DE']]) {
    assert.deepEqual(
      await filterVideosWithQueryAsync(library, query, caseSensitive, locale),
      filterVideosWithQuery(library, query, caseSensitive, locale),
    )
  }
  let cancellationChecks = 0
  assert.equal(await filterVideosWithQueryAsync(library, 'exmaple', false, 'en-US', () => ++cancellationChecks > 1), null)
})

const historySource = await readFile(new URL('../../src/renderer/views/History/History.vue', import.meta.url), 'utf8')
const watcherStart = historySource.indexOf('watch(doCaseSensitiveSearch,')
const caseSensitiveWatcher = historySource.slice(watcherStart, historySource.indexOf('/**', watcherStart))

for (const queryText of ['', '   ', 'City tour']) {
  test(`history case sensitivity only refreshes results for an active query (${JSON.stringify(queryText)})`, async t => {
    const query = ref(queryText)
    const doCaseSensitiveSearch = ref(false)
    let scheduledSearches = 0
    let savedStates = 0
    const stop = compileFunction(`return ${caseSensitiveWatcher}`, ['watch', 'doCaseSensitiveSearch', 'query', 'scheduleHistorySearch', 'saveStateInRouter'])(
      watch, doCaseSensitiveSearch, query,
      () => { scheduledSearches++ }, () => { savedStates++ },
    )
    t.after(stop)

    for (const enabled of [true, false]) {
      doCaseSensitiveSearch.value = enabled
      await nextTick()
      assert.equal(scheduledSearches, queryText.trim() ? savedStates : 0)
    }
    assert.equal(savedStates, 2)
  })
}
