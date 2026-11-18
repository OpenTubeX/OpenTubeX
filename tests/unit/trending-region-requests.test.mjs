import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/views/Trending/Trending.vue', import.meta.url), 'utf8')
const start = source.indexOf('function getTrendingInfo(')
const end = source.indexOf("const gamingTab = useTemplateRef('gamingTab')", start)
assert.ok(start >= 0 && end > start, 'Update the harness after changing the trending loader boundaries')

for (const outcome of ['resolve', 'reject']) {
  test(`a ${outcome}d request for a region changed while loading is discarded and refetched`, async () => {
    const requests = []
    const commits = []
    const toasts = []
    const region = { value: 'DE' }
    const errorMessages = { value: { gaming: null, music: null, sports: null, podcasts: null } }
    const { getTrendingInfo } = vm.runInNewContext(`${source.slice(start, end)}; ({ getTrendingInfo })`, {
      region,
      currentTab: { value: 'gaming' },
      isLoading: { value: { gaming: false, music: false, sports: false, podcasts: false } },
      errorMessages,
      isBackendSupported: { value: true },
      store: { commit: (name, payload) => commits.push({ name, payload }) },
      getLocalTrending: (requestedRegion, category) => new Promise((resolve, reject) => {
        requests.push({ requestedRegion, category, resolve, reject })
      }),
      nextTick: () => {},
      t: key => key,
      showApiErrorToast: (...args) => toasts.push(args),
      showTabToast: () => {},
      console: { error: () => {} }
    })

    getTrendingInfo()
    region.value = 'US'
    if (outcome === 'resolve') {
      requests[0].resolve(['stale'])
    } else {
      requests[0].reject(new Error('stale'))
    }
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(commits, [])
    assert.equal(errorMessages.value.gaming, null)
    assert.equal(toasts.length, 0)
    assert.deepEqual(requests.map(({ requestedRegion, category }) => [requestedRegion, category]), [['DE', 'gaming'], ['US', 'gaming']])

    requests[1].resolve(['current'])
    await new Promise(resolve => setImmediate(resolve))
    const { payload } = commits.find(({ name }) => name === 'setTrendingCache')
    assert.deepEqual([payload.value[0], payload.page, payload.region], ['current', 'gaming', 'US'])
  })
}
