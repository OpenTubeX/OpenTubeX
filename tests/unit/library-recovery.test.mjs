import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm, { compileFunction } from 'node:vm'
import { computed, ref } from 'vue'
import { filterHistoryByDateAndChannel } from '../../src/renderer/helpers/historyBrowse.js'
import { filterVideosWithQuery, filterVideosWithQueryAsync } from '../../src/renderer/helpers/historySearch.js'
import { load as loadYaml } from 'js-yaml'
import { composeLocaleMessages } from '../../src/localeComposition.js'
import { expandMultipleOnlyPluralMessages, selectPluralForm } from '../../src/renderer/i18n/plurals.js'

const main = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')

test('startup recovery uses translated guidance without querying failed settings', async () => {
  for (const [locale, useAITranslationCompletions] of [['de-DE', true], ['fr-FR', true], ['fr-FR', false], ['fr-FR', undefined]]) {
    let finished
    let message
    let exit
    const failure = Object.assign(new Error('Technical database diagnostic'), { code: 'LIBRARY_MISSING', locale, useAITranslationCompletions })
    const context = vm.createContext({
      path, loadYaml, composeLocaleMessages, expandMultipleOnlyPluralMessages, selectPluralForm,
      __dirname: fileURLToPath(new URL('../../src/main', import.meta.url)),
      process: { env: { NODE_ENV: 'development' } },
      asyncFs: { readFile },
      console,
      baseHandlers: {
        loadDatastores: () => ({ catch: handler => { finished = handler(failure) } }),
        settings: { _findOne: () => { throw new Error('Failed settings must not be queried') } },
      },
      app: { whenReady: async () => {}, getLocale: () => locale, getName: () => 'OpenTubeX', exit: value => { exit = value } },
      dialog: { showErrorBox: (_title, value) => { message = value } },
    })
    vm.runInContext(main.slice(main.indexOf('function getLocaleMessage('), main.indexOf('function printHelp(')), context)
    vm.runInContext(main.slice(main.indexOf('baseHandlers.loadDatastores().catch('), main.indexOf('    runApp()')), context)
    await finished
    const messageLocale = useAITranslationCompletions !== false ? locale : 'en-US'
    const messages = loadYaml(await readFile(new URL(`../../static/locales/${messageLocale === 'fr-FR' ? 'ai/' : ''}${messageLocale}.yaml`, import.meta.url), 'utf8'))
    assert.equal(message, `${messages.Library.CouldNotOpen}\n\n${messages.Library.RestoreProfile}\n\n${failure.message}`)
    assert.equal(exit, 1)
  }
})


test('portable history restores and extends the cached snapshot without datastore paging', async () => {
  const original = Array.from({ length: 10000 }, (_, index) => ({ _id: String(index), videoId: String(index), title: index % 10 ? 'Other video' : 'Markerabc video', author: 'Author', timeWatched: 10000 - index, unknown: new Date(index) }))
  const source = await readFile(new URL('../../src/renderer/views/History/History.vue', import.meta.url), 'utf8')
  for (const oldest of [false, true]) {
    const cached = ref(original), activeData = ref([]), dataLimit = ref(10000), searchDataLimit = ref(100), query = ref('')
    const flags = Object.fromEntries(['isSearching', 'showSearchFeedback', 'historyReadFailed', 'historyPageReadFailed', 'showLoadMoreButton'].map(key => [key, ref(false)]))
    const bindings = { process: { env: { IS_ELECTRON: false } }, DBLibraryHandlers: { query() { assert.fail('portable history must filter the existing cache once, without querying the library') } },
      filterHistoryByDateAndChannel, fromDate: ref(''), toDate: ref(''), channel: ref(''), hasFilters: computed(() => query.value.trim().length > 0),
      filterVideosWithQuery, filterVideosWithQueryAsync, historyCacheSorted: computed(() => cached.value), activeData, dataLimit, searchDataLimit, query, ...flags,
      sortBy: ref(oldest ? 'oldest' : 'newest'), HISTORY_SORT_BY_VALUES: { DateAddedOldest: 'oldest' }, doCaseSensitiveSearch: ref(false), locale: ref('en-US'),
      filterHistoryAsync: { cancel() {} }, clampHistoryScroll() {}, saveStateInRouter() {}, dataLimitStorageKey: 'history', sessionStorage: { setItem() {} },
    }
    const start = source.indexOf('let pageCursor = null'), end = source.indexOf('\nfunction clampHistoryScroll()', start)
    const controller = compileFunction(source.slice(start, end) + '\nreturn { filterHistory, increaseLimit }', Object.keys(bindings))(...Object.values(bindings))
    await controller.filterHistory()
    assert.deepEqual(activeData.value.map(row => row._id), (oldest ? original.toReversed() : original).map(row => row._id))
    assert.equal(flags.historyReadFailed.value, false)
    query.value = 'Markerabc'
    await controller.filterHistory()
    const matches = original.filter(row => row.title.startsWith('Markerabc'))
    const expected = oldest ? matches.toReversed() : matches
    assert.deepEqual(activeData.value.map(row => row._id), expected.slice(0, 100).map(row => row._id))
    assert.equal(flags.showLoadMoreButton.value, true)
    await controller.increaseLimit()
    assert.deepEqual(activeData.value.map(row => row._id), expected.slice(0, 200).map(row => row._id))
    assert.equal(searchDataLimit.value, 200)
    query.value = 'Unmatchablephrase'
    await controller.filterHistory()
    assert.deepEqual(activeData.value, [])
    assert.equal(flags.showLoadMoreButton.value, false)
    assert.deepEqual(cached.value, original)
  }
})

test('failed desktop sync snapshot reads report the error and release their client', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function runSync('), end = source.indexOf('\nconst actions =', start)
  const active = new Set(), commits = [], error = new Error('snapshot unavailable')
  const bindings = { process: { env: { IS_ELECTRON: true } }, requiresEncryptedSync: () => false,
    SyncServerClient: class {}, trackSyncClient: client => { active.add(client); return client }, releaseSyncClient: client => active.delete(client),
    collectionCache: { use() {} }, parseSnapshot: value => value, savedSnapshot: () => Promise.reject(error),
    dispatchRemoteSyncAction() {}, SyncServerCancelledError: class extends Error {}, SyncServerDataLossError: class extends Error {}, isSessionExpiredError: () => false,
  }
  const sync = compileFunction(source.slice(start, end) + '\nreturn runSync', Object.keys(bindings))(...Object.values(bindings))
  const context = { state: {}, rootState: { settings: { syncServerEnabled: true } }, rootGetters: {}, dispatch() {}, commit: (...args) => commits.push(args) }
  await assert.rejects(sync(context), failure => failure === error)
  assert.deepEqual(commits.slice(-3), [['setSyncServerProgress', null], ['setSyncServerError', error.message], ['setSyncServerStatus', 'error']])
  assert.equal(active.size, 0)
})

test('portable history yields between search batches and ignores a superseded result', async () => {
  const source = await readFile(new URL('../../src/renderer/views/History/History.vue', import.meta.url), 'utf8')
  const original = Array.from({ length: 20000 }, (_, index) => ({ _id: `${index}`, videoId: `${index}`, title: index === 19999 ? 'Needle marker' : 'Ordinary video', author: 'Channel' }))
  const activeData = ref([]), query = ref('Unmatchablephrase'), isSearching = ref(false)
  let eventRan = false, yielded = false, obsoletePublished = false
  const bindings = { process: { env: { IS_ELECTRON: false } }, filterVideosWithQuery,
    filterHistoryByDateAndChannel, fromDate: ref(''), toDate: ref(''), channel: ref(''), hasFilters: computed(() => query.value.trim().length > 0),
    async filterVideosWithQueryAsync(...args) {
      const records = await filterVideosWithQueryAsync(...args)
      yielded = eventRan
      return records
    },
    DBLibraryHandlers: { query() { assert.fail('portable search must use the existing cache') } },
    historyCacheSorted: ref(original), activeData, query, isSearching, dataLimit: ref(100), searchDataLimit: ref(100),
    historyReadFailed: ref(false), historyPageReadFailed: ref(false), showLoadMoreButton: ref(false), showSearchFeedback: ref(true),
    sortBy: ref('newest'), HISTORY_SORT_BY_VALUES: { DateAddedOldest: 'oldest' }, doCaseSensitiveSearch: ref(false), locale: ref('en-US'),
    filterHistoryAsync: { cancel() {} }, clampHistoryScroll() { if (!activeData.value.length) obsoletePublished = true },
  }
  const start = source.indexOf('let pageCursor = null'), end = source.indexOf('\nfunction clampHistoryScroll()', start)
  const controller = compileFunction(source.slice(start, end) + '\nreturn { filterHistory }', Object.keys(bindings))(...Object.values(bindings))
  let next
  const turn = new Promise(resolve => setTimeout(() => { eventRan = true; query.value = 'Needle marker'; next = controller.filterHistory(); resolve() }, 0))
  const old = controller.filterHistory()
  await old; await turn; await next
  assert.equal(yielded, true, 'input/render tasks must run while a large history is searched')
  assert.equal(obsoletePublished, false, 'a cancelled search must never replace the current results')
  assert.deepEqual(activeData.value, [original.at(-1)])
  assert.equal(isSearching.value, false)
})
