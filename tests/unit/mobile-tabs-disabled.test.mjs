import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { getRevokedSyncSessionLogins } from '../../src/renderer/helpers/sync-sessions.js'

const utils = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const start = utils.indexOf('export function openInternalPath(')
const navigationSource = utils.slice(start, utils.indexOf('\n}\n', start) + 2).replace('export ', '')

test('Android background tab confirmation waits for successful creation', async () => {
  let finishCreation
  const creation = new Promise(resolve => { finishCreation = resolve })
  const toasts = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true, IS_IOS: false } },
    getCapacitorTabService: () => ({
      tabsEnabled: true,
      createTab: (route, title, active) => {
        assert.deepEqual(structuredClone(route), { path: '/history', query: undefined })
        assert.equal(title, 'History')
        assert.equal(active, false)
        return creation
      }
    }),
    i18n: { global: { t: key => key } },
    showToast: message => toasts.push(message)
  })
  vm.runInContext(navigationSource, context)
  const opening = context.openInternalPath({ path: '/history', title: 'History', thumbnail: 'video-thumbnail.jpg', doCreateNewTab: true, makeActive: false })
  assert.deepEqual(toasts, [])
  finishCreation('new-tab')
  assert.equal(await opening, 'new-tab')
  assert.deepEqual(structuredClone(toasts), [{ message: 'Context Menu.Opened in a Background Tab', image: 'video-thumbnail.jpg' }])
})

test('Android does not confirm a background tab when creation rejects', async () => {
  const error = new Error('Creation failed')
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } },
    getCapacitorTabService: () => ({
      tabsEnabled: true,
      createTab: () => Promise.reject(error)
    }),
    showToast: () => assert.fail('Confirmed an unsuccessful tab creation')
  })
  vm.runInContext(navigationSource, context)
  const opening = context.openInternalPath({ path: '/history', doCreateNewTab: true, makeActive: false })
  await assert.rejects(opening, error)
})

for (const newWindow of [true, false]) {
  test(`mobile modified navigation stays in the current page with tabs disabled (${newWindow ? 'window' : 'tab'})`, () => {
    const calls = []
    const context = vm.createContext({
      process: { env: { IS_CAPACITOR: true } },
      getCapacitorTabService: () => ({
        tabsEnabled: false,
        createTab: () => assert.fail('Created a hidden tab')
      }),
      getTabNavigationService: () => ({ pushPresented: route => calls.push(route) })
    })
    vm.runInContext(navigationSource, context)
    context.openInternalPath({
      path: '/history',
      query: { search: 'test' },
      doCreateNewTab: !newWindow,
      doCreateNewWindow: newWindow,
      makeActive: false
    })
    assert.deepEqual(structuredClone(calls), [{ path: '/history', query: { search: 'test' }, state: undefined }])
  })
}

const syncSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const syncStart = syncSource.indexOf('export async function syncSessions(')
const syncFunction = syncSource.slice(syncStart, syncSource.indexOf('\n}\n', syncStart) + 2).replace('export ', '')
for (const disableWhileFetching of [false, true]) {
  test(`disabled mobile tabs skip session sync ${disableWhileFetching ? 'during a fetch' : 'before a fetch'}`, async () => {
    const store = { state: { settings: { enableMobileTabs: disableWhileFetching } } }
    const context = vm.createContext({
      process: { env: { IS_CAPACITOR: true } },
      getTabSyncAdapter: () => {
        assert.ok(disableWhileFetching, 'Sync must not access the tab service while disabled')
        return {
          getSyncSessions: () => [],
          applySyncSessions: () => assert.fail('Applied a disabled session')
        }
      }
    })
    vm.runInContext(syncFunction, context)
    const result = await context.syncSessions({
      getSessions: () => { store.state.settings.enableMobileTabs = false; return [] },
      putSessions: () => assert.fail('Overwrote other devices’ tabs')
    }, store)
    assert.equal(result, null)
  })
}

for (const mobile of [true, false]) {
  for (const disableDuringApply of [true, false]) {
    test(`${mobile ? 'mobile' : 'desktop'} session sync ${disableDuringApply ? 'disabling tabs' : 'keeping tabs enabled'} during application`, async () => {
      let finishApply
      let markApplying
      const applying = new Promise(resolve => { markApplying = resolve })
      const applied = new Promise(resolve => { finishApply = resolve })
      const writes = []
      const settingUpdates = []
      const store = {
        state: { settings: { enableMobileTabs: true, syncServerSharedTabs: false } },
        dispatch: (...args) => settingUpdates.push(args)
      }
      const merged = { sessionsToApply: [{ id: 'remote' }], document: { mode: 'shared' }, mode: 'shared' }
      const context = vm.createContext({
        process: { env: { IS_CAPACITOR: mobile } },
        getTabSyncAdapter: () => ({
          getSyncSessions: () => [],
          applySyncSessions: () => { markApplying(); return applied }
        }),
        getTabSessionDeviceIdentity: () => ({ deviceId: 'local', legacyDeviceIds: [] }),
        getRevokedSyncSessionLogins,
        mergeSyncSessions: () => merged,
        metadataEquals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
      })
      vm.runInContext(syncFunction, context)
      const sync = context.syncSessions({
        getSessions: () => [],
        putSessions: document => writes.push(document)
      }, store)
      await applying
      store.state.settings.enableMobileTabs = !disableDuringApply
      finishApply(true)
      const skipped = mobile && disableDuringApply
      assert.equal(await sync, skipped ? null : merged)
      assert.deepEqual(writes, skipped ? [] : [merged.document])
      assert.deepEqual(settingUpdates, skipped ? [] : [['updateSyncServerSharedTabs', true]])
    })
  }
}

test('incoming video requests wait while mobile tabs are disabled', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
  const condition = source.match(/else if \((event.recipient === settings.syncServerDeviceId[\s\S]*?)\) \{/)[1]
  for (const mobile of [true, false]) {
    for (const enabled of [true, false]) {
      const acceptsRequest = vm.runInNewContext(condition, {
        event: { recipient: 'device' },
        settings: { syncServerDeviceId: 'device' },
        rootState: { settings: { enableMobileTabs: enabled } },
        process: { env: { IS_CAPACITOR: mobile, IS_ELECTRON: !mobile } },
        isAppHidden: () => false
      })
      assert.equal(acceptsRequest, !mobile || enabled)
    }
  }
})
