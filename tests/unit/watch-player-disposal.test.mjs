import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const cleanup = source.slice(source.indexOf('    async cleanupWatchRuntime()'), source.indexOf('\n    async reloadView(')).trim().replace(/,$/, '')
const destroy = source.slice(source.indexOf('    destroyPlayer: async function'), source.indexOf('\n    isSabrVideoStream()')).trim().replace(/,$/, '')

test('closing a watch tab releases its player even when saving progress finishes after unmount', async () => {
  let finishSave
  let released = false
  const player = { async destroyPlayer() { released = true; return {} } }
  const methods = vm.runInNewContext(`({${cleanup},${destroy}})`, { window: { removeEventListener() {} }, process: { env: { IS_CAPACITOR: true } } })
  const watch = {
    ...methods, $store: { commit() {} }, $refs: { player }, tabId: 'closing-tab',
    handleRouteChange: () => new Promise(resolve => { finishSave = resolve }),
    deactivateWatchRuntime() {},
  }
  const pending = watch.cleanupWatchRuntime()
  watch.$refs = {}
  finishSave()
  await pending
  assert.equal(released, true, 'playback must stop after its tab is removed')
})
