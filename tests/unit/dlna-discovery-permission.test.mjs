import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const component = await readFile(new URL('../../src/renderer/components/WatchDlnaCast/WatchDlnaCast.vue', import.meta.url), 'utf8')
const source = component.slice(component.indexOf('async function refreshDevices()'), component.indexOf('async function stopCasting('))

test('DLNA discovery preserves permission denials and uses the generic message for other failures', async () => {
  for (const [code, expected] of [['LOCAL_ACCESS_DENIED', 'Translated permission denial'], ['DISCOVERY_FAILED', 'Video.Player.DLNA.Error']]) {
    const toasts = []
    const loading = { value: false }
    const context = vm.createContext({
      loading,
      disposed: false,
      refreshSource: () => {},
      dlnaCast: { discover: async () => { throw Object.assign(new Error('Translated permission denial'), { code }) } },
      showToast: toast => toasts.push(toast.message),
      t: key => key,
    })
    vm.runInContext(source, context)
    await context.refreshDevices()
    assert.deepEqual(toasts, [expected])
    assert.equal(loading.value, false)
  }
})
