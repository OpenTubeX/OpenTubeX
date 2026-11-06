import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const start = settingsSource.indexOf('const sideEffectHandlers = {')
const end = settingsSource.indexOf('\nconst settingsWithSideEffects', start)
assert.ok(start >= 0 && end > start, 'Update the harness after changing the side effect handler boundaries')
const sideEffectHandlers = vm.runInNewContext(`${settingsSource.slice(start, end)}; sideEffectHandlers`)

const searchSource = await readFile(new URL('../../src/renderer/views/SearchPage/SearchPage.vue', import.meta.url), 'utf8')
const watcher = searchSource.match(/watch\(showFamilyFriendlyOnly, [\s\S]*?\n\}\)\n/)?.[0]
assert.ok(watcher, 'Update the harness after changing the family friendly watcher')

for (const enabled of [true, false]) {
  test(`${enabled ? 'enabling' : 'disabling'} family friendly results drops searches cached under the other setting`, () => {
    const commits = []
    sideEffectHandlers.showFamilyFriendlyOnly({ commit: (name, value) => commits.push([name, [...value]]) }, enabled)
    assert.deepEqual(commits, [['setSessionSearchHistory', []]])
  })
}

test('enabling family friendly results searches again instead of keeping unrestricted results', () => {
  for (const apiUsed of ['local', 'invidious', 'yt-dlp']) {
    const searches = []
    let callback
    vm.runInNewContext(watcher, {
      watch: (_source, cb) => { callback = cb },
      showFamilyFriendlyOnly: { value: false },
      isRetryingWithCookies: { value: false },
      apiUsed: { value: apiUsed },
      processedQuery: { value: 'query' },
      getRouteSearchSettings: () => ({}),
      route: { query: {} },
      checkSearchCache: payload => searches.push(payload.query),
    })
    callback(false)
    assert.deepEqual(searches, [], apiUsed)
    callback(true)
    assert.deepEqual(searches, ['query'], apiUsed)
  }
})
