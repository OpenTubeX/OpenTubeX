import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import Datastore from '@seald-io/nedb'
import model from '@seald-io/nedb/lib/model.js'
import { toRaw, ref, computed } from 'vue'
import { createStore } from 'vuex'
import * as historyHelpers from '../../src/history.js'
import * as seenHelpers from '../../src/subscriptionSeenVideos.js'
import { DBActions, IpcChannels, SyncEvents } from '../../src/constants.js'

const source = await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8')
const baseSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const record = videoId => ({ videoId, isWatched: false, isMembersOnly: false, watchProgress: 123, lengthSeconds: 200, timeWatched: 1 })

async function fixture(fail = false) {
  const db = { history: new Datastore({ inMemoryOnly: true }), settings: new Datastore({ inMemoryOnly: true }) }
  const savedMarks = [
    { videoId: 'unseen', seenAt: 100, unseenAt: 100, isMembersOnly: true },
    { videoId: 'seen', seenAt: 200, unseenAt: 100 },
  ]
  await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify(savedMarks) })
  const records = ['unseen', 'seen', 'unrelated'].map(record)
  await db.history.insertAsync(records)
  const baseDependencies = { model, db, ...historyHelpers, ...seenHelpers, HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated', console: { error() {} } }
  const History = compileFunction(baseSource.slice(baseSource.indexOf('class Settings {'), baseSource.indexOf('\nclass WatchStats {'))
    + '\nreturn History', Object.keys(baseDependencies))(...Object.values(baseDependencies))
  if (fail) History.updateSubscriptionState = async () => { throw new Error('history persistence failed') }
  const dependencies = { ...historyHelpers, model, DBHistoryHandlers: History, console: { error() {} } }
  const module = compileFunction(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'), Object.keys(dependencies))(...Object.values(dependencies))
  const appliedMarks = []
  const context = {
    state: module.state,
    commit: (type, payload) => module.mutations[type](module.state, payload),
    dispatch: async (type, payload) => {
      if (type === 'applySubscriptionSeenVideos') appliedMarks.push(JSON.parse(payload))
      else return module.actions[type](context, payload)
    },
  }
  context.commit('setHistoryCacheSorted', structuredClone(records))
  context.commit('setHistoryCacheById', Object.fromEntries(context.state.historyCacheSorted.map(entry => [entry.videoId, entry])))
  return { context, db, appliedMarks, savedMarks, handlers: History, module }
}

test('portable overwrite cache agrees with NeDB when duplicate timestamps are equal', async () => {
  const f = await fixture()
  const records = [...await f.db.history.findAsync({}), { _id: 'z', videoId: 'equal', timeWatched: 400, isWatched: false }, { _id: 'a', videoId: 'equal', timeWatched: 400, isWatched: true }]
  assert.equal(await f.module.actions.overwriteHistory(f.context, new Map(records.map(record => [record._id, record]))), true)
  assert.deepEqual(toRaw(f.context.state.historyCacheById.equal), (await f.handlers.find()).find(record => record.videoId === 'equal'))
})

for (const bulk of [false, true]) {
  test(`${bulk ? 'bulk' : 'individual'} mark as watched persists and applies seen marks without changing playback metadata`, async () => {
    const f = await fixture()
    if (bulk) {
      assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 3)
    } else {
      for (const videoId of ['unseen', 'seen', 'unrelated']) {
        await f.context.dispatch('updateHistory', { ...record(videoId), isWatched: true })
      }
    }
    for (const videoId of ['unseen', 'seen', 'unrelated']) {
      const persisted = await f.db.history.findOneAsync({ videoId })
      assert.equal(persisted.isWatched, true)
      assert.equal(persisted.watchProgress, 123)
      assert.equal(persisted.timeWatched, 1)
      assert.deepEqual(f.context.state.historyCacheById[videoId], persisted)
    }
    const saved = JSON.parse((await f.db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value)
    const unseen = saved.find(mark => mark.videoId === 'unseen')
    assert.ok(unseen.seenAt > unseen.unseenAt)
    assert.equal(unseen.isMembersOnly, false)
    assert.deepEqual(f.appliedMarks.at(-1), saved)
    assert.equal(saved.some(mark => mark.videoId === 'unrelated'), false)
  })

  test(`${bulk ? 'bulk' : 'individual'} failed history persistence leaves renderer and marks unchanged`, async () => {
    const f = await fixture(true)
    if (bulk) assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 0)
    else await f.context.dispatch('updateHistory', { ...record('unseen'), isWatched: true })
    assert.equal(f.context.state.historyCacheById.unseen.isWatched, false)
    assert.deepEqual(f.appliedMarks, [])
  })
}

test('saving an unwatched history record preserves active unseen marks', async () => {
  const f = await fixture()
  await f.context.dispatch('updateHistory', record('unseen'))
  assert.deepEqual(JSON.parse((await f.db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value), f.savedMarks)
  for (const marks of f.appliedMarks) assert.deepEqual(marks, f.savedMarks)
})

test('marking unseen commits the latest persisted progress instead of stale renderer history', async () => {
  const f = await fixture()
  await f.db.history.updateAsync({ videoId: 'unseen' }, { $set: { isWatched: true, watchProgress: 170 } })
  assert.equal(await f.context.dispatch('updateSubscriptionHistory', { unseenVideo: { videoId: 'unseen', isMembersOnly: false } }), 1)
  const cached = f.context.state.historyCacheById.unseen
  assert.equal(cached.isWatched, false)
  assert.equal(cached.watchProgress, 170)
  assert.equal(cached.timeWatched, 1)
  assert.deepEqual(cached, await f.db.history.findOneAsync({ videoId: 'unseen' }))
  assert.equal(f.appliedMarks.at(-1).find(mark => mark.videoId === 'unseen').unseenAt >= 100, true)
})

test('marking unseen without history applies saved marks without creating a renderer record', async () => {
  const f = await fixture()
  assert.equal(await f.context.dispatch('updateSubscriptionHistory', { unseenVideo: { videoId: 'no-history', isMembersOnly: false } }), 0)
  assert.equal(f.context.state.historyCacheById['no-history'], undefined)
  assert.equal(f.appliedMarks.at(-1).some(mark => mark.videoId === 'no-history'), true)
})

test('bulk watched action reports saved history when writing the seen marker fails', async () => {
  const f = await fixture()
  f.db.settings.updateAsync = async () => { throw new Error('Seen marker persistence failed') }
  assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 3)
  for (const videoId of ['unseen', 'seen', 'unrelated']) {
    assert.equal(f.context.state.historyCacheById[videoId].isWatched, true)
    assert.equal(f.context.state.historyCacheById[videoId].watchProgress, 123)
    assert.equal((await f.db.history.findOneAsync({ videoId })).isWatched, true)
  }
  assert.deepEqual(f.appliedMarks, [])
})

test('bulk watched updates preserve the order of entries with equal history timestamps', async () => {
  const f = await fixture()
  const middle = f.context.state.historyCacheById.seen
  middle.isWatched = true
  await f.db.history.updateAsync({ videoId: 'seen' }, { $set: { isWatched: true } })
  const before = f.context.state.historyCacheSorted.map(entry => entry.videoId)
  assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 2)
  assert.deepEqual(f.context.state.historyCacheSorted.map(entry => entry.videoId), before)
})

test('the production renderer repair updates each duplicate occurrence and keeps the newest playback cache', async () => {
  const f = await fixture()
  const original = [
    { ...record('abcdefghijk'), _id: 'new', title: 'Newer', author: 'Channel', authorId: 'channel', published: 1, timeWatched: 20, lengthSeconds: 0, isLive: true, unknown: new Date(123), lastViewedPlaylistItemId: 'new-member' },
    { ...record('abcdefghijk'), _id: 'old', title: 'Older', author: 'Channel', authorId: 'channel', published: 1, timeWatched: 10, watchProgress: 25, lengthSeconds: 0, isLive: true, unknown: { keep: true }, lastViewedPlaylistItemId: 'old-member' },
  ]
  await f.db.history.removeAsync({}, { multi: true })
  await f.db.history.insertAsync(original)
  f.context.commit('setHistoryCacheSorted', structuredClone(original))
  f.context.commit('setHistoryCacheById', { abcdefghijk: f.context.state.historyCacheSorted[0] })
  const store = { state: { history: f.context.state }, getters: {}, dispatch: f.context.dispatch }
  for (const name of ['getHistoryCacheSorted', 'getHistoryCacheById', 'getHistoryCacheByRecordId']) {
    Object.defineProperty(store.getters, name, { get: () => f.module.getters[name]?.(f.context.state) })
  }
  const repair = await import('../../src/historyRepair.js')
  const source = await readFile(new URL('../../src/renderer/helpers/historyRepair.js', import.meta.url), 'utf8')
  const dependencies = {
    store, ...repair, repairHistory: options => repair.repairHistory({ wait: async () => {}, ...options }),
    ref, computed, reactive: value => value, process: { env: { IS_ELECTRON: false, SUPPORTS_LOCAL_API: false } },
    getInvidiousHistoryMetadata: async videoId => ({ videoId, published: 1, lengthSeconds: 120, liveNow: false, isUpcoming: false }),
  }
  const helper = compileFunction(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replaceAll('export ', '')
    + '\nreturn { startHistoryRepair, historyRepairState }', Object.keys(dependencies))(...Object.values(dependencies))
  await helper.startHistoryRepair()
  const expected = original.map(row => ({ ...row, lengthSeconds: 120, isLive: false, liveNow: false, isUpcoming: false }))
  assert.deepEqual(await f.db.history.findAsync({}).sort({ timeWatched: -1 }), expected)
  assert.deepEqual(f.context.state.historyCacheSorted, expected)
  assert.deepEqual(f.context.state.historyCacheById.abcdefghijk, expected[0])
  assert.equal(helper.historyRepairState.repaired, 2)
  assert.equal(helper.historyRepairState.failed, 0)
  assert.equal(helper.historyRepairState.phase, 'finished')
})

test('repairing only an older occurrence preserves the newest playback cache and every other row', async () => {
  const f = await fixture()
  const original = [
    { ...record('same'), _id: 'new', title: 'Newest', timeWatched: 20, unknown: new Date(123) },
    { ...record('same'), _id: 'old', title: 'Older', timeWatched: 10, unknown: { keep: true } },
  ]
  await f.db.history.removeAsync({}, { multi: true })
  await f.db.history.insertAsync(original)
  f.context.commit('setHistoryCacheSorted', structuredClone(original))
  f.context.commit('setHistoryCacheById', { same: f.context.state.historyCacheSorted[0] })
  const newest = f.context.state.historyCacheById.same
  await f.context.dispatch('updateSubscriptionHistory', { metadata: [{ _id: 'old', videoId: 'same', title: 'Repaired older' }] })
  const expected = [original[0], { ...original[1], title: 'Repaired older' }]
  assert.deepEqual(await f.db.history.findAsync({}).sort({ timeWatched: -1 }), expected)
  assert.deepEqual(f.context.state.historyCacheSorted, expected)
  assert.equal(f.context.state.historyCacheById.same, newest)
})

for (const repairedIds of [['old'], ['new'], ['old', 'new']]) {
  test(`cross-window metadata repair preserves duplicate occurrences when repairing ${repairedIds.join(' and ')}`, async () => {
    const f = await fixture()
    const original = [
      { ...record('same'), _id: 'new', title: 'Newest', timeWatched: 20, unknown: new Date(123), lastViewedPlaylistItemId: 'new-member' },
      { ...record('same'), _id: 'old', title: 'Older', timeWatched: 10, watchProgress: 25, unknown: { keep: true }, lastViewedPlaylistItemId: 'old-member' },
    ]
    await f.db.history.removeAsync({}, { multi: true })
    await f.db.history.insertAsync(original)
    await f.db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
    f.context.rootGetters = { getHistoryRetentionDays: 0 }
    f.context.commit('setHistoryCacheSorted', structuredClone(original))
    f.context.commit('setHistoryCacheById', { same: f.context.state.historyCacheSorted[0] })

    const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
    const listenerStart = settingsSource.indexOf('window.ftElectron.handleSyncHistory(')
    const listenerEnd = settingsSource.indexOf('window.ftElectron.handleSyncWatchStats(', listenerStart)
    assert.ok(listenerStart >= 0 && listenerEnd > listenerStart)
    let receiveHistory
    const refreshes = []
    const receiverDependencies = {
      window: { ftElectron: { handleSyncHistory: listener => { receiveHistory = listener } } },
      SyncEvents, commit: f.context.commit,
      dispatch: (...args) => {
        const pending = f.context.dispatch(...args)
        refreshes.push(pending)
        return pending
      },
    }
    compileFunction(settingsSource.slice(listenerStart, listenerEnd), Object.keys(receiverDependencies))(...Object.values(receiverDependencies))

    const mainSource = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
    const handlerStart = mainSource.indexOf('ipcMain.handle(IpcChannels.DB_HISTORY,')
    const handlerEnd = mainSource.indexOf('ipcMain.handle(IpcChannels.DB_RECOMMENDATIONS,', handlerStart)
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart)
    let handleHistory
    const broadcasts = []
    const senderDependencies = {
      ipcMain: { handle: (channel, handler) => { assert.equal(channel, IpcChannels.DB_HISTORY); handleHistory = handler } },
      IpcChannels, DBActions, SyncEvents, baseHandlers: { history: f.handlers }, isOpenTubeXUrl: () => true,
      syncOtherWindows: (channel, event, payload) => {
        assert.equal(channel, IpcChannels.SYNC_HISTORY)
        broadcasts.push(payload)
        receiveHistory(payload.event, structuredClone(payload.data))
      },
    }
    compileFunction(mainSource.slice(handlerStart, handlerEnd), Object.keys(senderDependencies))(...Object.values(senderDependencies))
    const metadata = repairedIds.map(_id => ({ _id, videoId: 'same', title: `Repaired ${_id}`, lengthSeconds: 120 }))
    await handleHistory({ senderFrame: { url: 'app://opentubex' } }, { action: DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE, data: { metadata } })
    await Promise.all(refreshes)

    const expected = original.map(row => repairedIds.includes(row._id) ? { ...row, title: `Repaired ${row._id}`, lengthSeconds: 120 } : row)
    assert.equal(broadcasts.length, 1, 'a repair batch broadcasts once')
    assert.deepEqual(await f.db.history.findAsync({}).sort({ timeWatched: -1 }), expected)
    assert.deepEqual(f.context.state.historyCacheSorted, expected)
    assert.deepEqual(f.context.state.historyCacheByRecordId, Object.assign(Object.create(null), Object.fromEntries(expected.map(row => [row._id, row]))))
    assert.deepEqual(f.context.state.historyCacheById.same, expected[0], 'playback still uses the newest occurrence')
  })
}

for (const failedRead of [false, true]) {
  test(`portable history overwrite caches durable IDs without a subsequent ${failedRead ? 'failed' : 'successful'} read`, async () => {
    const db = { history: new Datastore({ inMemoryOnly: true }), settings: new Datastore({ inMemoryOnly: true }) }
    await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
    const baseSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const baseDependencies = { model, db, ...historyHelpers, HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated', recommendations: { async remove() {} } }
    const History = compileFunction(baseSource.slice(baseSource.indexOf('class Settings {'), baseSource.indexOf('\nclass WatchStats {')) + '\nreturn History', Object.keys(baseDependencies))(...Object.values(baseDependencies))
    const readHistory = History.find.bind(History)
    let readAttempts = 0
    History.find = async () => {
      readAttempts++
      if (failedRead) throw new Error('simulated post-overwrite read failure')
      return readHistory()
    }
    const source = (await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8'))
      .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replace('export default ', 'return ')
    const dependencies = { model, ...historyHelpers, toRaw, process: { env: { IS_ELECTRON: false } }, DBHistoryHandlers: History }
    const history = compileFunction(source, Object.keys(dependencies))(...Object.values(dependencies))
    const store = createStore({ modules: { history } })
    const imported = { videoId: 'abcdefghijk', title: 'Imported', timeWatched: 1, watchProgress: 12, isWatched: true, unknown: new Date(1) }
    assert.equal(await store.dispatch('overwriteHistory', new Map([[imported.videoId, imported]])), true)
    const persisted = await readHistory()
    assert.equal(typeof persisted[0]._id, 'string')
    assert.deepEqual(toRaw(store.state.history.historyCacheSorted), persisted)
    assert.deepEqual(toRaw(store.state.history.historyCacheById[imported.videoId]), persisted[0])
    assert.deepEqual(await store.dispatch('updateSubscriptionHistory', { metadata: [{ _id: persisted[0]._id, videoId: imported.videoId, title: 'Repaired', author: 'Author', lengthSeconds: 120 }] }), { repaired: 1, failed: 0 })
    const repaired = await readHistory()
    assert.deepEqual(toRaw(store.state.history.historyCacheSorted), repaired)
    assert.deepEqual(toRaw(store.state.history.historyCacheByRecordId[repaired[0]._id]), repaired[0])
    assert.deepEqual(toRaw(store.state.history.historyCacheById[imported.videoId]), repaired[0])
    assert.deepEqual(repaired[0], { ...persisted[0], title: 'Repaired', author: 'Author', lengthSeconds: 120 })
    assert.equal(Object.hasOwn(imported, '_id'), false, 'the original import object stays unchanged')
    assert.equal(await store.dispatch('overwriteHistory', new Map()), true)
    assert.deepEqual(await readHistory(), [])
    assert.deepEqual(toRaw(store.state.history.historyCacheSorted), [])
    assert.deepEqual(toRaw(store.state.history.historyCacheById), {})
    assert.equal(readAttempts, 0, 'cache updates must not require a second datastore read')
  })
}

for (const [firstId, secondId] of [[1, '1'], [true, 'true'], [0, '0'], [false, 'false']]) {
  test(`renderer repair keeps typed legacy IDs ${typeof firstId}/${typeof secondId} distinct for ${String(firstId)}`, async () => {
    const f = await fixture()
    const original = [
      { ...record('abcdefghijk'), _id: firstId, title: 'Newer', author: 'Channel', authorId: 'channel', published: 1, timeWatched: 20, lengthSeconds: 0, isLive: true, unknown: new Date(123), lastViewedPlaylistItemId: 'new-member' },
      { ...record('abcdefghijk'), _id: secondId, title: 'Older', author: 'Channel', authorId: 'channel', published: 1, timeWatched: 10, watchProgress: 25, lengthSeconds: 0, isLive: true, unknown: { keep: true }, lastViewedPlaylistItemId: 'old-member' },
    ]
    await f.db.history.removeAsync({}, { multi: true })
    await f.db.history.insertAsync(original)
    f.context.commit('setHistoryCacheSorted', structuredClone(original))
    f.context.commit('setHistoryCacheById', { abcdefghijk: f.context.state.historyCacheSorted[0] })
    const store = { state: { history: f.context.state }, getters: {}, dispatch: f.context.dispatch }
    for (const name of ['getHistoryCacheSorted', 'getHistoryCacheById', 'getHistoryCacheByRecordId']) {
      Object.defineProperty(store.getters, name, { get: () => f.module.getters[name]?.(f.context.state) })
    }
    const repair = await import('../../src/historyRepair.js')
    const source = await readFile(new URL('../../src/renderer/helpers/historyRepair.js', import.meta.url), 'utf8')
    const dependencies = {
      store, ...repair, repairHistory: options => repair.repairHistory({ wait: async () => {}, ...options }),
      ref, computed, reactive: value => value, process: { env: { IS_ELECTRON: false, SUPPORTS_LOCAL_API: false } },
      getInvidiousHistoryMetadata: async videoId => ({ videoId, published: 1, lengthSeconds: 120, liveNow: false, isUpcoming: false }),
    }
    const helper = compileFunction(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replaceAll('export ', '')
      + '\nreturn { startHistoryRepair, historyRepairState }', Object.keys(dependencies))(...Object.values(dependencies))
    await helper.startHistoryRepair()
    const expected = original.map(row => ({ ...row, lengthSeconds: 120, isLive: false, liveNow: false, isUpcoming: false }))
    assert.deepEqual(await f.db.history.findAsync({}).sort({ timeWatched: -1 }), expected)
    assert.deepEqual(f.context.state.historyCacheSorted, expected)
    assert.deepEqual(f.context.state.historyCacheById.abcdefghijk, expected[0])
    assert.equal(helper.historyRepairState.repaired, 2)
    assert.equal(helper.historyRepairState.failed, 0)
    assert.equal(helper.historyRepairState.phase, 'finished')
  })
}

test('stable history keys retain legacy ID types through reordering and metadata repair', async () => {
  const source = await readFile(new URL('../../src/renderer/components/FtElementList/FtElementList.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function getResultKey(')
  const key = compileFunction(source.slice(start, source.indexOf('\nconst resultKeys', start)) + '\nreturn getResultKey', ['props'])({ stableItemKeys: true, dataType: 'video' })
  const rows = [1, '1', true, 'true', 0, '0', false, 'false'].map(_id => ({ _id, videoId: 'duplicate' }))
  const keys = rows.map(key)
  assert.equal(new Set(keys).size, rows.length)
  assert.deepEqual(rows.toReversed().map(key), keys.toReversed())
  assert.deepEqual(rows.map(row => key({ ...row, title: 'Repaired metadata' }, 99)), keys)
})


test('portable repair rejects an occurrence whose video changed while metadata was fetched', async () => {
  const f = await fixture()
  const original = { ...record('abcdefghijk'), _id: 'reused', title: 'Old video', author: 'Channel', lengthSeconds: 0, unknown: new Date(1) }
  const replacement = { ...original, videoId: 'lmnopqrstuv', title: 'Replacement', watchProgress: 88, unknown: { keep: true } }
  await f.db.history.removeAsync({}, { multi: true })
  await f.db.history.insertAsync(original)
  f.context.commit('setHistoryCacheSorted', [original])
  f.context.commit('setHistoryCacheById', { abcdefghijk: original })
  const store = { state: { history: f.context.state }, getters: {}, dispatch: f.context.dispatch }
  for (const name of ['getHistoryCacheSorted', 'getHistoryCacheById', 'getHistoryCacheByRecordId']) {
    Object.defineProperty(store.getters, name, { get: () => f.module.getters[name](f.context.state) })
  }
  const repair = await import('../../src/historyRepair.js')
  const source = await readFile(new URL('../../src/renderer/helpers/historyRepair.js', import.meta.url), 'utf8')
  const dependencies = {
    store, ...repair, repairHistory: options => repair.repairHistory({ wait: async () => {}, ...options }),
    ref, computed, reactive: value => value, process: { env: { IS_ELECTRON: false, SUPPORTS_LOCAL_API: false } },
    getInvidiousHistoryMetadata: async videoId => {
      await f.db.history.updateAsync({ _id: 'reused' }, replacement)
      f.context.commit('setHistoryCacheSorted', [replacement])
      f.context.commit('setHistoryCacheById', { lmnopqrstuv: replacement })
      return { videoId, title: 'Fetched old video', author: 'Fetched channel', lengthSeconds: 120, published: 1, liveNow: false }
    },
  }
  const helper = compileFunction(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '').replaceAll('export ', '')
    + '\nreturn { startHistoryRepair, historyRepairState }', Object.keys(dependencies))(...Object.values(dependencies))
  await helper.startHistoryRepair()
  assert.deepEqual(await f.db.history.findAsync({}), [replacement])
  assert.deepEqual(f.context.state.historyCacheSorted, [replacement])
  assert.equal(helper.historyRepairState.repaired, 0)
})

test('NeDB desktop reads and overwrite broadcasts use the same occurrence tie order', async () => {
  const f = await fixture()
  await f.db.settings.updateAsync({ _id: 'historyWatchedStatusMigrated' }, { _id: 'historyWatchedStatusMigrated', value: true }, { upsert: true })
  await f.db.history.removeAsync({}, { multi: true })
  const older = { ...record('same'), _id: 'a', watchProgress: 12, isWatched: false, unknown: new Date(1) }
  const newest = { ...record('same'), _id: 'z', watchProgress: 88, isWatched: true, unknown: new Date(2) }
  await f.db.history.insertAsync([older, newest])
  assert.deepEqual(await f.handlers.find(), [newest, older])
  assert.deepEqual(await f.handlers.overwrite([older, newest]), [newest, older], 'broadcast data must already have the same ordering as a subsequent desktop load')
  const imported = [older, newest].map(({ _id, ...entry }) => entry)
  const saved = await f.handlers.overwrite(imported)
  assert.deepEqual(saved, saved.toSorted((a, b) => model.compareThings(b.timeWatched, a.timeWatched) || model.compareThings(b._id, a._id)))
  assert.deepEqual(await f.handlers.find(), saved)
  assert.deepEqual(saved.map(({ _id, ...entry }) => entry).toSorted((a, b) => a.watchProgress - b.watchProgress), imported)
})
