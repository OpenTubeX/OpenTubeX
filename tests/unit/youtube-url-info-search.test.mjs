import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { getSearchFilterTabId } from '../../src/search-history.js'

const source = readFileSync(new URL('../../src/renderer/store/modules/utils.js', import.meta.url), 'utf8')
const start = source.indexOf('  async getYoutubeUrlInfo(')
const end = source.indexOf('\n  },\n', start)
assert.ok(start >= 0 && end > start, 'Update the harness after changing the getYoutubeUrlInfo boundaries')

const getYoutubeUrlInfo = vm.runInNewContext(`({
  ${source.slice(start, end)}
  }
}).getYoutubeUrlInfo`, {
  URL,
  Map,
  CHANNEL_HANDLE_REGEX: /^@[\w.-]+$/,
  getVideoParamsFromUrl: () => ({}),
  checkYoutubeChannelId: () => false,
  getSearchFilterTabId,
})

function createContext(searchSettingsByTabId, presentedTabId) {
  return {
    rootState: { settings: {} },
    rootGetters: { getPresentedTabId: presentedTabId },
    getters: {
      getSearchSettings: (tabId = 'web') => searchSettingsByTabId[tabId] ?? {
        prioritize: 'relevance',
        time: '',
        type: 'all',
        duration: '',
        features: [],
      },
    },
  }
}

for (const [name, url, expectedQuery] of [
  ['YouTube results', 'https://www.youtube.com/results?search_query=lofi+beats&sp=EgIQAQ%253D%253D', 'lofi beats'],
  ['Invidious search', 'https://redirect.invidious.io/search?q=lofi+beats', 'lofi beats'],
]) {
  test(`${name} URLs use the search filters of the tab that opened them`, async () => {
    const originalEnv = process.env
    process.env = { IS_ELECTRON: 'true' }
    try {
      const context = createContext({
        'tab-2': { prioritize: 'upload_date', time: 'week', type: 'video', duration: 'short', features: ['hd'] },
      }, 'tab-2')

      const result = await getYoutubeUrlInfo(context, url)

      assert.equal(result.urlType, 'search')
      assert.equal(result.searchQuery, expectedQuery)
      assert.deepEqual(structuredClone(result.query), {
        prioritize: 'upload_date',
        time: 'week',
        type: 'video',
        duration: 'short',
        features: ['hd'],
        ...(url.includes('sp=') ? { sp: 'EgIQAQ%3D%3D' } : {}),
      })
    } finally {
      process.env = originalEnv
    }
  })
}

test('search URLs fall back to the default filters when the tab has none', async () => {
  const result = await getYoutubeUrlInfo(createContext({}, 'tab-9'), 'https://www.youtube.com/results?search_query=test')

  assert.equal(result.urlType, 'search')
  assert.deepEqual(structuredClone(result.query), { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] })
})
