import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createOptimisticSettingUpdater, createSettingUpdateQueue, createSettingWriteTracker } from '../../src/renderer/helpers/settingUpdateQueue.js'
import { areSyncSettingValuesEqual, mergeSettingEntry, mergeSettingItemsEntry, migrateLegacySyncedSettings, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const settingsSection = (start, end) => settingsSource.slice(settingsSource.indexOf(start), settingsSource.indexOf(end))
const generatedSettingActions = settingsSection('const getters = {}', '// Add all custom data')

function deferred () {
  let resolvePromise
  const promise = new Promise(resolve => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

test('optimistic list edits compose before persistence and survive delayed earlier writes', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['first', 'second', 'third']
  let persisted = value
  const options = {
    read: () => value,
    commit: next => { value = next },
    persist: async next => {
      if (next.includes('second')) {
        started.resolve()
        await release.promise
      }
      persisted = next
    },
  }
  const first = update('items', value.filter(id => id !== 'first'), options)
  await started.promise
  const second = update('items', value.filter(id => id !== 'second'), options)
  assert.deepEqual(value, ['third'])
  release.resolve()
  await Promise.all([first, second])
  assert.deepEqual(value, ['third'])
  assert.deepEqual(persisted, ['third'])
})

test('a failed latest list edit restores the last successful write, not an obsolete optimistic value', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['first', 'second', 'third']
  const options = {
    read: () => value,
    commit: next => { value = next },
    persist: async next => {
      if (next.length === 2) {
        started.resolve()
        await release.promise
      } else {
        throw new Error('Disk write failed')
      }
    },
  }
  const first = update('items', ['second', 'third'], options)
  await started.promise
  const second = update('items', ['third'], options)
  const failure = assert.rejects(second, /Disk write failed/)
  release.resolve()
  await Promise.all([first, failure])
  assert.deepEqual(value, ['second', 'third'])
})

test('a failed optimistic write cannot roll back a newer synchronized value', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['original']
  const pending = update('items', ['local'], {
    read: () => value,
    commit: next => { value = next },
    persist: async () => {
      started.resolve()
      await release.promise
      throw new Error('Disk write failed')
    },
  })
  const failure = assert.rejects(pending, /Disk write failed/)
  await started.promise
  value = ['synchronized']
  release.resolve()
  await failure
  assert.deepEqual(value, ['synchronized'])
})

test('edits after synchronization use the synchronized rollback baseline', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['original']
  const options = {
    read: () => value,
    commit: next => { value = next },
    persist: async () => {
      started.resolve()
      await release.promise
      throw new Error('Disk write failed')
    },
  }
  const first = assert.rejects(update('items', ['first'], options), /Disk write failed/)
  await started.promise
  value = ['synchronized']
  const second = assert.rejects(update('items', ['second'], options), /Disk write failed/)
  release.resolve()
  await Promise.all([first, second])
  assert.deepEqual(value, ['synchronized'])
})

test('keeps an in-flight setting write from applying after a newer update', async () => {
  const runUpdate = createSettingUpdateQueue()
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const appliedValues = []

  const first = runUpdate('scrollbarThumbWidth', async isLatest => {
    firstStarted.resolve()
    await releaseFirst.promise
    if (isLatest()) appliedValues.push(7)
  })
  await firstStarted.promise

  const second = runUpdate('scrollbarThumbWidth', async isLatest => {
    if (isLatest()) appliedValues.push(8)
  })
  const third = runUpdate('scrollbarThumbWidth', async isLatest => {
    if (isLatest()) appliedValues.push(9)
  })

  releaseFirst.resolve()
  await Promise.all([first, second, third])

  assert.deepEqual(appliedValues, [9])
})

test('continues with the latest setting write after an earlier write fails', async () => {
  const runUpdate = createSettingUpdateQueue()
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const appliedValues = []

  const first = runUpdate('scrollbarThumbWidth', async () => {
    firstStarted.resolve()
    await releaseFirst.promise
    throw new Error('write failed')
  })
  await firstStarted.promise

  const second = runUpdate('scrollbarThumbWidth', async isLatest => {
    if (isLatest()) appliedValues.push(8)
  })

  releaseFirst.resolve()
  await assert.rejects(first, /write failed/)
  await second

  assert.deepEqual(appliedValues, [8])
})

test('generated setting updaters report whether the write was saved and save every value they timestamp', async () => {
  let failWrites = false
  let editTimeSaved = Promise.resolve()
  const writes = []
  const actions = vm.runInNewContext(`${generatedSettingActions}\nactions`, {
    state: { uiScale: 100, theme: 'dark' },
    settingsWithSideEffects: ['theme'],
    sideEffectHandlers: { theme: () => {} },
    defaultGetterId: id => `get${id}`,
    defaultMutationId: id => `set${id}`,
    defaultUpdaterId: id => `update${id}`,
    defaultSideEffectsTriggerId: id => `trigger${id}`,
    createSettingUpdateQueue,
    settingWrites: createSettingWriteTracker(async () => undefined),
    saveSettingEdit: async (commit, id, save) => {
      await editTimeSaved
      return save()
    },
    DBSettingHandlers: {
      upsert: async (id, value) => {
        if (failWrites) throw new Error('disk full')
        writes.push(value)
      },
    },
    console: { error () {} },
  })
  const context = { commit () {}, dispatch () {}, state: {} }

  assert.equal(await actions.updateuiScale(context, 125), true)
  assert.equal(await actions.updatetheme(context, 'light'), true)
  failWrites = true
  assert.equal(await actions.updateuiScale(context, 150), false)
  assert.equal(await actions.updatetheme(context, 'black'), false)

  // A newer update replaces the older one while the older one saves its edit
  // time. Otherwise the unchanged value would keep the newer edit time.
  failWrites = false
  for (const [update, values] of [[actions.updateuiScale, [175, 200]], [actions.updatetheme, ['light', 'dark']]]) {
    const release = deferred()
    editTimeSaved = release.promise
    writes.length = 0
    const older = update(context, values[0])
    await new Promise(resolve => setImmediate(resolve))
    const newer = update(context, values[1])
    release.resolve()
    await Promise.all([older, newer])
    assert.deepEqual(writes, values)
  }
})

test('a setting saved by another window during this window\'s write shows the last saved value', async () => {
  const saved = new Map([['theme', 'dark']])
  const editTimes = new Map()
  let valueSavedWithoutEditTime = false
  const settingWrites = createSettingWriteTracker(async id => saved.get(id))
  const started = deferred()
  const release = deferred()
  const actions = vm.runInNewContext(`${generatedSettingActions}\nactions`, {
    state: { theme: 'dark' },
    settingsWithSideEffects: [],
    defaultGetterId: id => `get${id}`,
    defaultMutationId: id => `set${id}`,
    defaultUpdaterId: id => `update${id}`,
    createSettingUpdateQueue,
    settingWrites,
    saveSettingEdit: (commit, id, save) => {
      editTimes.set(id, Date.now())
      return save()
    },
    DBSettingHandlers: {
      upsert: async (id, value) => {
        valueSavedWithoutEditTime ||= !editTimes.has(id)
        saved.set(id, value)
        started.resolve()
        await release.promise
      },
    },
    console,
  })
  const settings = { theme: 'dark' }
  const commit = (mutation, value) => { settings[mutation.slice(3)] = value }
  const update = actions.updatetheme({ commit, dispatch () {} }, 'light')
  await started.promise

  // Another window saves its edit after this one, and its broadcast arrives before this write finishes.
  saved.set('theme', 'black')
  settingWrites.savedElsewhere('theme', value => { settings.theme = value })
  settings.theme = 'black'
  release.resolve()

  assert.equal(await update, true)
  assert.equal(settings.theme, 'black')
  // Another window must not receive the new value with the previous edit time.
  assert.equal(valueSavedWithoutEditTime, false)
})

test('the last locale change wins when an earlier locale finishes loading later', async () => {
  const loads = new Map()
  const i18n = { global: { locale: { value: 'en-US' } } }
  const handlers = vm.runInNewContext(`({${settingsSection('  currentLocale:', '  defaultInvidiousInstance:')}})`, {
    runLocaleChange: createSettingUpdateQueue(),
    i18n,
    loadLocale: locale => {
      if (locale === 'en-US') return Promise.resolve()
      const load = deferred()
      loads.set(locale, load)
      return load.promise
    },
  })
  const dispatch = async () => {}
  const tick = () => new Promise(resolve => setImmediate(resolve))

  // Another window's change applies, then this window's own write shows its value.
  const first = handlers.currentLocale({ dispatch }, 'de-DE')
  await tick()
  const second = handlers.currentLocale({ dispatch }, 'fr-FR')
  await tick()
  loads.get('fr-FR')?.resolve()
  await tick()
  loads.get('de-DE').resolve()
  await tick()
  loads.get('fr-FR')?.resolve()
  await Promise.all([first, second])

  assert.equal(i18n.global.locale.value, 'fr-FR')
})

test('an ordered setting saved by another window before this window\'s write shows this window\'s value', async () => {
  const saved = new Map([['pinnedPlaylistIds', ['first']]])
  const settingWrites = createSettingWriteTracker(async id => saved.get(id))
  const started = deferred()
  const release = deferred()
  const updateOrderedSetting = vm.runInNewContext(`${settingsSection('const updateOptimisticSetting', 'let androidProxyUpdate')}\nupdateOrderedSetting`, {
    createOptimisticSettingUpdater,
    settingWrites,
    defaultMutationId: id => `set${id}`,
    saveSettingEdit: (commit, id, save) => save(),
    DBSettingHandlers: {
      upsert: async (id, value) => {
        started.resolve()
        await release.promise
        saved.set(id, value)
      },
    },
    console,
  })
  const settings = { pinnedPlaylistIds: ['first'] }
  const commit = (mutation, value) => { settings[mutation.slice(3)] = value }
  const update = updateOrderedSetting(commit, settings, 'pinnedPlaylistIds', ['first', 'local'])
  await started.promise

  // Another window saved its edit first, but its broadcast arrives after this window showed its own.
  saved.set('pinnedPlaylistIds', ['first', 'other'])
  settingWrites.savedElsewhere('pinnedPlaylistIds', value => { settings.pinnedPlaylistIds = value })
  settings.pinnedPlaylistIds = ['first', 'other']
  release.resolve()

  assert.equal(await update, true)
  assert.deepEqual(settings.pinnedPlaylistIds, ['first', 'local'])
})

test('edit times stay with their values when windows edit settings at once or a save fails', async () => {
  const saved = new Map()
  const locks = new Map()
  let failEditTimes = false
  const timestampSection = settingsSection('function updateSettingSyncTimestamp(', 'const settingWrites =') +
    settingsSection('/** @type {Map<string, Promise<unknown>>} */', '/**\n * Applies `update` to the saved bookmarks')
  const createWindow = () => {
    const settings = { syncServerSettingUpdatedAt: {} }
    const saveSettingEdit = vm.runInNewContext(`${timestampSection}\nsaveSettingEdit`, {
      isSettingSyncable: id => ['baseTheme', 'listType'].includes(id),
      CUSTOM_THEMES_SYNC_KEY: 'customThemes',
      // Every window shares the database and its locks.
      navigator: {
        locks: {
          request: (name, callback) => {
            const run = (locks.get(name) ?? Promise.resolve()).then(() => callback())
            locks.set(name, run.catch(() => {}))
            return run
          },
        },
      },
      DBSettingHandlers: {
        findValue: async id => structuredClone(saved.get(id)),
        upsert: async (id, value) => {
          await new Promise(resolve => setImmediate(resolve))
          if (failEditTimes) throw new Error('disk full')
          saved.set(id, structuredClone(value))
        },
      },
      console: { error () {} },
      Map,
      Date,
    })
    return {
      settings,
      save: (id, save, editedAt) => saveSettingEdit((mutation, value) => { settings.syncServerSettingUpdatedAt = value }, id, save, editedAt),
    }
  }
  const first = createWindow()
  const second = createWindow()

  await Promise.all([first.save('baseTheme', async () => {}, 1), second.save('listType', async () => {}, 2)])

  assert.deepEqual(saved.get('syncServerSettingUpdatedAt'), { baseTheme: 1, listType: 2 })
  assert.deepEqual({ ...second.settings.syncServerSettingUpdatedAt }, { baseTheme: 1, listType: 2 })

  // Sync must not count the unchanged value as a newer edit, even when both windows fail to save it.
  const fail = async () => { throw new Error('disk full') }
  await Promise.all([first.save('baseTheme', fail, 3), second.save('baseTheme', fail, 4)]
    .map(edit => assert.rejects(edit, /disk full/)))
  assert.deepEqual(saved.get('syncServerSettingUpdatedAt'), { baseTheme: 1, listType: 2 })
  assert.deepEqual({ ...first.settings.syncServerSettingUpdatedAt }, { baseTheme: 1, listType: 2 })

  // Sync must not pair the new value with the previous edit time.
  failEditTimes = true
  let valueSaved = false
  await assert.rejects(first.save('baseTheme', async () => { valueSaved = true }, 5))
  assert.equal(valueSaved, false)
})

test('settings sync waits for an optimistic edit to save its edit time', async () => {
  const syncSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
  const key = 'pinnedPlaylistIds'
  const settingWrites = createSettingWriteTracker(async () => undefined)
  const context = vm.createContext({
    areSyncSettingValuesEqual,
    mergeSettingEntry,
    mergeSettingItemsEntry,
    migrateLegacySyncedSettings,
    resolveMergedThemeEntry,
    CUSTOM_THEMES_SYNC_KEY: 'customThemes',
    SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY: 'subscriptionChannelSettings',
    PLAYLIST_PREFERENCES_SYNC_KEY: 'playlistPreferences',
    normalizeCustomThemes: value => value,
    getSyncableSettingKeys: () => [key],
    isSettingSyncEnabled: () => false,
    settingWritesSettled: () => settingWrites.settled(),
    deepCopy: structuredClone,
  })
  vm.runInContext(syncSource
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

  const now = Date.now()
  const previous = { [key]: { key, value: ['first'], updatedAt: now - 2000 } }
  const settings = { [key]: ['first'], syncServerSettingUpdatedAt: { [key]: now - 2000 }, syncServerSettingsExcluded: [] }
  const dispatched = []
  const store = {
    state: { settings, profiles: { profileList: [] }, utils: { customThemes: [] } },
    dispatch: async (action, value) => { dispatched.push([action, value]) },
  }
  // Another device edited the list after the last sync but before this window's edit.
  const client = {
    entries: [{ key, value: ['remote'], updatedAt: now - 1000 }],
    async getSettings() { return this.entries },
    async putSettings(value) { this.entries = value },
  }
  const release = deferred()
  const update = createOptimisticSettingUpdater()
  const edit = settingWrites.track(key, () => update(key, ['first', 'local'], {
    read: () => settings[key],
    commit: value => { settings[key] = value },
    persist: async () => {
      await release.promise
      settings.syncServerSettingUpdatedAt = { [key]: Date.now() }
    },
  }))

  const syncing = context.syncSettings(client, store, previous)
  setImmediate(release.resolve)
  await Promise.all([edit, syncing])

  assert.deepEqual(dispatched, [])
  assert.deepEqual(client.entries.find(entry => entry.key === key).value, ['first', 'local'])
})
