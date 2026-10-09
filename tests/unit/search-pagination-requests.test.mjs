import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/views/SearchPage/SearchPage.vue', import.meta.url), 'utf8')
const start = source.indexOf('function checkSearchCache(')
const end = source.indexOf('/**\n * @param {any[]} results', start)
assert.ok(start >= 0 && end > start, 'Update the harness after changing the search handler boundaries')
const handlers = source.slice(start, end)
const utilsSource = readFileSync(new URL('../../src/renderer/store/modules/utils.js', import.meta.url), 'utf8')
const mutationStart = utilsSource.indexOf('  addToSessionSearchHistory (')
const mutationEnd = utilsSource.indexOf('  setShowAddToPlaylistPrompt (', mutationStart)
assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, 'Update the harness after changing the search cache mutation boundaries')
const addToSessionSearchHistory = vm.runInNewContext(`({
  ${utilsSource.slice(mutationStart, mutationEnd)}
}).addToSessionSearchHistory`, { searchFiltersMatch: () => true })

function deferred () {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function createSearch (backend) {
  const previous = deferred()
  const current = deferred()
  const requests = []
  const errors = []
  const notices = []
  const updatedChannels = []
  const searchSettings = { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] }
  const history = ['previous search', 'cached replacement'].map(query => ({
    query,
    data: [{ id: query }],
    searchSettings,
    nextPageRef: `${query} continuation`,
    searchPage: 2,
    hasMoreResults: true,
    apiUsed: backend
  }))
  const state = {
    query: { value: '' },
    isLoading: { value: false },
    isLoadingMore: { value: false },
    hasMoreResults: { value: true },
    apiUsed: { value: backend },
    localSearchCompleted: { value: false },
    searchSettings: { value: searchSettings },
    searchPage: { value: 1 },
    nextPageRef: { value: null },
    shownResults: { value: [] },
    searchNotice: { value: null },
    searchParams: { value: '' },
    cookieSearchFailed: { value: false },
    isRetryingWithCookies: { value: false }
  }
  const continuation = (...args) => {
    requests.push(args)
    assert.ok(requests.length <= 2, 'a superseded request must not trigger a fallback')
    return requests.length === 1 ? previous.promise : current.promise
  }
  const { checkSearchCache, nextPage } = vm.runInNewContext(`
    let searchRequestId = 0
    ${handlers}
    ;({ checkSearchCache, nextPage })
  `, {
    ...state,
    processedQuery: { get value () { return state.query.value.trim() } },
    sessionSearchHistory: { value: history },
    backendPreference: { value: backend },
    backendFallback: { value: true },
    rememberSearchHistory: { value: false },
    showFamilyFriendlyOnly: { value: false },
    searchFiltersMatch: () => true,
    SEARCH_CHAR_LIMIT: 1000,
    store: {
      commit: (name, payload) => {
        assert.equal(name, 'addToSessionSearchHistory')
        addToSessionSearchHistory({ sessionSearchHistory: history }, payload)
      }
    },
    getLocalSearchContinuation: continuation,
    getLocalSearchResults: async () => ({ results: [], continuationData: null, searchNotice: null, searchParams: 'encoded filters' }),
    getInvidiousSearchResults: continuation,
    extractLocalCacheableSearchContinuation: value => value,
    updateSubscriptionDetails: results => updatedChannels.push(results),
    showApiErrorToast: (...args) => notices.push(args),
    showToast: message => notices.push(message),
    t: text => text,
    console: { error: error => errors.push(error) },
    process: { env: { SUPPORTS_LOCAL_API: true } }
  })
  const select = query => checkSearchCache({ query, searchSettings, options: {} })
  const result = id => backend === 'local'
    ? { results: [{ id }], continuationData: `${id} continuation` }
    : [{ id }]
  return { state, history, previous, current, requests, errors, notices, updatedChannels, select, nextPage, result }
}

test('restores the completed empty Local search after an Invidious pagination fallback', async () => {
  const search = createSearch('invidious')
  search.select('previous search')
  const page = search.nextPage()
  search.previous.reject(new Error('Invidious pagination failed'))
  await page
  assert.equal(search.state.apiUsed.value, 'local')
  assert.equal(search.state.localSearchCompleted.value, true)
  assert.equal(search.state.shownResults.value.length, 0)

  search.select('cached replacement')
  search.select('previous search')
  assert.equal(search.state.apiUsed.value, 'local')
  assert.equal(search.state.localSearchCompleted.value, true)
  assert.equal(search.state.shownResults.value.length, 0)
  assert.equal(search.state.searchParams.value, 'encoded filters')
})

for (const backend of ['local', 'invidious']) {
  for (const outcome of ['success', 'failure']) {
    test(`${backend} ignores a superseded pagination ${outcome} while a cached replacement is loading`, async () => {
      const search = createSearch(backend)
      search.select('previous search')
      const previousPage = search.nextPage()
      search.select('cached replacement')
      const currentPage = search.nextPage()
      assert.equal(search.state.isLoadingMore.value, true)

      if (outcome === 'success') search.previous.resolve(search.result('stale result'))
      else search.previous.reject(new Error('Superseded request failed'))
      await previousPage

      assert.equal(search.state.shownResults.value.map(result => result.id).join(','), 'cached replacement')
      assert.equal(search.state.nextPageRef.value, 'cached replacement continuation')
      assert.equal(search.state.searchPage.value, 2)
      assert.equal(search.state.isLoadingMore.value, true)
      assert.equal(search.history[0].data.length, 1)
      assert.equal(search.history[1].data.length, 1)
      assert.equal(search.requests.length, 2)
      assert.equal(search.errors.length, 0)
      assert.equal(search.notices.length, 0)
      assert.equal(search.updatedChannels.length, 0)

      search.current.resolve(search.result('current result'))
      await currentPage
      assert.equal(search.state.shownResults.value.map(result => result.id).join(','), 'cached replacement,current result')
      assert.equal(search.state.isLoadingMore.value, false)
      assert.equal(search.history[1].data.length, 2)
      assert.equal(search.updatedChannels.length, 1)
      if (backend === 'local') assert.equal(search.state.nextPageRef.value, 'current result continuation')
      else assert.equal(search.state.searchPage.value, 3)
    })
  }
}
