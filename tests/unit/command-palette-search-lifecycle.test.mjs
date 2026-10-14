import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as palette from '../../src/renderer/helpers/commandPalette.js'
import * as videos from '../../src/renderer/helpers/commandPaletteVideos.js'

const { descriptor } = parse(await readFile(new URL('../../src/renderer/components/FtCommandPalette/FtCommandPalette.vue', import.meta.url), 'utf8'))
const source = compileScript(descriptor, { id: 'palette-search-lifecycle-test' }).content
  .replace(/^import .* from .*\n/gm, '')
  .replace('export default', 'const component =')

function setup(searchVideos = palette.filterCommandPaletteCommandsAsync) {
  let searchWatcher
  const component = runInNewContext(`${source}; component`, {
    ...Vue, ...palette, ...videos,
    filterCommandPaletteCommandsAsync: searchVideos,
    FtRetryImage: {}, FtIcon: {}, FtProfileIcon: {}, FtLoader: {},
    useI18n: () => ({ locale: Vue.ref('en-US'), t: key => key }),
    useId: () => 'test', useTemplateRef: () => Vue.ref(null),
    onBeforeMount() {}, onBeforeUnmount() {}, onMounted() {},
    watch: (sources, callback, options) => {
      if (options?.immediate) searchWatcher = callback
    },
    store: { subscribe: () => () => {} },
    document: {},
    clampOverlayScrollTop() {}, restoreOverlayScrollTop() {},
    getLocalizedShortcut() {}, lockBodyScroll() {}, unlockBodyScroll() {},
  })
  const sources = { history: [], playlists: [], downloads: {}, queue: [] }
  const state = component.setup({ commands: [], videoSources: sources }, { expose() {}, emit() {} })
  return {
    state, sources,
    search(query) {
      let cleanup
      const result = searchWatcher([query, sources, 'en-US'], [], callback => { cleanup = callback })
      return { result, cancel: () => cleanup() }
    },
  }
}

test('a failed local-video scan clears loading and a later search still works', async () => {
  const f = setup()
  // A damaged playlist record makes the real local-video iterator reject.
  f.sources.playlists = [{ videos: null }]
  const failed = f.search('north')
  assert.equal(f.state.searchPending.value, true)
  await assert.rejects(failed.result, /iterable/)
  assert.equal(f.state.searchPending.value, false)
  assert.equal(f.state.videoMatches.value.length, 0)

  f.sources.playlists = []
  f.sources.history = [{ videoId: 'north', title: 'North journey' }]
  f.sources.sources = { history: 'History' }
  f.sources.group = 'Local videos'
  await f.search('north').result
  assert.equal(f.state.searchPending.value, false)
  assert.equal(f.state.videoMatches.value[0].label, 'North journey')
})

for (const rejects of [false, true]) {
  test(`a cancelled scan cannot clear a newer search's loading state (rejects: ${rejects})`, async () => {
    const scans = []
    const f = setup(() => new Promise((resolve, reject) => scans.push({ resolve, reject })))
    const older = f.search('old')
    const olderSettled = rejects ? assert.rejects(older.result, /scan failed/) : older.result
    older.cancel()
    const newer = f.search('new')
    if (rejects) scans[0].reject(new Error('scan failed'))
    else scans[0].resolve([{ label: 'Stale result' }])
    await olderSettled
    assert.equal(f.state.searchPending.value, true)
    assert.equal(f.state.videoMatches.value.length, 0)
    scans[1].resolve([{ label: 'Current result' }])
    await newer.result
    assert.equal(f.state.searchPending.value, false)
    assert.equal(f.state.videoMatches.value[0].label, 'Current result')
  })
}
