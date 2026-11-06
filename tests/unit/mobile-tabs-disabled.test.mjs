import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { getRevokedSyncSessionLogins } from '../../src/renderer/helpers/sync-sessions.js'

const utils = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const start = utils.indexOf('export function openInternalPath(')
const navigationSource = utils.slice(start, utils.indexOf('\n}\n', start) + 2).replace('export ', '')

for (const ios of [false, true]) {
  for (const makeActive of [false, true]) {
    test(`${ios ? 'iOS' : 'Android'} ${makeActive ? 'foreground' : 'background'} tab confirmation waits for successful creation`, async () => {
      let finishCreation
      const creation = new Promise(resolve => { finishCreation = resolve })
      const toasts = []
      const context = vm.createContext({
        process: { env: { IS_CAPACITOR: true, IS_IOS: ios } },
        getCapacitorTabService: () => ({
          tabsEnabled: true,
          createTab: (route, title, active) => {
            assert.deepEqual(structuredClone(route), { path: '/history', query: undefined })
            assert.equal(title, 'History')
            assert.equal(active, makeActive)
            return creation
          }
        }),
        i18n: { global: { t: key => key } },
        showToast: message => toasts.push(message)
      })
      vm.runInContext(navigationSource, context)
      const opening = context.openInternalPath({ path: '/history', title: 'History', thumbnail: 'video-thumbnail.jpg', doCreateNewTab: true, makeActive })
      assert.deepEqual(toasts, [])
      finishCreation('new-tab')
      assert.equal(await opening, 'new-tab')
      assert.deepEqual(structuredClone(toasts), !ios && !makeActive
        ? [{ message: 'Context Menu.Opened in a Background Tab', image: 'video-thumbnail.jpg' }]
        : [])
    })
  }
}

for (const rejects of [false, true]) {
  test(`Android does not confirm a background tab when creation ${rejects ? 'rejects' : 'returns null'}`, async () => {
    const error = new Error('Creation failed')
    const context = vm.createContext({
      process: { env: { IS_CAPACITOR: true } },
      getCapacitorTabService: () => ({
        tabsEnabled: true,
        createTab: () => rejects ? Promise.reject(error) : Promise.resolve(null)
      }),
      showToast: () => assert.fail('Confirmed an unsuccessful tab creation')
    })
    vm.runInContext(navigationSource, context)
    const opening = context.openInternalPath({ path: '/history', doCreateNewTab: true, makeActive: false })
    if (rejects) await assert.rejects(opening, error)
    else assert.equal(await opening, null)
  })
}

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
      path: '/history', query: { search: 'test' },
      doCreateNewTab: !newWindow, doCreateNewWindow: newWindow, makeActive: false
    })
    assert.deepEqual(structuredClone(calls), [{ path: '/history', query: { search: 'test' }, state: undefined }])
  })
}

const tabsSource = await readFile(new URL('../../src/renderer/store/modules/tabs.js', import.meta.url), 'utf8')
const enabledGetter = tabsSource.match(/getTabsEnabled: (.*),/)[1]
for (const mobile of [true, false]) {
  test(`tab availability honors the mobile preference only on ${mobile ? 'mobile' : 'desktop'}`, () => {
    const getter = vm.runInNewContext(`(${enabledGetter})`, { process: { env: { IS_CAPACITOR: mobile } } })
    assert.equal(getter({}, { getEnableMobileTabs: false }), !mobile)
    assert.equal(getter({}, { getEnableMobileTabs: true }), true)
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

for (const kind of ['Video', 'Playlist']) {
  const source = await readFile(new URL(`../../src/renderer/components/FtList${kind}/FtList${kind}.vue`, import.meta.url), 'utf8')
  const name = kind === 'Video' ? 'videoMenuOptions' : 'playlistMenuItems'
  const end = kind === 'Video' ? '\n  if (hideSubscriptionFeedTypeOption.value)' : '\n  if (process.env.IS_ELECTRON)'
  const menu = source.slice(source.indexOf(`const ${name} =`), source.indexOf(end)) +
    `\nreturn ${kind === 'Video' ? 'options' : 'items'}\n})\n${name}.value`
  for (const enabled of [true, false]) {
    test(`${kind.toLowerCase()} long-press menu ${enabled ? 'offers' : 'hides'} opening a new tab`, () => {
      const context = {
        computed: getter => ({ value: getter() }),
        store: { getters: { getTabsEnabled: enabled } },
        process: { env: { IS_CAPACITOR: true } },
        t: key => key,
        supportsYtDlp: false
      }
      for (const key of ['inSubscriptions', 'showMarkAsSeen', 'canMarkAsWatched', 'canMarkAsFullySeen', 'historyEntryExists']) {
        context[key] = { value: false }
      }
      const items = vm.runInNewContext(menu, context)
      assert.equal(items.some(item => item.label === 'Context Menu.Open in a New Tab'), enabled)
    })
  }
}

for (const enabled of [true, false]) {
  test(`mobile thumbnail quick actions ${enabled ? 'offer' : 'hide'} background tabs`, async () => {
    const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
    const start = source.indexOf('const mobileThumbnailActions =')
    const menu = source.slice(start, source.indexOf('\nconst openMobileContextActions', start)) + '\nmobileThumbnailActions.value'
    const context = {
      computed: getter => ({ value: getter() }),
      store: { getters: { getTabsEnabled: enabled } },
      process: { env: { IS_CAPACITOR: true } },
      t: key => key,
    }
    for (const key of ['showPlaylists', 'isQuickBookmarkEnabled', 'inUserPlaylist', 'canToggleLiveReminder']) {
      context[key] = { value: false }
    }
    const actions = vm.runInNewContext(menu, context)
    assert.equal(actions.some(action => action.label === 'Context Menu.Open in a Background Tab'), enabled)
  })
}

test('incoming video requests wait while mobile tabs are disabled', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
  const condition = source.match(/else if \((event.recipient === settings.syncServerDeviceId[\s\S]*?)\) \{/)[1]
  for (const mobile of [true, false]) {
    for (const enabled of [true, false]) {
      const acceptsRequest = vm.runInNewContext(condition, {
        event: { recipient: 'device' }, settings: { syncServerDeviceId: 'device' },
        rootState: { settings: { enableMobileTabs: enabled } },
        process: { env: { IS_CAPACITOR: mobile, IS_ELECTRON: !mobile } },
        isAppHidden: () => false
      })
      assert.equal(acceptsRequest, !mobile || enabled)
    }
  }
})
