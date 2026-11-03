import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import * as rssSeenItems from '../../src/renderer/helpers/rssFeedSeenItems.js'

const {
  MAX_RSS_FEED_SEEN_ITEMS,
  createRssFeedSeenMarks,
  mergeRssFeedSeenItems,
  onRssFeedSeenItemsSynced,
  parseRssFeedSeenItems,
  syncRssFeedSeenItems,
  toRssFeedSeenMarks,
} = rssSeenItems

/** The settings database handlers of the main process, shared by all windows */
async function settingsDatabase() {
  const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const db = { settings: new Datastore({ inMemoryOnly: true }) }
  const Settings = vm.runInNewContext(source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass History {')) +
    '\nSettings', { db, ...rssSeenItems, migrateStoredSettings })
  return { db, Settings }
}

/** A window's store, whose marks the database replies update */
async function windowStore(Settings) {
  const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const context = vm.createContext({ ...rssSeenItems, DBSettingHandlers: Settings, ANDROID_PROXY_SETTING_KEYS: [] })
  vm.runInContext(source.slice(source.indexOf('const customActions ='), source.indexOf('  recordSyncSettingEdit:')) +
    '\n}\nglobalThis.actions = customActions', context)
  const state = { rssFeedSeenItems: '[]' }
  const module = {
    state,
    commit: (type, value) => {
      assert.equal(type, 'setRssFeedSeenItems')
      state.rssFeedSeenItems = value
    },
    dispatch: (type, payload) => context.actions[type](module, payload),
  }
  return { state: { settings: state }, dispatch: module.dispatch }
}

test('parsing drops malformed marks and extra fields', () => {
  assert.deepEqual(parseRssFeedSeenItems(JSON.stringify([
    { key: 'feed\na', seenAt: 1, extra: true },
    { key: 'feed\nb', unseenAt: 2, seenAt: 0 },
    { key: '', seenAt: 1 },
    { key: 'feed\nc', seenAt: 0 },
    { key: 'feed\nd', seenAt: 'soon' },
    null,
  ])), [{ key: 'feed\na', seenAt: 1 }, { key: 'feed\nb', unseenAt: 2 }])
  assert.deepEqual(parseRssFeedSeenItems('not json'), [])
  assert.deepEqual(parseRssFeedSeenItems({ key: 'feed\na', seenAt: 1 }), [])
})

test('merging keeps the latest seen and unseen times of each item and the most recent marks', () => {
  assert.deepEqual(mergeRssFeedSeenItems(
    [{ key: 'feed\nb', seenAt: 3 }, { key: 'feed\na', seenAt: 1 }],
    [{ key: 'feed\na', seenAt: 2, unseenAt: 4 }]
  ), [{ key: 'feed\na', seenAt: 2, unseenAt: 4 }, { key: 'feed\nb', seenAt: 3 }])

  const marks = Array.from({ length: MAX_RSS_FEED_SEEN_ITEMS + 1 }, (_, index) => ({ key: `feed\n${index}`, seenAt: index + 1 }))
  // Marking an old item as unseen keeps its mark
  marks[1] = { key: 'feed\n1', seenAt: 2, unseenAt: MAX_RSS_FEED_SEEN_ITEMS + 2 }
  const merged = mergeRssFeedSeenItems(marks, [])
  assert.equal(merged.length, MAX_RSS_FEED_SEEN_ITEMS)
  assert.equal(merged.some(entry => entry.key === 'feed\n0'), false)
  assert.equal(merged.some(entry => entry.key === 'feed\n1'), true)
})

test('the later of the seen and unseen marks decides', () => {
  let saved = mergeRssFeedSeenItems([], createRssFeedSeenMarks([], ['feed\na', 'feed\nb'], true, 1))
  saved = mergeRssFeedSeenItems(saved, createRssFeedSeenMarks(saved, ['feed\nb', 'feed\nc'], false, 2))
  assert.deepEqual(createRssFeedSeenMarks(saved, [], true, 3), [])
  assert.deepEqual(saved, [
    { key: 'feed\na', seenAt: 1 },
    { key: 'feed\nb', seenAt: 1, unseenAt: 2 },
    { key: 'feed\nc', unseenAt: 2 },
  ])
  assert.deepEqual(toRssFeedSeenMarks(saved), new Map([['feed\na', true], ['feed\nb', false], ['feed\nc', false]]))

  saved = mergeRssFeedSeenItems(saved, createRssFeedSeenMarks(saved, ['feed\nb'], true, 3))
  assert.equal(toRssFeedSeenMarks(saved).get('feed\nb'), true)
})

test('a new mark stays ahead of earlier marks from a device whose clock is ahead', () => {
  let saved = [{ key: 'feed\na', unseenAt: 5000 }]
  saved = mergeRssFeedSeenItems(saved, createRssFeedSeenMarks(saved, ['feed\na', 'feed\nb'], true, 1000))
  assert.deepEqual(saved, [
    { key: 'feed\na', seenAt: 5001, unseenAt: 5000 },
    { key: 'feed\nb', seenAt: 1000 },
  ])
  assert.equal(toRssFeedSeenMarks(saved).get('feed\na'), true)

  // Marks in the same millisecond keep their order
  saved = mergeRssFeedSeenItems(saved, createRssFeedSeenMarks(saved, ['feed\nb'], false, 1000))
  assert.equal(toRssFeedSeenMarks(saved).get('feed\nb'), false)
})

test('the marks are saved in the settings database and ignore malformed keys', async () => {
  const { db, Settings } = await settingsDatabase()
  const value = await Settings.mergeSeenRssItems({ keys: ['feed\na', '', null], seen: true })
  assert.deepEqual(JSON.parse(value).map(entry => entry.key), ['feed\na'])
  assert.equal((await db.settings.findOneAsync({ _id: 'rssFeedSeenItems' })).value, value)
  await Settings.mergeSeenRssItems({ keys: ['feed\na'], seen: false })
  assert.equal(toRssFeedSeenMarks((await db.settings.findOneAsync({ _id: 'rssFeedSeenItems' })).value).get('feed\na'), false)
})

test('syncing merges both sides, reports the marks and uploads them', async () => {
  const { Settings } = await settingsDatabase()
  const store = await windowStore(Settings)
  await store.dispatch('mergeRssFeedSeenItems', [{ key: 'feed\nlocal', seenAt: 2 }])
  const reported = []
  onRssFeedSeenItemsSynced(entries => reported.push(entries))
  let uploaded
  const count = await syncRssFeedSeenItems({
    getSeenRssItems: async () => {
      // A mark recorded while the download runs is kept
      await store.dispatch('mergeRssFeedSeenItems', [{ key: 'feed\nduring', seenAt: 3 }])
      return [{ key: 'feed\nremote', seenAt: 1 }, { key: 'feed\nlocal', unseenAt: 4 }]
    },
    putSeenRssItems: async entries => { uploaded = entries },
  }, store)
  const expected = [
    { key: 'feed\nduring', seenAt: 3 },
    { key: 'feed\nlocal', seenAt: 2, unseenAt: 4 },
    { key: 'feed\nremote', seenAt: 1 },
  ]
  assert.equal(count, 3)
  assert.deepEqual(uploaded, expected)
  assert.deepEqual(JSON.parse(store.state.settings.rssFeedSeenItems), expected)
  assert.deepEqual(reported, [expected])
})

test('a mark saved in another window while a sync writes is kept', async () => {
  const { db, Settings } = await settingsDatabase()
  const syncing = await windowStore(Settings)
  const marking = await windowStore(Settings)
  await syncRssFeedSeenItems({
    getSeenRssItems: async () => {
      // Neither window waits for the other's write
      marking.dispatch('mergeRssFeedSeenItems', { keys: ['feed\nmarked'], seen: true })
      return [{ key: 'feed\nremote', seenAt: 1 }]
    },
    putSeenRssItems: async () => {},
  }, syncing)
  await Settings.runSeenStateUpdate(() => {})
  const saved = (await db.settings.findOneAsync({ _id: 'rssFeedSeenItems' })).value
  assert.deepEqual(toRssFeedSeenMarks(saved), new Map([['feed\nmarked', true], ['feed\nremote', true]]))
})

test('a delayed database reply keeps newer marks of the window', async () => {
  const { Settings } = await settingsDatabase()
  const store = await windowStore(Settings)
  const older = await Settings.mergeSeenRssItems({ keys: ['feed\na'], seen: true })
  const newer = await Settings.mergeSeenRssItems({ keys: ['feed\nb'], seen: true })
  await store.dispatch('applyRssFeedSeenItems', newer)
  await store.dispatch('applyRssFeedSeenItems', older)
  assert.equal(store.state.settings.rssFeedSeenItems, newer)
})
