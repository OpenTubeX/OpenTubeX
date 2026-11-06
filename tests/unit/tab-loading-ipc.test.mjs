import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/renderer/tabs/TabNavigationService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export default .*$/gm, '')
  .replace(/^export /gm, '')

test('loading IPC reports only aggregate transitions across loading sources', () => {
  const messages = []
  const Service = vm.runInNewContext(`${source}; TabNavigationService`, {
    window: { ftElectron: { tabs: { setLoading: (...args) => messages.push(args) } } }
  })
  const navigation = new Service({}, {})
  navigation.setLoadingSource('tab', 'loader', false)
  navigation.setLoadingSource('tab', 'route', true)
  navigation.setLoadingSource('tab', 'loader', true)
  navigation.setLoadingSource('tab', 'loader', true)
  navigation.setLoadingSource('tab', 'route', false)
  navigation.setLoadingSource('other', 'loader', true)
  navigation.setLoadingSource('tab', 'loader', false)
  navigation.setLoadingSource('tab', 'loader', false)
  assert.deepEqual(messages, [[true, 'tab'], [true, 'other'], [false, 'tab']])
})
