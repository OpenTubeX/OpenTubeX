import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref, shallowReactive, watch } from 'vue'

import { CHANNEL_HANDLE_REGEX } from '../../src/renderer/helpers/feed-metadata.js'

const source = readFileSync(new URL('../../src/renderer/components/TopNav/TopNav.vue', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('async function getSearchDestination('), source.indexOf('async function goToSearch('))

function topNav() {
  const dispatched = []
  const resolved = []
  const searchSettings = ref({ prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] })
  const api = vm.runInNewContext(`${code}\n;({ getSearchResultHref, getSearchDestination })`, {
    ref, shallowReactive, watch, searchSettings, CHANNEL_HANDLE_REGEX, console,
    supportsYtDlp: false,
    shouldOpenExternalMediaUrl: () => false,
    store: {
      getters: {},
      dispatch: async (action, url) => {
        dispatched.push(url)
        return { urlType: 'video', videoId: 'dQw4w9WgXcQ' }
      },
    },
    router: {
      resolve({ path, query }) {
        resolved.push(path)
        return { href: `#${path}${query?.time ? `?time=${query.time}` : ''}` }
      },
    },
  })
  return { ...api, dispatched, resolved, searchSettings }
}

test('plain search text resolves its link without URL parsing', async () => {
  const f = topNav()
  assert.equal(f.getSearchResultHref('baking bread'), '#/search/baking%20bread')
  assert.equal(f.getSearchResultHref('baking bread', { time: 'today', features: [] }), '#/search/baking%20bread?time=today')
  assert.deepEqual((await f.getSearchDestination('  baking bread ')).path, '/search/baking%20bread')
  assert.deepEqual(f.dispatched, [], 'getYoutubeUrlInfo throws twice for plain text, so it is skipped')
})

test('rendered rows reuse resolved links until the search filters change', async () => {
  const f = topNav()
  for (let render = 0; render < 3; render++) f.getSearchResultHref('baking bread')
  assert.equal(f.resolved.length, 1)

  f.searchSettings.value.time = 'week'
  await nextTick()
  assert.equal(f.getSearchResultHref('baking bread'), '#/search/baking%20bread?time=week')
})

test('URLs and handles resolve once through getYoutubeUrlInfo', async () => {
  const f = topNav()
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  assert.equal(f.getSearchResultHref(url), undefined)
  assert.equal(f.getSearchResultHref(url), undefined, 'a pending link is not requested again')
  f.getSearchResultHref('@handle')
  assert.deepEqual(f.dispatched, [url, '@handle'])

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.getSearchResultHref(url), '#/watch/dQw4w9WgXcQ')
  assert.equal(f.dispatched.length, 2)
})
