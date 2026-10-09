import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/NavigationCustomizer/NavigationCustomizer.vue', import.meta.url), 'utf8')
const start = source.indexOf('async function updateItems(')
const updateItemsSource = source.slice(start, source.indexOf('\nasync function addItem(', start))

for (const electron of [true, false]) {
  for (const homeRetained of [true, false]) {
    test(`failed navigation write ${homeRetained ? 'retains Home' : 'redirects persisted Home removal'} on ${electron ? 'Electron' : 'web'}`, async () => {
      const calls = []
      const store = {
        getters: { getNavigationItems: ['home'], getLandingPage: 'subscriptions' },
        dispatch: async action => {
          calls.push(action)
          if (action === 'updateNavigationItems') {
            // The settings queue rolls an optimistic re-add back to the last
            // successful write, which may already have removed Home.
            store.getters.getNavigationItems = homeRetained ? ['home'] : ['subscriptions']
            return false
          }
        },
      }
      const updateItems = vm.compileFunction(`${updateItemsSource}\nreturn updateItems`, ['store', 'process', 'route', 'router'])(
        store, { env: { IS_ELECTRON: electron } }, { path: '/home' },
        { replace: async ({ path }) => calls.push(path) },
      )
      assert.equal(await updateItems(['home', 'subscriptions']), false)
      assert.deepEqual(calls, homeRetained ? ['updateNavigationItems'] : [
        'updateNavigationItems', electron ? 'redirectHomeTabsToLandingPage' : '/subscriptions',
      ])
    })
  }
}
