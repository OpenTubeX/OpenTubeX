import model from '@seald-io/nedb/lib/model.js'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import vm from 'node:vm'
import { babelParse, parse } from 'vue/compiler-sfc'
import { computed, nextTick, reactive, ref as vueRef, watch } from 'vue'
import { DatabaseSync } from 'node:sqlite'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { LibraryJobs } from '../../src/main/libraryJobs.js'
import { markSubscriptionEntries } from '../../src/datastores/sqlite/subscriptions.js'
import * as operations from '../../src/datastores/sqlite/operations.js'
import { LibrarySync } from '../../src/datastores/sqlite/sync.js'
import { LibraryImports } from '../../src/datastores/sqlite/import.js'
import { getSortedPlaylistItems, processToBeAddedPlaylistVideo } from '../../src/renderer/helpers/playlists.js'
import { mergeIds, videoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import Datastore from '@seald-io/nedb'
import { DEFAULT_SEARCH_SETTINGS, mergeSearchHistoryEntries, normalizeSearchHistoryEntry, normalizeSearchSettings } from '../../src/search-history.js'

const sources = new Map()
async function source(file) {
  if (!sources.has(file)) {
    let script = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) script = parse(script).descriptor.scriptSetup.content
    sources.set(file, { script, ast: babelParse(script, { sourceType: 'module' }) })
  }
  return sources.get(file)
}

function matching(root, predicate) {
  const found = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (predicate(node)) found.push(node)
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(root)
  return found
}

async function functions(file, names, bindings = {}) {
  if (file === 'src/renderer/store/modules/playlists.js' && !names.includes('updateCachedPlaylistMembers')) names = [...names, 'updateCachedPlaylistMembers']
  if (file === 'src/renderer/components/PlaylistInfo/PlaylistInfo.vue' && !names.includes('playablePlaylistVideos')) names = [...names, 'playablePlaylistVideos']
  const { script, ast } = await source(file)
  const context = vm.createContext({ process: { env: { IS_ELECTRON: true } }, console: { error() {} }, ...bindings })
  if (file === 'src/renderer/views/Playlist/Playlist.vue') {
    for (const name of ['playlistReordering', 'playlistOrderReady']) {
      if (Object.hasOwn(bindings, name)) continue
      const declaration = matching(ast, node => node.type === 'VariableDeclarator' && node.id?.name === name)[0]
      if (declaration) context[name] = vm.runInNewContext(script.slice(declaration.init.start, declaration.init.end), { ref: vueRef })
    }
  }
  for (const name of names) {
    const declaration = matching(ast, node => node.type === 'FunctionDeclaration' && node.id?.name === name).at(-1)
    const property = matching(ast, node => node.type === 'ObjectProperty' && node.key?.name === name && node.value?.type === 'FunctionExpression').at(-1)
    const method = matching(ast, node => node.type === 'ObjectMethod' && node.key?.name === name).at(-1)
    const node = declaration ?? property?.value ?? method
    assert.ok(node, `${file} must contain the actual ${name} function`)
    const code = node.type === 'ObjectMethod'
      ? `${node.async ? 'async ' : ''}function(${node.params.map(param => script.slice(param.start, param.end)).join(',')})${script.slice(node.body.start, node.body.end)}`
      : script.slice(node.start, node.end)
    context[name] = vm.runInContext(`(${code})`, context)
  }
  return context
}

const ref = value => ({ value })
const dataSettings = 'src/renderer/components/DataSettings/DataSettings.vue'
const playlistInfo = 'src/renderer/components/PlaylistInfo/PlaylistInfo.vue'

test('portable restore preflights every selected playlist merge before profiles or earlier playlists are written', async () => {
  const { mergeBackupPlaylist, mergeBackupProfile } = await import('../../src/renderer/helpers/unifiedBackup.js')
  const retained = { _id: 'late', playlistName: 'Opaque', videos: null, unknown: new Date(0) }
  const data = { profiles: [{ _id: 'profile', name: 'Imported', subscriptions: [] }], playlists: [
    { _id: 'early', playlistName: 'Earlier', videos: [] }, { _id: 'late', playlistName: 'Incoming', videos: [] },
  ] }
  const writes = [], toasts = []
  const context = await functions(dataSettings, ['importUnifiedBackup'], {
    process: { env: { IS_ELECTRON: false } }, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
    backupBusy: ref(false), selectedBackupSections: ref(['profiles', 'playlists']), backupData: ref(data),
    DBProfileHandlers: { find: async () => [], upsert: async record => writes.push(record) },
    DBPlaylistHandlers: { find: async () => [retained] }, mergeBackupProfile, mergeBackupPlaylist,
    store: { dispatch: async (action, record) => { if (action === 'updatePlaylist') writes.push(record); return true } },
    t: key => key, showToast: toast => toasts.push(toast),
  })
  await context.importUnifiedBackup()
  assert.deepEqual(writes, [])
  assert.match(toasts.at(-1).message, /Cannot merge incompatible/)
  assert.equal(context.backupBusy.value, false)
})

test('portable restore rejects unsupported selected profiles before any write but permits restoring other sections', async () => {
  const { mergeBackupProfile } = await import('../../src/renderer/helpers/unifiedBackup.js')
  for (const subscriptions of [undefined, null, 42, [null, { id: 'channel' }]]) {
    for (const selected of [['profiles', 'settings'], ['settings']]) {
      const writes = [], toasts = []
      const context = await functions(dataSettings, ['importUnifiedBackup'], {
        process: { env: { IS_ELECTRON: false } }, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
        backupBusy: ref(false), selectedBackupSections: ref(selected), backupData: ref({ profiles: [{ _id: 'p', name: 'Retained', ...(subscriptions === undefined ? {} : { subscriptions }) }], settings: { theme: 'dark' } }),
        DBProfileHandlers: { find: async () => [], upsert: async record => writes.push(record) }, mergeBackupProfile,
        store: { dispatch: async () => true }, applyImportedSettings: async settings => writes.push(settings),
        compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => toasts.push(toast),
      })
      await context.importUnifiedBackup()
      assert.deepEqual(writes, selected.includes('profiles') ? [] : [{ theme: 'dark' }])
      if (selected.includes('profiles')) assert.match(toasts.at(-1).message, /Invalid backup profiles/)
      assert.equal(context.backupBusy.value, false)
    }
  }
})

test('desktop display summaries tolerate retained opaque memberships without marking them writable', async () => {
  const context = await functions('src/renderer/store/modules/playlists.js', ['summarizePlaylist'])
  for (const videos of [undefined, null, false, 42, 'retained', {}, [], [null]]) {
    const playlist = { _id: 'p', videos, videoCount: Array.isArray(videos) ? videos.length : 0, firstVideo: null }, before = structuredClone(playlist)
    const summary = context.summarizePlaylist(playlist)
    assert.equal(summary.videoCount, Array.isArray(videos) ? videos.length : 0)
    assert.equal(Array.isArray(summary.videos), Array.isArray(videos))
    assert.deepEqual(playlist, before)
  }
})

for (const operation of ['cleanupUserPlaylist', 'handleRemoveDeadVideosPromptAnswer']) {
  for (const refresh of ['grabAllPlaylists', 'grabHistory']) {
    test(`${operation} reports committed removal despite ${refresh} failure`, async () => {
      const toasts = [], errors = [], dispatched = []
      const context = await functions(playlistInfo, [operation], {
        process: { env: { IS_ELECTRON: true } }, props: { id: 'p' },
        showRemoveDeadVideosPrompt: ref(true), deadVideoItemIds: ref(new Set(['member'])),
        DBLibraryHandlers: { query: async () => 1 },
        store: { dispatch: async action => { dispatched.push(action); if (action === refresh) throw new Error('refresh unavailable') } },
        console: { error: error => errors.push(error) }, t: key => key, showToast: toast => toasts.push(toast),
      })
      await context[operation](operation === 'cleanupUserPlaylist' ? 'duplicates' : 'delete')
      assert.equal(toasts.length, 1)
      assert.match(toasts[0].message, /have been removed/)
      assert.deepEqual(dispatched, ['scheduleSyncServer', 'grabAllPlaylists', 'grabHistory'])
      assert.equal(errors.length, 1)
      assert.equal(context.deadVideoItemIds.value.size, operation === 'cleanupUserPlaylist' ? 1 : 0)
    })
  }
}

for (const action of ['upload', 'delete']) {
  test(`playlist sync acknowledges a completed remote ${action} before retrying a concurrent local edit`, async t => {
    const database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
    t.after(() => database.close())
    const engine = new LibraryEngine(database), sync = new LibrarySync(engine)
    const video = id => ({ videoId: id, title: id, author: 'Author', authorId: 'channel', lengthSeconds: 120, unknown: { keep: true } })
    const kept = video('kept'), changed = video('changed')
    const edited = { ...changed, title: 'Re-added locally', playlistItemId: 'new-local-occurrence' }
    const playlist = { _id: 'p', playlistName: 'Before', description: 'Original', videos: action === 'upload' ? [kept, changed] : [kept], unknown: { keep: true } }
    await engine.collections.playlists.insertAsync(playlist)
    const account = ['server', 'token', 'legacy', '', '']
    await engine.collections.settings.insertAsync(Object.entries({ syncServerUrl: 'server', syncServerToken: 'token', syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '', syncServerPrivacySalt: '', syncServerEnabled: true, syncServerSnapshot: JSON.stringify({ history: { keep: true }, playlists: { p: { remoteId: 'p', metadata: { title: 'Before', description: 'Original' }, videos: action === 'upload' ? ['kept'] : ['kept', 'changed'], unknown: { keep: true } } } }) }).map(([_id, value]) => ({ _id, value })))
    const server = new Map((action === 'upload' ? [kept] : [kept, changed]).map(video => [video.videoId, videoToRemote(video)]))
    let editedDuringWrite = false
    const client = {
      async addPlaylistVideos(_id, records) {
        for (const record of records) server.set(record.id, record)
        if (action === 'upload' && !editedDuringWrite) {
          editedDuringWrite = true
          await engine.collections.playlists.updateAsync({ _id: 'p' }, { $pull: { videos: { videoId: 'changed' } } })
        }
      },
      async removePlaylistVideo(_id, id) {
        server.delete(id)
        if (action === 'delete' && !editedDuringWrite) {
          editedDuringWrite = true
          await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: edited } })
        }
      },
    }
    const readBaseline = async () => JSON.parse((await engine.collections.settings.findOneAsync({ _id: 'syncServerSnapshot' })).value)
    const query = async (method, options) => sync[{ syncPlaylistStart: 'start', syncPlaylistChunk: 'chunk', syncPlaylistPlan: 'plan', syncPlaylistPage: 'page', syncPlaylistApply: 'apply', syncPlaylistCancel: 'cancel' }[method]](options)
    const memberSync = await functions('src/renderer/helpers/librarySync.js', ['syncPlaylistMembers'], { DBLibraryHandlers: { query } })
    const store = { dispatch: async () => {}, persistPlaylistSyncBaseline: (id, changes) => operations.syncSnapshotSection(engine, { account, collection: 'playlists', value: { ...changes, id } }) }
    const run = async () => memberSync.syncPlaylistMembers(client, store, { localId: 'p', remoteId: 'p', remoteVideos: [...server.values()], previousVideos: (await readBaseline()).playlists.p.videos, metadata: { title: 'Before', description: 'Original' }, options: {} })
    await assert.rejects(run(), /playlist changed during sync/i)
    const baseline = await readBaseline()
    assert.deepEqual(baseline.history, { keep: true })
    assert.deepEqual(baseline.playlists.p.unknown, { keep: true })
    assert.deepEqual(baseline.playlists.p.videos, action === 'upload' ? ['kept', 'changed'] : ['kept'])
    const expected = { ...playlist, videos: action === 'upload' ? [kept] : [kept, edited] }
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), expected)
    assert.equal(engine.prepare('SELECT count(*) AS count FROM sync_jobs').get().count, 0)
    await run()
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), expected)
    assert.deepEqual([...server.keys()], action === 'upload' ? ['kept'] : ['kept', 'changed'])
    if (action === 'delete') assert.equal(server.get('changed').title, edited.title)
  })
}

for (const encrypted of [false, true]) {
  for (const changedAccount of [false, true]) {
    test(`playlist acknowledgement persistence respects account identity and encrypted uploads: ${encrypted}/${changedAccount}`, async () => {
      const settings = { syncServerUrl: 'server', syncServerToken: 'token', syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '', syncServerPrivacySalt: '' }
      const calls = []
      const context = await functions('src/renderer/store/modules/sync-server.js', ['persistPlaylistSyncBaseline'], {
        process: { env: { IS_ELECTRON: true } }, encrypted, rootState: { settings: { ...settings, ...(changedAccount ? { syncServerToken: 'other' } : {}) } }, historyAccount: Object.values(settings),
        DBLibraryHandlers: { query: async (method, options) => { calls.push([method, options]); return { updated: true, value: 'preview' } } },
        commit: (...args) => calls.push(args),
      })
      await context.persistPlaylistSyncBaseline('p', { acknowledged: { upserts: ['confirmed'], deletions: [] } })
      assert.equal(calls.length, !encrypted && !changedAccount ? 2 : 0)
    })
  }
}

for (const reason of ['disabled', 'account changed']) {
  test(`desktop history sync releases completed plans when ${reason} during preparation`, async t => {
    const database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
    t.after(() => database.close())
    const engine = new LibraryEngine(database), sync = new LibrarySync(engine)
    const retained = { _id: 'retained', playlistName: 'Retained', videos: [null], unknown: new Date(1) }
    await engine.collections.playlists.insertAsync(retained)
    let active = true
    const cancellation = new Error(reason)
    const renderer = await functions('src/renderer/helpers/sync-server.js', ['syncHistory'], {
      prepareHistorySync: async () => {
        const job = await sync.start({})
        const plan = await sync.plan(job)
        active = false
        return { ...job, ...plan }
      },
      cancelHistorySync: id => sync.cancel({ id }),
    })
    const client = { getWatchHistory: async () => [] }
    const store = {
      state: { history: { libraryPaged: true, historyRevision: 0 } },
      assertActive() { if (!active) throw cancellation },
      dispatch() { assert.fail('cancellation must not apply or refresh history') },
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      active = true
      await assert.rejects(renderer.syncHistory(client, store), error => error === cancellation)
      assert.equal(engine.prepare('SELECT count(*) AS count FROM sync_jobs').get().count, 0)
      assert.equal(engine.prepare('SELECT count(*) AS count FROM sync_values').get().count, 0)
      assert.deepEqual(await engine.playlistSnapshot({ id: retained._id }), retained)
    }
    const next = await sync.start({})
    await sync.cancel(next)
  })
}

for (const value of [undefined, null, false, 42, 'retained', { unknown: new Date(1) }]) {
  for (const baseline of [undefined, ['remote'], 'retained', null, false, 42, { unknown: true }]) {
    test(`desktop playlist sync preserves unsupported ${String(value)} memberships and ${JSON.stringify(baseline)} baseline`, async t => {
      const database = new DatabaseSync(':memory:')
      database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
      t.after(() => database.close())
      const engine = new LibraryEngine(database), sync = new LibrarySync(engine)
      const original = { _id: 'p', playlistName: 'Before', description: 'Original', unknown: new Date(2), ...(value === undefined ? {} : { videos: value }) }
      await engine.collections.playlists.insertAsync(original)
      const query = async (method, parameters) => {
        if (method === 'playlistSummaries') return engine.playlistSummaries()
        const action = { syncPlaylistStart: 'start', syncPlaylistChunk: 'chunk', syncPlaylistPlan: 'plan', syncPlaylistPage: 'page', syncPlaylistApply: 'apply', syncPlaylistCancel: 'cancel' }[method]
        assert.ok(action, method)
        return sync[action](parameters)
      }
      const memberSync = await functions('src/renderer/helpers/librarySync.js', ['syncPlaylistMembers'], { DBLibraryHandlers: { query } })
      const renderer = await functions('src/renderer/helpers/sync-server.js', ['syncPlaylists', 'mapBy', 'playlistMetadataFromLocal', 'playlistMetadataFromRemote', 'selectPlaylistMetadata', 'metadataEquals'], {
        DBLibraryHandlers: { query }, mergeIds, syncPlaylistMembers: memberSync.syncPlaylistMembers,
      })
      const remote = { id: 'p', title: 'Before', description: 'Original', thumbnail_url: null }
      const client = {
        getPlaylists: async () => [remote],
        getPlaylist: async () => ({ playlist: remote, videos: [{ id: 'remote', title: 'Retained remotely', uploader: { id: 'channel', name: 'Author' }, duration: 120 }] }),
        updatePlaylist: () => assert.fail('an unchanged remote title must not be written'),
        addPlaylistVideos: () => assert.fail('unsupported memberships must not be uploaded'),
        removePlaylistVideo: () => assert.fail('unsupported memberships must not become remote deletions'),
      }
      const previous = baseline === undefined ? {} : { p: { remoteId: 'p', videos: baseline, metadata: remote, unknown: { keep: true } } }
      const store = { state: { playlists: { libraryPaged: true } }, dispatch: () => assert.fail('a skipped playlist must not be refreshed or rewritten') }
      assert.deepEqual(structuredClone(await renderer.syncPlaylists(client, store, previous)), previous)
      assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), original)
      assert.equal(engine.prepare('SELECT count(*) AS count FROM sync_jobs').get().count, 0)
    })
  }
}

for (const loader of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  for (const rejected of [false, true]) {
    test(`${loader} keeps a saved-state error when queued metadata later ${rejected ? 'rejects' : 'resolves'}`, async () => {
      const history = Promise.withResolvers(), network = Promise.withResolvers()
      const methods = await functions('src/renderer/views/Watch/Watch.js', [loader, 'handleDownloadConnectionChange', 'finishDownloadedPlaybackAfterHistoryHydration', 'isCurrentVideoLoad'], {
        initializeNetworkRecovery: () => ({ ready: Promise.resolve() }), getConnectionState: () => 'online',
        getLocalVideoInfo: () => network.promise, invidiousGetVideoInformation: () => network.promise,
      })
      const context = {
        firstLoad: true, videoId: 'video', videoLoadGeneration: 1, historyHydratedVideoId: null,
        tabRoute: { params: { id: 'video' } }, watchingPlaylist: true, localFilePlayback: false,
        $store: { state: { history: { libraryPaged: true } }, dispatch: () => history.promise },
        isCurrentVideoLoad: methods.isCurrentVideoLoad,
        finishDownloadedPlaybackAfterHistoryHydration: methods.finishDownloadedPlaybackAfterHistoryHydration,
        finishDownloadedPlaybackWithoutMetadata() { assert.fail('failed hydration must not start downloaded playback') },
      }
      const loading = methods[loader].call(context, 1)
      await setImmediate()
      const switching = methods.handleDownloadConnectionChange.call(context, { detail: 'offline' })
      history.reject(new Error('saved history unavailable'))
      await switching
      assert.equal(context.errorMessage, 'saved history unavailable')
      if (rejected) network.reject(new Error('late metadata error'))
      else network.resolve(loader === 'getVideoInformationLocal' ? { info: {} } : {})
      await loading
      assert.equal(context.errorMessage, 'saved history unavailable')
      assert.equal(context.isLoading, false)
      assert.equal(context.historyHydratedVideoId, null)
      assert.equal(context.videoLoadGeneration, 1)
      assert.equal(context.videoTitle, undefined)
    })
  }
}

for (const action of ['markSubscriptionEntriesAsSeen', 'markSubscriptionVideoAsSeen', 'markSubscriptionPostAsSeen']) {
  for (const outcome of ['saved', 'unchanged', 'failed']) {
    test(`${action} queues history sync after a ${outcome} desktop seen write`, async () => {
      const dispatched = [], committed = []
      let saved = false
      const failure = new Error('write failed')
      const { [action]: mark } = await functions('src/renderer/store/modules/subscription-cache.js', [action], {
        DBLibraryHandlers: { query: async method => {
          assert.equal(method, 'markSubscriptionEntries')
          if (outcome === 'failed') throw failure
          saved = true
          return { settings: outcome === 'saved' ? { subscriptionSeenVideos: '[{"videoId":"video","seenAt":1}]' } : {} }
        } },
      })
      const context = {
        state: { libraryPaged: true, videoCache: {}, shortsCache: {}, liveCache: {}, postsCache: {} },
        commit: (name, value) => committed.push([name, value]),
        dispatch: async (name, reason) => { assert.equal(saved, true); dispatched.push([name, reason]) },
      }
      const request = mark(context, action === 'markSubscriptionEntriesAsSeen' ? { tabs: ['videos'] } : 'entry')
      await request
      assert.deepEqual(dispatched, outcome === 'saved' ? [['scheduleSyncServer', 'history']] : [])
      if (outcome === 'failed') assert.deepEqual(structuredClone(committed), [['markSubscriptionEntriesAsSeenInCache', []]])
    })
  }
}

for (const failure of ['none', 'apply', 'refresh', 'settings']) {
  test(`desktop unified restore schedules selected collections after commit with ${failure} failure`, async () => {
    const dispatched = [], toasts = []
    let saved = false
    const context = await functions(dataSettings, ['importUnifiedBackup'], {
      backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null, backupBusy: ref(false), selectedBackupSections: ref(['history', 'profiles', 'watchStats']), backupData: ref({ id: 'job' }),
      closeBackupImport() {}, applyImportedSettings: async () => { if (failure === 'settings') throw new Error('settings refresh failed') },
      DBLibraryHandlers: { query: async (method, args) => {
        assert.equal(method, 'importApply')
        assert.deepEqual(structuredClone(args), { id: 'job', sections: ['history', 'profiles', 'watchStats'] })
        if (failure === 'apply') throw new Error('apply failed')
        saved = true
        return { settings: {} }
      } },
      store: { dispatch: async (action, reason) => {
        assert.equal(saved, true)
        dispatched.push([action, reason])
        if (action.startsWith('grab') && failure === 'refresh') throw new Error('refresh failed')
      } },
      t: key => key, showToast: toast => toasts.push(toast),
    })
    await context.importUnifiedBackup()
    assert.deepEqual(dispatched.filter(([action]) => action === 'scheduleSyncServer'), failure === 'apply' ? [] : [
      ['scheduleSyncServer', 'profilesOrSubscriptions'], ['scheduleSyncServer', 'history'], ['scheduleSyncServer', 'watchStats'],
    ])
    assert.equal(context.backupBusy.value, false)
    assert.match(toasts.at(-1).message, failure === 'apply' ? /Import Failed/ : /Backup imported/)
  })
}

for (const [phase, hook] of ['selected', 'staging', 'picker'].flatMap(phase => ['onBeforeUnmount', 'onDeactivated'].map(hook => [phase, hook]))) {
  test(`closing Data Settings via ${hook} cancels a backup ${phase} without publishing a late selection`, async () => {
    let finishPicker, finishStage
    const picker = new Promise(resolve => { finishPicker = resolve })
    const staging = new Promise(resolve => { finishStage = resolve })
    const canceled = []
    let stageCalls = 0
    const { script, ast } = await source(dataSettings)
    const names = ['selectUnifiedBackup', 'closeBackupImport']
    if (ast.program.body.some(node => node.type === 'FunctionDeclaration' && node.id.name === 'disposeBackupImport')) names.push('disposeBackupImport')
    const context = await functions(dataSettings, names, {
      backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null, backupBusy: ref(false), backupData: ref(phase === 'selected' ? { id: 'stage' } : null),
      showBackupImport: ref(phase === 'selected'), backupFilename: ref(''), selectedBackupSections: ref([]),
      BACKUP_SECTIONS: ['history'], IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'downloads',
      pickFileWithPicker: () => picker, stageLibraryBackup: () => { stageCalls++; return staging },
      DBLibraryHandlers: { query: async (method, data) => { assert.equal(method, 'importCancel'); canceled.push(data.id) } },
      t: key => key, showToast() { assert.fail('disposed settings must not show a toast') },
    })
    const teardown = ast.program.body.find(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === hook)
    let dispose = () => {}
    context[hook] = callback => { dispose = callback }
    if (teardown) vm.runInContext(script.slice(teardown.start, teardown.end), context)
    let pending
    if (phase !== 'selected') pending = context.selectUnifiedBackup()
    if (phase === 'staging') { finishPicker({ name: 'backup.zip' }); await setImmediate() }
    dispose()
    finishPicker({ name: 'backup.zip' })
    finishStage({ id: 'stage' })
    await pending
    await setImmediate()
    assert.deepEqual(canceled, phase === 'picker' ? [] : ['stage'])
    assert.equal(context.backupData.value, null)
    assert.equal(context.showBackupImport.value, false)
    assert.equal(stageCalls, phase === 'staging' ? 1 : 0)
  })
}

for (const newerCompletesFirst of [false, true]) {
  test(`reopening Data Settings keeps the new backup selection when the abandoned stage completes ${newerCompletesFirst ? 'last' : 'first'}`, async () => {
    const finishes = []
    const canceled = []
    let selected = 0
    const { script, ast } = await source(dataSettings)
    const context = await functions(dataSettings, ['selectUnifiedBackup', 'closeBackupImport', 'disposeBackupImport'], {
      backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null, backupBusy: ref(false), backupData: ref(null),
      showBackupImport: ref(false), backupFilename: ref(''), selectedBackupSections: ref([]), backupImportSections: ref(['history']),
      BACKUP_SECTIONS: ['history'], IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'downloads',
      pickFileWithPicker: async () => ({ name: `backup-${++selected}.zip` }),
      stageLibraryBackup: () => new Promise(resolve => finishes.push(resolve)),
      DBLibraryHandlers: { query: async (method, data) => { assert.equal(method, 'importCancel'); canceled.push(data.id) } },
      t: key => key, showToast() { assert.fail('abandoned stages must not show a toast') },
    })
    let activate
    context.onActivated = callback => { activate = callback }
    const registration = ast.program.body.find(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'onActivated')
    vm.runInContext(script.slice(registration.start, registration.end), context)
    const abandoned = context.selectUnifiedBackup()
    await setImmediate()
    context.disposeBackupImport()
    activate()
    const current = context.selectUnifiedBackup()
    await setImmediate()
    if (newerCompletesFirst) {
      finishes[1]({ id: 'current' })
      await current
    }
    finishes[0]({ id: 'abandoned' })
    await abandoned
    assert.deepEqual(canceled, ['abandoned'])
    if (!newerCompletesFirst) {
      assert.equal(context.backupData.value, null)
      assert.equal(context.showBackupImport.value, false)
      assert.equal(context.backupBusy.value, true)
      finishes[1]({ id: 'current' })
      await current
    }
    assert.equal(context.backupData.value.id, 'current')
    assert.equal(context.backupFilename.value, 'backup-2.zip')
    assert.equal(context.showBackupImport.value, true)
    assert.equal(context.backupBusy.value, false)
  })
}

for (const phase of ['apply', 'settings', 'refresh', 'export', 'portable settings']) {
  for (const fails of [false, true]) {
    test(`reopened Data Settings keeps backup writes locked through a ${phase} ${fails ? 'failure' : 'completion'}`, async () => {
      let finish, entered = false, picked = 0, exported = 0
      const pending = new Promise((resolve, reject) => { finish = () => fails ? reject(new Error('delayed failure')) : resolve({ settings: {} }) })
      const toasts = []
      const context = await functions(dataSettings, ['importUnifiedBackup', 'exportUnifiedBackup', 'selectUnifiedBackup', 'closeBackupImport', 'disposeBackupImport'], {
        process: { env: { IS_ELECTRON: phase !== 'portable settings' } },
        backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
        backupBusy: ref(false), backupData: ref({ id: 'staged', settings: {} }), selectedBackupSections: ref([phase === 'portable settings' ? 'settings' : 'history']),
        showBackupImport: ref(true), transferableSettings: ref({}), selectedExportSections: ref(['settings']), showBackupExport: ref(true),
        IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'downloads', deepCopy: structuredClone, getTodayDateStrLocalTimezone: () => '2026-10-11',
        pickFileWithPicker: async () => { picked++; return null },
        writeLibraryBackup: async () => { exported++; if (phase === 'export') { entered = true; return pending } return true },
        DBLibraryHandlers: { query: async method => {
          if (method === 'importCancel') return
          assert.equal(method, 'importApply')
          if (phase === 'apply') { entered = true; return pending }
          return { settings: {} }
        } },
        applyImportedSettings: async () => { if (phase.endsWith('settings')) { entered = true; await pending } },
        compactAllDatastores: async () => true,
        store: { dispatch: async action => { if (action === 'grabHistory' && phase === 'refresh') { entered = true; await pending } } },
        t: key => key, showToast: toast => toasts.push(toast),
      })
      const original = phase === 'export' ? context.exportUnifiedBackup() : context.importUnifiedBackup()
      await setImmediate()
      assert.equal(entered, true)
      context.disposeBackupImport()
      context.backupDisposed = false
      assert.equal(context.backupBusy.value, true, 'closing Settings must not unlock a pending backup write')
      await context.selectUnifiedBackup()
      await context.exportUnifiedBackup()
      assert.equal(picked, 0)
      assert.equal(exported, phase === 'export' ? 1 : 0)
      finish()
      await original
      assert.equal(context.backupBusy.value, false)
      assert.equal(context.backupData.value, null)
      assert.deepEqual(toasts, [], 'a disposed request must not publish success or failure into reopened Settings')
      await context.selectUnifiedBackup()
      assert.equal(picked, 1, 'backup actions unlock after the write finishes')
    })
  }
}

test('portable legacy search imports keep the validated fields and can be stored by NeDB', async () => {
  const database = new Datastore({ inMemoryOnly: true })
  const toasts = []
  const context = await functions(dataSettings, ['importFreeTubeSearchHistory'], {
    process: { env: { IS_ELECTRON: false } },
    searchHistoryEntries: ref([]), deepCopy: structuredClone,
    isJsonObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    normalizeSearchHistoryEntry, mergeSearchHistoryEntries,
    store: { async dispatch(name, records) {
      assert.equal(name, 'overwriteSearchHistory')
      try { await database.insertAsync(structuredClone(records)); return true } catch { return false }
    } }, t: key => key, showToast: toast => toasts.push(toast),
  })
  await context.importFreeTubeSearchHistory([{ _id: 'legacy query', lastUpdatedAt: 123, $custom: 'cannot store', unknown: 'old portable imports ignored this', searchSettings: { time: 'today', $custom: true } }])
  const saved = await database.findAsync({})
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0], {
    _id: saved[0]._id, query: 'legacy query', lastUpdatedAt: 123,
    searchSettings: { prioritize: 'relevance', time: 'today', type: 'all', duration: '', features: [] },
  })
  assert.equal(toasts.at(-1).message, 'Settings.Data Settings.All search history has been successfully imported')
})

for (const importer of ['importFreeTubeSearchHistory', 'importYouTubeSearchHistory']) {
  test(`portable ${importer} rejects a failed overwrite without announcing success`, async () => {
    const toasts = []
    const context = await functions(dataSettings, [importer], {
      process: { env: { IS_ELECTRON: false } }, URL, DEFAULT_SEARCH_SETTINGS,
      searchHistoryEntries: ref([]), deepCopy: structuredClone,
      isJsonObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
      normalizeSearchHistoryEntry, normalizeSearchSettings, mergeSearchHistoryEntries,
      store: { dispatch: async () => false }, t: key => key, showToast: toast => toasts.push(toast),
    })
    const entries = importer === 'importFreeTubeSearchHistory'
      ? [{ _id: 'query', lastUpdatedAt: 123 }]
      : [{ products: ['YouTube'], titleUrl: 'https://www.youtube.com/results?search_query=query', time: '2026-01-01T00:00:00Z' }]
    await assert.rejects(context[importer](entries), /import search history/i)
    assert.equal(toasts.length, 0)
  })
}

test('desktop legacy search imports retain unknown fields before their lossless import', async () => {
  let imported
  const context = await functions(dataSettings, ['importFreeTubeSearchHistory'], {
    searchHistoryEntries: ref([]), deepCopy: structuredClone,
    isJsonObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    normalizeSearchHistoryEntry, mergeSearchHistoryEntries,
    importLibraryRecords: async (_collection, records) => { imported = structuredClone(records) },
    store: { dispatch: async () => true }, t: key => key, showToast() {},
  })
  const original = { _id: 'query', lastUpdatedAt: 123, unknown: { retained: new Date(1) } }
  await context.importFreeTubeSearchHistory([original])
  assert.deepEqual(imported, [normalizeSearchHistoryEntry(original)])
})

test('portable user playlist transitions leave Watch free to read the complete durable playlist', async () => {
  const commits = []
  const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['cachePlaylistForWatchTransition'], {
    process: { env: { IS_ELECTRON: false } }, isUserPlaylistRequested: ref(true),
    isLoading: ref(false), playlistId: ref('p'), playlistTitle: ref('Playlist'), videoCount: ref(350),
    channelName: ref(''), channelId: ref(''), sortedPlaylistItems: ref(Array.from({ length: 100 }, (_, index) => ({ videoId: String(index) }))),
    continuationData: ref(null), playlistCacheTabId: 'tab', store: { commit: (name, value) => commits.push({ name, value }) },
  })
  context.cachePlaylistForWatchTransition({ path: '/watch/99', query: { playlistId: 'p' } })
  assert.deepEqual(commits, [])
})

for (const desktop of [false, true]) {
  test(`${desktop ? 'desktop' : 'portable'} preload scans all user playlist members before reporting completion`, async () => {
    const videos = Array.from({ length: 350 }, (_, index) => ({ videoId: `video-${index}` }))
    let requested = []
    const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['preloadPlaylist'], {
      process: { env: { IS_ELECTRON: desktop } },
      playlistPreloadAvailable: ref(true), playlistPreloadPending: ref(false), playlistPreloadComplete: ref(false),
      playlistRequestGeneration: 1, selectedUserPlaylist: ref({ _id: 'p' }), isUserPlaylistRequested: ref(true),
      userPlaylistPreloadIds: ref(null), playlistId: ref('p'), playlistPreloadRun: null,
      moreVideoDataAvailable: ref(false), nextPageError: ref(''), ytDlpPlaybackCacheKey: ref('cache'), ytDlpPlaybackUseAuthentication: ref(false),
      store: { getters: { getYtDlpPreloadConcurrency: 2 } },
      startProgressBarOperation: () => ({ update() {}, finish() {} }), reserveYtDlpPlaybackSourceCache() {},
      DBLibraryHandlers: { async query(_method, { cursor, limit }) {
        const start = cursor ?? 0
        return { records: videos.slice(start, start + limit), cursor: start + limit < videos.length ? start + limit : null }
      } },
      preloadYtDlpPlaybackSources: async ids => { requested = structuredClone(ids); return { requested: ids.length, preloaded: ids.length, failed: 0 } },
      refreshPlaylistPreloadComplete() {}, clearPlaylistPreloadComplete() {}, showTabToast() {}, t: key => key,
    })
    Object.defineProperty(context, 'playlistPreloadVideoIds', { get: () => ref(context.userPlaylistPreloadIds.value ?? videos.slice(0, 100).map(video => video.videoId)) })
    await context.preloadPlaylist()
    assert.deepEqual(requested, videos.map(video => video.videoId))
    assert.equal(context.playlistPreloadPending.value, false)
  })
}

for (const loader of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  test(`${loader} releases the loader when offline downloaded playback initialization throws`, async () => {
    const errors = []
    const context = await functions('src/renderer/views/Watch/Watch.js', [loader], {
      initializeNetworkRecovery: () => ({ ready: Promise.resolve() }), getConnectionState: () => 'offline',
      console: { error: error => errors.push(error) },
    })
    const failure = new Error('Downloaded file unavailable')
    const state = {
      firstLoad: true, isLoading: true, videoLoadGeneration: 1, tabRoute: { params: { id: 'video' } },
      $store: { state: { history: { libraryPaged: true } }, dispatch: async () => true },
      isCurrentVideoLoad: () => true, historyHydratedVideoId: null,
      finishDownloadedPlaybackWithoutMetadata: () => { throw failure },
    }
    await context[loader].call(state, 1)
    assert.equal(state.isLoading, false)
    assert.equal(state.errorMessage, failure.message)
    assert.deepEqual(errors, [failure])
  })
}

for (const paged of [false, true]) {
  test(`${paged ? 'desktop' : 'portable'} Watch resolves membership from the correct adapter`, async () => {
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['findIndexOfCurrentVideoInPlaylist'], {
      props: { videoId: 'B', playlistItemId: 'member-B', libraryMemberId: '1' },
      isPagedPlaylist: ref(paged), prevVideoBeforeDeletion: ref(null),
    })
    const videos = ['A', 'B', 'C'].map(videoId => ({ videoId, playlistItemId: `member-${videoId}` }))
    assert.equal(context.findIndexOfCurrentVideoInPlaylist(videos), paged ? -1 : 1)
    if (!paged) {
      const index = context.findIndexOfCurrentVideoInPlaylist(videos)
      assert.equal(videos[index + 1].videoId, 'C')
      assert.equal(videos[index - 1].videoId, 'A')
    }
  })
}

for (const result of ['success', 'failure', 'stale success', 'stale failure']) {
  test(`desktop Shorts clears old-profile targets and handles ${result}`, async () => {
    const file = 'src/renderer/views/Watch/Watch.js'
    const { script, ast } = await source(file)
    const watcher = matching(ast, node => node.type === 'ObjectProperty' && node.key?.name === 'libraryShortsRequest' && node.value.type === 'ObjectExpression')[0]
    const handler = watcher.value.properties.find(node => node.key.name === 'handler')
    const pending = Promise.withResolvers()
    const toasts = []
    const query = async (_method, request) => request.profile === 'pending' ? pending.promise : [{ videoId: 'current-profile' }]
    const bindings = { DBLibraryHandlers: { query }, showToast: toast => toasts.push(toast), markRaw: value => value, AbortController }
    const context = vm.createContext({ console: { error() {} }, ...bindings })
    const run = vm.runInContext(`(function(request) ${script.slice(handler.body.start, handler.body.end)})`, context)
    const state = { libraryShortsGeneration: 0, libraryShortsFeed: [{ videoId: 'old-profile' }], libraryShortsRetryAbort: null, libraryShortsRequest: { profile: 'pending' }, $store: { getters: { getActiveProfile: { _id: 'pending' } } }, t: key => key }
    const loader = matching(ast, node => node.type === 'ObjectMethod' && node.key.name === 'refreshLibraryShortsFeed')[0]
    if (loader) state.refreshLibraryShortsFeed = vm.runInContext(`(async function(request = this.libraryShortsRequest) ${script.slice(loader.body.start, loader.body.end)})`, context).bind(state)
    const loading = run.call(state, state.libraryShortsRequest)
    assert.deepEqual(structuredClone(state.libraryShortsFeed), [], 'old targets disappear before the new read settles')
    if (result.startsWith('stale')) {
      state.libraryShortsRequest = { profile: 'current' }
      state.$store.getters.getActiveProfile._id = 'current'
      await run.call(state, state.libraryShortsRequest)
    }
    if (result.endsWith('failure')) pending.reject(new Error('profile read failed'))
    else pending.resolve([{ videoId: 'pending-profile' }])
    await loading
    assert.deepEqual(structuredClone(state.libraryShortsFeed), result.startsWith('stale') ? [{ videoId: 'current-profile' }] : result === 'failure' ? [] : [{ videoId: 'pending-profile' }])
    assert.equal(toasts.length, result === 'failure' ? 1 : 0)
    if (result === 'failure') {
      assert.equal(toasts[0].buttons[0].label, 'Storage Startup Error.Retry')
      assert.deepEqual(structuredClone(toasts[0].buttons[0].icon), ['fas', 'sync'])
      assert.equal(toasts[0].buttons[0].primary, true)
      state.libraryShortsRequest = { profile: 'current' }
      state.$store.getters.getActiveProfile._id = 'current'
      await toasts[0].buttons[0].action()
      assert.deepEqual(structuredClone(state.libraryShortsFeed), [{ videoId: 'current-profile' }])
    }
  })
}

for (const result of ['success', 'failure']) {
  test(`a same-profile Shorts revision keeps navigation through refresh ${result}`, async () => {
    const pending = Promise.withResolvers(), toasts = []
    const retained = [{ videoId: 'previous' }, { videoId: 'current' }, { videoId: 'next' }]
    let reads = 0
    const context = await functions('src/renderer/views/Watch/Watch.js', ['refreshLibraryShortsFeed'], {
      DBLibraryHandlers: { query: () => ++reads === 1 ? retained : pending.promise },
      showToast: toast => toasts.push(toast), markRaw: value => value, AbortController,
    })
    const state = {
      libraryShortsGeneration: 0, libraryShortsFeed: [], libraryShortsRetryAbort: null,
      $store: { getters: { getActiveProfile: { _id: 'profile' } } }, t: key => key,
    }
    const request = { currentVideoId: 'current', subscriptions: [{ id: 'channel' }], preferences: {}, revision: [1, 1] }
    await context.refreshLibraryShortsFeed.call(state, request)
    const loading = context.refreshLibraryShortsFeed.call(state, { ...request, revision: [1, 2] })
    assert.deepEqual(structuredClone(state.libraryShortsFeed), retained, 'progress refresh must keep both neighbors available')
    if (result === 'failure') pending.reject(new Error('refresh failed'))
    else pending.resolve([{ videoId: 'current' }, { videoId: 'updated-next' }])
    await loading
    assert.deepEqual(structuredClone(state.libraryShortsFeed), result === 'failure' ? retained : [{ videoId: 'current' }, { videoId: 'updated-next' }])
    assert.equal(toasts.length, result === 'failure' ? 1 : 0)
  })
}

for (const result of ['rejection', 'deleted']) {
  test(`playlist download snapshot ${result} explains the failure and permits retry`, async () => {
    let fail = true, downloads = 0
    const toasts = []
    const context = await functions('src/renderer/components/WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue', ['startDownload'], {
      props: { userPlaylistId: 'p', isPlaylist: true, videoIds: [] }, options: {}, isDirty: ref(false), selectedTemplate: ref(''), downloadId: ref(null), normalizeOptions: value => value,
      DBLibraryHandlers: { query: async () => { if (fail) throw new Error(result === 'deleted' ? 'The playlist no longer exists' : 'read failed'); return ['A', 'B'] } },
      ytDlp: { ytDlpDownload: async request => { downloads++; assert.deepEqual(structuredClone(request.videoIds), ['A', 'B']); return { id: 'job' } } },
      t: key => key, showToast: toast => toasts.push(toast),
    })
    await context.startDownload()
    assert.equal(downloads, 0)
    assert.equal(context.downloadId.value, null)
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].message, 'Downloads.Download Failed')
    fail = false
    await context.startDownload()
    assert.equal(downloads, 1)
    assert.equal(context.downloadId.value, 'job')
  })
}

for (const change of ['playlistName', 'description', 'members']) {
  test(`desktop sync preserves a ${change} edit while the remote header read waits`, async t => {
    const database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
    t.after(() => database.close())
    const engine = new LibraryEngine(database)
    const sync = new LibrarySync(engine)
    const video = index => ({ videoId: String(index).padStart(11, '0'), playlistItemId: `member-${index}`, title: `Video ${index}`, author: 'Author', authorId: 'channel', lengthSeconds: 120, type: 'video' })
    const original = { _id: 'p', playlistName: 'Before', description: 'Original', protected: true, videos: [video(1)], unknown: new Date(1) }
    await engine.collections.playlists.insertAsync(original)
    const ids = engine.playlistPage({ id: 'p' }).records.map(item => item._libraryMemberId)
    const query = async (method, parameters) => {
      if (method === 'playlistSummaries') return engine.playlistSummaries()
      const action = { syncPlaylistStart: 'start', syncPlaylistChunk: 'chunk', syncPlaylistPlan: 'plan', syncPlaylistPage: 'page', syncPlaylistApply: 'apply', syncPlaylistCancel: 'cancel' }[method]
      assert.ok(action, method)
      return sync[action](parameters)
    }
    const memberSync = await functions('src/renderer/helpers/librarySync.js', ['syncPlaylistMembers'], { DBLibraryHandlers: { query } })
    const renderer = await functions('src/renderer/helpers/sync-server.js', ['syncPlaylists', 'mapBy', 'playlistMetadataFromLocal', 'playlistMetadataFromRemote', 'selectPlaylistMetadata', 'metadataEquals'], {
      DBLibraryHandlers: { query }, mergeIds, syncPlaylistMembers: memberSync.syncPlaylistMembers,
    })
    const uploads = []
    const remote = { id: 'p', title: 'Before', description: 'Original', thumbnail_url: null }
    const client = {
      getPlaylists: async () => {
        await engine.collections.playlists.updateAsync({ _id: 'p' }, change === 'members' ? { $push: { videos: video(2) } } : { $set: { [change]: 'Edited in another window' } })
        return [remote]
      },
      getPlaylist: async () => ({ playlist: remote, videos: [videoToRemote(video(1))] }),
      updatePlaylist: () => assert.fail('Unchanged remote metadata should not be written'),
      addPlaylistVideos: async (_id, records) => uploads.push(...records),
      removePlaylistVideo: () => assert.fail('Concurrent additions must not become deletions'),
    }
    const store = { state: { playlists: { libraryPaged: true } }, dispatch: async () => {} }
    const running = renderer.syncPlaylists(client, store, { p: { remoteId: 'p', videos: [video(1).videoId], metadata: { id: 'p', title: 'Before', description: 'Original', thumbnail_url: null } } })
    if (change === 'members') {
      const snapshot = await running
      assert.deepEqual(Array.from(snapshot.p.videos), [video(1).videoId, video(2).videoId])
      assert.deepEqual(uploads, [videoToRemote(video(2))])
    } else {
      await assert.rejects(running, /playlist changed during sync/i)
      assert.deepEqual(uploads, [])
    }
    const expected = change === 'members' ? { ...original, videos: [...original.videos, video(2)] } : { ...original, [change]: 'Edited in another window' }
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), expected)
    assert.deepEqual(engine.playlistPage({ id: 'p' }).records.slice(0, ids.length).map(item => item._libraryMemberId), ids)
    assert.equal(engine.prepare('SELECT count(*) AS count FROM sync_jobs').get().count, 0)
  })
}

test('combined New badges follow each completed category when the primary page fails or is stale', async () => {
  const { script, ast } = await source('src/renderer/components/SubscriptionsNew.vue')
  const declaration = matching(ast, node => node.type === 'VariableDeclarator' && node.id?.name === 'hasNewContentByCategory')[0]
  const categories = ['videos', 'shorts', 'live', 'posts']
  const feeds = Object.fromEntries(categories.map(category => [category, { records: vueRef([]), total: vueRef(0), categoryCounts: vueRef({}) }]))
  const props = reactive({ activeCategory: null })
  feeds.shorts.records.value = [{ videoId: 'short' }]
  feeds.shorts.total.value = 1
  feeds.shorts.categoryCounts.value = { videos: 0, shorts: 1, live: 0, posts: 0 }
  const badges = vm.runInNewContext(script.slice(declaration.init.start, declaration.init.end), { computed, isElectron: true, props, pagedFeeds: feeds })
  const snapshot = () => structuredClone(badges.value)
  assert.deepEqual(snapshot(), { videos: false, shorts: true, live: false, posts: false })
  feeds.videos.categoryCounts.value = { videos: 0, shorts: 0, live: 0, posts: 0 }
  feeds.shorts.categoryCounts.value = {}
  assert.equal(snapshot().shorts, true)
  feeds.videos.categoryCounts.value = { videos: 0, shorts: 1, live: 0, posts: 0 }
  feeds.shorts.records.value = []
  feeds.shorts.total.value = 0
  feeds.shorts.categoryCounts.value = { videos: 0, shorts: 0, live: 0, posts: 0 }
  assert.equal(snapshot().shorts, false)
  props.activeCategory = 'shorts'
  feeds.videos.categoryCounts.value = { videos: 1 }
  feeds.videos.records.value = [{ videoId: 'stale-inactive-video' }]
  assert.equal(snapshot().videos, false)
})

for (const result of ['guard failure', 'logical-tab guard', 'rejection']) {
  for (const superseded of [false, true]) {
    test(`paged navigation ${result} ${superseded ? 'cannot restore a newer window' : 'restores skip readiness'}`, async () => {
      const pending = Promise.withResolvers()
      const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['playUserPlaylistItem'], {
        props: { videoId: 'current', playlistId: 'p', playlistType: 'user', libraryMemberId: 'current-member' },
        userWindowReady: ref(true), userWindowOwner: ref('current'), userWindowKey: () => 'current', userWindowGeneration: 1,
        userShuffleSeed: ref('old-seed'), userShuffleAnchor: null,
        router: { currentRoute: ref({ fullPath: '/current' }), push: () => pending.promise },
      })
      const navigation = context.playUserPlaylistItem({ videoId: 'next', _libraryMemberId: 'next-member' })
      assert.equal(context.userWindowReady.value, false)
      if (superseded) context.userWindowGeneration++
      if (result === 'rejection') pending.reject(new Error('blocked navigation'))
      else pending.resolve(result === 'logical-tab guard' ? undefined : { type: 4 })
      await navigation
      assert.equal(context.userWindowReady.value, !superseded)
    })
  }
}

test('a blocked shuffled wrap restores its previous order and current window', async () => {
  const pending = Promise.withResolvers()
  const anchor = { memberId: 'original' }
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['playUserPlaylistItem'], {
    props: { videoId: 'current', playlistId: 'p', playlistType: 'user', libraryMemberId: 'current-member' },
    userWindowReady: ref(true), userWindowOwner: ref('old-seed'), userWindowGeneration: 1,
    userShuffleSeed: ref('old-seed'), userShuffleAnchor: anchor, crypto: { randomUUID: () => 'new-seed' },
    router: { currentRoute: ref({ fullPath: '/current' }), push: () => pending.promise },
  })
  context.userWindowKey = () => context.userShuffleSeed.value
  const navigation = context.playUserPlaylistItem({ videoId: 'next', _libraryMemberId: 'next-member' }, true)
  assert.equal(context.userShuffleSeed.value, 'new-seed')
  pending.resolve({ type: 4 })
  assert.equal(await navigation, false)
  assert.equal(context.userWindowReady.value, true)
  assert.equal(context.userShuffleSeed.value, 'old-seed')
  assert.equal(context.userShuffleAnchor, anchor)
})

for (const enabled of [false, true]) {
  test(`paged Watch toggling Shuffle from ${enabled} loads one window`, async () => {
    let loads = 0
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['toggleShuffle', 'shufflePlaylistItems', 'parseUserPlaylist'], {
      shuffleEnabled: ref(enabled), isPagedPlaylist: ref(true), selectedUserPlaylist: ref({ playlistName: 'Playlist', videoCount: 3 }),
      playlistTitle: ref(''), playlistTotalVideoCount: ref(0), channelName: ref(''), channelId: ref(''),
      userShuffleSeed: ref(null), userShuffleAnchor: null, userAnchor: () => ({ memberId: 'current' }),
      crypto: { randomUUID: () => 'new-seed' }, loadUserPlaylistWindow: async () => { loads++ },
      showToast() {}, t: key => key,
    })
    context.toggleShuffle()
    assert.equal(context.shuffleEnabled.value, !enabled)
    assert.equal(loads, 1)
    if (!enabled) assert.equal(context.userShuffleSeed.value, 'new-seed')
  })
}

test('history query failure retains displayed records, offers retry, and ignores a superseded failure', async () => {
  const pending = Promise.withResolvers()
  const original = [{ _id: 'retained', videoId: 'retained', unknown: new Date(1) }]
  let fail = true, defer = false, clamps = 0
  const context = await functions('src/renderer/views/History/History.vue', ['filterHistory'], {
    filterHistoryAsync: { cancel() {} }, searchGeneration: 0, pageCursor: null,
    isSearching: ref(false), showSearchFeedback: ref(false), historyReadFailed: ref(false), historyPageReadFailed: ref(false),
    query: ref(''), searchDataLimit: ref(100), dataLimit: ref(100), sortBy: ref('newest'),
    HISTORY_SORT_BY_VALUES: { DateAddedOldest: 'oldest' }, doCaseSensitiveSearch: ref(false), locale: ref('en-US'),
    activeData: ref(original), showLoadMoreButton: ref(false), clampHistoryScroll() { clamps++ }, store: { dispatch() {} },
    DBLibraryHandlers: { query: async () => {
      if (defer) { defer = false; return pending.promise }
      if (fail) throw new Error('history query failed')
      return { records: original, cursor: null }
    } },
  })
  await context.filterHistory()
  assert.equal(context.historyReadFailed.value, true)
  assert.equal(clamps, 1, 'the shorter error panel must clamp the document scroll range')
  assert.equal(context.activeData.value, original)
  assert.equal(context.isSearching.value, false)
  fail = false
  await context.filterHistory()
  assert.equal(context.historyReadFailed.value, false)
  assert.deepEqual(structuredClone(context.activeData.value), original)
  defer = true
  const old = context.filterHistory()
  await context.filterHistory()
  const beforeStale = clamps
  pending.reject(new Error('superseded history query failure'))
  await old
  assert.equal(clamps, beforeStale)
  assert.equal(context.historyReadFailed.value, false)
  assert.deepEqual(structuredClone(context.activeData.value), original)
})

test('Home new-content paging follows every category cursor and retains the current shelf on failure', async () => {
  let fail = true
  const calls = []
  const pages = Object.fromEntries(['videos', 'shorts', 'posts'].map(category => [category, {
    cursor: ref(category === 'posts' ? null : { position: 100 }), busy: ref(false), failed: ref(false),
    more: async () => { calls.push(category); if (category === 'videos' && fail) throw new Error('page failed') },
  }]))
  const context = await functions('src/renderer/views/Home/Home.vue', ['loadMoreNewSubscriptionEntries'], { pagedNewContent: pages })
  assert.equal(await context.loadMoreNewSubscriptionEntries(), false)
  assert.deepEqual(calls, ['videos', 'shorts'])
  fail = false
  assert.equal(await context.loadMoreNewSubscriptionEntries(), true)
  pages.videos.busy.value = true
  const count = calls.length
  assert.equal(await context.loadMoreNewSubscriptionEntries(), false)
  assert.equal(calls.length, count)
})

test('Home publishes only globally ordered complete prefixes, including timestamp ties', async () => {
  const videos = Array.from({ length: 230 }, (_, index) => ({ videoId: `v${index}`, published: 1000 - index }))
  const shorts = Array.from({ length: 123 }, (_, index) => ({ videoId: `s${index}`, published: 600 - index }))
  const posts = [{ postId: 'old', published: 1 }]
  const context = await functions('src/renderer/views/Home/Home.vue', ['newSubscriptionPrefix'], { newSubscriptionEntryTimestamp: entry => entry.published })
  const pages = Object.fromEntries(Object.entries({ videos, shorts, posts }).map(([category, entries]) => [category, { records: ref(entries.slice(0, 100)), cursor: ref(entries.length > 100 ? {} : null), busy: ref(false), failed: ref(false) }]))
  const prefix = () => Array.from(context.newSubscriptionPrefix(Object.fromEntries(Object.entries(pages).map(([category, page]) => [category, page.records.value])), pages), item => item.entry)
  const first = prefix()
  assert.deepEqual(first, videos.slice(0, 100))
  pages.videos.records.value = videos.slice(0, 200)
  assert.deepEqual(prefix(), videos.slice(0, 200))
  pages.videos.records.value = videos
  pages.videos.cursor.value = null
  assert.deepEqual(prefix(), [...videos, ...shorts.slice(0, 100)])
  pages.shorts.records.value = shorts
  pages.shorts.cursor.value = null
  assert.deepEqual(prefix(), [...videos, ...shorts, ...posts])
  const ties = { videos: { ...pages.videos, records: ref([{ videoId: 'first', published: 1 }]), cursor: ref({}) }, posts: { ...pages.posts, records: ref(posts) } }
  assert.deepEqual(Array.from(context.newSubscriptionPrefix({ videos: ties.videos.records.value, posts }, ties), item => item.entry.videoId), ['first'])
})

test('history load-more failure offers retry of the same cursor, preserves loaded records and ignores old errors', async () => {
  const pending = Promise.withResolvers()
  const retained = [{ _id: 'retained' }], added = { _id: 'added' }
  let fail = true, defer = false
  const cursors = []
  const context = await functions('src/renderer/views/History/History.vue', ['increaseLimit'], {
    pageCursor: 'next', searchGeneration: 0, isSearching: ref(false), showSearchFeedback: ref(false), historyPageReadFailed: ref(false),
    query: ref(''), sortBy: ref('newest'), HISTORY_SORT_BY_VALUES: {}, doCaseSensitiveSearch: ref(false), locale: ref('en-US'),
    activeData: ref(retained), showLoadMoreButton: ref(true), dataLimit: ref(100), sessionStorage: { setItem() {} }, dataLimitStorageKey: 'history', store: { dispatch() {} },
    DBLibraryHandlers: { query: async (_, options) => {
      cursors.push(options.cursor)
      if (defer) return pending.promise
      if (fail) throw new Error('next page unavailable')
      return { records: [added], cursor: 'after' }
    } },
  })
  await context.increaseLimit()
  assert.equal(context.historyPageReadFailed.value, true)
  assert.equal(context.activeData.value, retained)
  fail = false
  await context.increaseLimit()
  assert.equal(context.historyPageReadFailed.value, false)
  assert.deepEqual(cursors, ['next', 'next'])
  assert.deepEqual(structuredClone(context.activeData.value), [...retained, added])
  defer = true
  const old = context.increaseLimit()
  context.searchGeneration++
  pending.reject(new Error('superseded failure'))
  await old
  assert.equal(context.historyPageReadFailed.value, false)
})

for (const field of ['title', 'thumbnail', 'description']) {
  test(`metadata ${field} bounds stale retries and recovers without publishing a partial page`, async () => {
    const retained = [{ _id: 'retained', value: 'saved' }]
    const state = { records: ref(retained), cursor: ref('older'), busy: ref(false), failed: ref(false) }
    let calls = 0
    let stale = true
    const cursors = []
    const context = await functions('src/renderer/components/WatchVideoMetadataHistory/WatchVideoMetadataHistory.vue', ['load'], {
      generation: 0, isPaged: ref(true), props: { history: { videoId: 'video' } }, fields: { [field]: state },
      DBLibraryHandlers: { query: async (_, options) => {
        cursors.push(options.cursor)
        if (++calls > 6) throw new Error('stop an unbounded stale loop')
        if (stale) return { stale: true }
        return options.cursor ? { stale: true } : { records: [{ _id: 'current', value: 'new saved' }], cursor: null }
      } },
    })
    await context.load(field, true)
    assert.equal(calls, 3)
    assert.equal(state.failed.value, true)
    assert.equal(state.busy.value, false)
    assert.equal(state.records.value, retained)
    assert.equal(state.cursor.value, 'older')
    calls = 0
    stale = false
    cursors.length = 0
    await context.load(field, true)
    assert.deepEqual(cursors, ['older', null])
    assert.deepEqual(Array.from(state.records.value), [{ _id: 'current', value: 'new saved' }])
    assert.equal(state.cursor.value, null)
    assert.equal(state.failed.value, false)
    assert.equal(state.busy.value, false)
  })
  test(`metadata ${field} retries failed initial and later reads without dropping saved versions`, async () => {
    let fail = true
    const old = { _id: 'old', value: 'saved' }, added = { _id: 'older', value: 'older saved' }
    const state = { records: ref([]), cursor: ref(null), busy: ref(false), failed: ref(false) }
    const context = await functions('src/renderer/components/WatchVideoMetadataHistory/WatchVideoMetadataHistory.vue', ['load'], {
      generation: 0, isPaged: ref(true), props: { history: { videoId: 'video' } }, fields: { [field]: state },
      DBLibraryHandlers: { query: async (_, options) => {
        if (fail) throw new Error('metadata unavailable')
        return { records: [options.cursor ? added : old], cursor: options.cursor ? null : 'next' }
      } },
    })
    await context.load(field)
    assert.equal(state.failed.value, true)
    assert.equal(state.busy.value, false)
    fail = false
    await context.load(field)
    assert.equal(state.failed.value, false)
    assert.deepEqual(Array.from(state.records.value), [old])
    fail = true
    await context.load(field, true)
    assert.equal(state.failed.value, true)
    assert.equal(state.cursor.value, 'next')
    assert.deepEqual(Array.from(state.records.value), [old])
    fail = false
    await context.load(field, true)
    assert.equal(state.failed.value, false)
    assert.deepEqual(Array.from(state.records.value), [old, added])
  })
}

test('watch playlist skip targets remain disabled until the current member window succeeds', async () => {
  const pending = Promise.withResolvers()
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow', 'playUserPlaylistItem'], {
    userWindowGeneration: 0, userWindowReady: ref(true), userWindowOwner: ref('old'), userWindowKey: () => 'current', isLoading: ref(false),
    userShuffleSeed: ref('seed'), userShuffleAnchor: null,
    prevVideoBeforeDeletion: ref(null), userWindow: ref({ index: 1, next: { videoId: 'old' } }), playlistItems: ref([]), userPlaylistWindowOptions: () => ({}),
    DBLibraryHandlers: { query: () => pending.promise }, props: { playlistId: 'p', playlistType: 'user' }, router: { currentRoute: ref({ fullPath: '/current' }), push() { this.currentRoute.value = { fullPath: '/next' } } },
  })
  const loading = context.loadUserPlaylistWindow()
  assert.equal(context.userWindowReady.value, false)
  pending.resolve({ index: 2, records: [], next: { videoId: 'next' } })
  await loading
  assert.equal(context.userWindowReady.value, true)
  assert.equal(context.userWindowOwner.value, 'current')
  context.playUserPlaylistItem({ videoId: 'next' })
  assert.equal(context.userWindowReady.value, false)
})

test('Previous after deletion selects the retained predecessor rather than stepping back again', async () => {
  const played = []
  const previous = { videoId: 'A', _libraryMemberId: 'a' }
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['playPreviousVideo'], {
    isPagedPlaylist: ref(true), canPlayPreviousVideo: ref(true), prevVideoBeforeDeletion: ref(previous), shuffleEnabled: ref(false),
    userWindow: ref({ previous: { videoId: 'C' } }), playUserPlaylistItem: item => played.push(item),
  })
  context.playPreviousVideo()
  assert.deepEqual(played, [previous])
})

for (const [action, importer] of [['importWatchHistory', 'importFreeTubeWatchHistory'], ['importSearchHistory', 'importFreeTubeSearchHistory']]) {
  test(`${action} waits for its legacy importer instead of detaching its promise`, async () => {
    const pending = Promise.withResolvers()
    const context = await functions(dataSettings, [action], {
      readFileWithPicker: async () => ({ filename: 'older.db', content: '[]' }),
      parseImportedLineDelimitedJson: JSON.parse, IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'downloads',
      [importer]: () => pending.promise, t: key => key,
    })
    let completed = false
    const importing = context[action]().then(() => { completed = true })
    await setImmediate()
    const completedBeforeImporter = completed
    pending.resolve()
    await importing
    assert.equal(completedBeforeImporter, false)
  })
}

test('older history file imports preserve distinct duplicate occurrences and unknown fields', async () => {
  const original = { videoId: 'same', author: 'Author', authorId: 'channel', isLive: false, lengthSeconds: 100,
    published: 1, timeWatched: 2, title: 'First', type: 'video', watchProgress: 5, description: '', unknown: { keep: true } }
  const records = [{ ...original, _id: 'first' }, { ...original, _id: 'second', title: 'Second', timeWatched: 3 }]
  let imported
  const { importFreeTubeWatchHistory } = await functions(dataSettings, ['importFreeTubeWatchHistory'], {
    isJsonObject: value => value !== null && typeof value === 'object',
    importLibraryRecords: async (section, incoming) => { assert.equal(section, 'history'); imported = incoming },
    showToast() {}, t: key => key,
  })
  await importFreeTubeWatchHistory(records)
  assert.deepEqual(structuredClone(imported), records)
})

test('main datastore proxies are not thenables and ignore symbol introspection', async () => {
  const calls = []
  const { handler } = await functions('src/datastores/handlers/main.js', ['handler'], {
    libraryRequest: async (...args) => { calls.push(args); return 'authorized read' },
  })
  const history = handler('history')
  assert.equal(history.then, undefined)
  assert.equal(history[Symbol.toStringTag], undefined)
  assert.equal(await Promise.resolve(history), history)
  assert.equal(calls.length, 0)
  assert.equal(await history.find(), 'authorized read')
  assert.deepEqual(structuredClone(calls[0]), ['handler:history', 'find', []])
})

for (const action of ['grabHistory', 'markAllHistoryAsWatched']) {
  test(`desktop ${action} retains the released datastore failure contract`, async () => {
    const failure = new Error('worker unavailable')
    const errors = []
    const context = await functions('src/renderer/store/modules/history.js', [action], {
      DBLibraryHandlers: { query: async () => { throw failure } },
      getRetentionCutoff: () => null,
      console: { error: error => errors.push(error) },
    })
    const result = await context[action]({
      rootGetters: { getHistoryRetentionDays: 0 },
      commit() { assert.fail('failed reads must not replace the current history') },
      dispatch() { assert.fail('a failed mark must not report success') },
    })
    assert.equal(result, action === 'markAllHistoryAsWatched' ? 0 : undefined)
    assert.deepEqual(errors, [failure])
  })
}

for (const loader of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  test(`${loader} ignores a hydration failure after its route was superseded`, async () => {
    let initialized = 0
    const failure = new Error('library hydration unavailable')
    const errors = []
    const functions_ = await functions('src/renderer/views/Watch/Watch.js', [loader], {
      initializeNetworkRecovery: () => { initialized++; return { ready: Promise.resolve() } },
      console: { error: (...args) => errors.push(args) },
    })
    const context = {
      firstLoad: true, isLoading: false, tabRoute: { params: { id: 'video' } },
      $store: { state: { history: { libraryPaged: true } }, dispatch: async () => { throw failure } },
      // Simulate a route that changed during hydration. Its loader must reach
      // the normal generation check instead of rejecting before networking.
      isCurrentVideoLoad: () => false,
    }
    await functions_[loader].call(context, 1)
    assert.equal(initialized, 1)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].at(-1), failure)
  })
  for (const offline of [false, true]) {
    test(`${loader} stops ${offline ? 'downloaded playback' : 'metadata publication'} after current history hydration fails`, async () => {
      const failure = new Error('library hydration unavailable')
      const methods = await functions('src/renderer/views/Watch/Watch.js', [loader, 'addToHistory'], {
        initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
        getConnectionState: () => offline ? 'offline' : 'online',
        getLocalVideoInfo: async () => ({ info: { playability_status: { status: 'LOGIN_REQUIRED', error_screen: { reason: { text: 'Private video' } } } } }),
        invidiousGetVideoInformation: async () => ({ error: 'Private video' }),
      })
      let finished = 0
      const context = {
        firstLoad: true, videoId: 'video', tabRoute: { params: { id: 'video' } },
        $store: { state: { history: { libraryPaged: true } }, dispatch: async () => { throw failure } },
        isCurrentVideoLoad: () => true,
        finishDownloadedPlaybackWithoutMetadata() { finished++; return true },
        updateHistory() { assert.fail('failed hydration must not replace durable history') },
        getUnavailableVideoThumbnail: () => 'unavailable.png',
        setNonRetryablePlaybackError() {}, setRestrictedPlaybackError() {}, getRestrictedPlaybackErrorType: () => 'private',
        updateTitle() {}, runIpBlockRecoveryScriptAndReload: async () => false,
      }
      await methods[loader].call(context, 1)
      assert.equal(finished, 0)
      assert.equal(context.isLoading, false)
      assert.equal(context.playabilityStatus, undefined)
      assert.equal(context.errorMessage, failure.message)
      methods.addToHistory.call(context, 0, false)
    })
  }
}

for (const loader of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  for (const outcome of ['success', 'failure', 'route change', 'reconnect']) {
    test(`${loader} gates an offline downloaded transition on saved state: ${outcome}`, async () => {
      const history = Promise.withResolvers()
      const network = Promise.withResolvers()
      let finished = 0, reads = 0
      const writes = []
      const methods = await functions('src/renderer/views/Watch/Watch.js', [loader, 'handleDownloadConnectionChange', 'finishDownloadedPlaybackAfterHistoryHydration', 'isCurrentVideoLoad', '_saveWatchProgress'], {
        initializeNetworkRecovery: () => ({ ready: Promise.resolve() }), getConnectionState: () => 'online',
        getLocalVideoInfo: () => network.promise, invidiousGetVideoInformation: () => network.promise,
      })
      const context = {
        firstLoad: true, videoId: 'video', videoLoadGeneration: 1, historyHydratedVideoId: null,
        tabRoute: { params: { id: 'video' } }, watchingPlaylist: true, localFilePlayback: false,
        $store: { state: { history: { libraryPaged: true } }, dispatch: () => { reads++; return history.promise } },
        isCurrentVideoLoad: methods.isCurrentVideoLoad,
        finishDownloadedPlaybackAfterHistoryHydration: methods.finishDownloadedPlaybackAfterHistoryHydration,
        finishDownloadedPlaybackWithoutMetadata() { finished++; this.localFilePlayback = true; this.isLoading = false; return true },
        canSaveWatchProgress: true, historyEntryExists: true, hasBeenPresented: true,
        isCurrentlyPresented: () => true, $refs: { player: { hasPlaybackPosition: true, getCurrentTime: () => 123 } },
        updateWatchProgress: record => writes.push(record),
      }
      const loading = methods[loader].call(context, 1)
      await setImmediate()
      const switching = methods.handleDownloadConnectionChange.call(context, { detail: 'offline' })
      const finishedBeforeHydration = finished
      if (outcome === 'route change') { context.tabRoute.params.id = 'new-video'; context.videoLoadGeneration++ }
      if (outcome === 'reconnect') context.isOffline = false
      if (outcome === 'failure') history.reject(new Error('saved history unavailable'))
      else history.resolve()
      await switching
      network.resolve(loader === 'getVideoInformationLocal' ? { info: {} } : {})
      // Ignore networking after this test's connection/route transition.
      context.videoLoadGeneration++
      await loading
      assert.equal(finishedBeforeHydration, 0, 'downloaded playback must wait for the pending saved-state read')
      assert.equal(reads, 1, 'the offline transition reuses the existing hydration request')
      assert.equal(finished, outcome === 'success' ? 1 : 0)
      methods._saveWatchProgress.call(context)
      assert.equal(writes.length, outcome === 'success' || outcome === 'reconnect' ? 1 : 0)
      if (outcome === 'failure') { assert.equal(context.errorMessage, 'saved history unavailable'); assert.equal(context.isLoading, false) }
    })
  }
}

test('watch progress writes wait for successful hydration of the current video and resume afterward', async () => {
  const writes = []
  const methods = await functions('src/renderer/views/Watch/Watch.js', ['_saveWatchProgress'])
  const context = {
    videoId: 'video', canSaveWatchProgress: true, historyEntryExists: true,
    $store: { state: { history: { libraryPaged: true } } }, historyHydratedVideoId: null,
    isCurrentlyPresented: () => true, hasBeenPresented: true,
    $refs: { player: { hasPlaybackPosition: true, getCurrentTime: () => 123 } },
    updateWatchProgress: record => writes.push(record),
  }
  methods._saveWatchProgress.call(context)
  context.historyHydratedVideoId = 'previous-video'
  methods._saveWatchProgress.call(context)
  assert.deepEqual(writes, [])
  context.historyHydratedVideoId = 'video'
  methods._saveWatchProgress.call(context)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].videoId, 'video')
  assert.equal(writes[0].watchProgress, 123)
})

test('failed batch playlist adds show an error, refresh summaries and skip success', async () => {
  const toasts = [], dispatches = []
  let hidden = false
  const { addSelectedToPlaylists } = await functions('src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', ['addSelectedToPlaylists'], {
    selectedPlaylistIdList: ref(['retained', 'deleted']), allPlaylists: ref([]),
    toBeAddedToPlaylistVideoList: ref([{ videoId: 'video' }]), addingDuplicateVideosEnabled: ref(false),
    addInProgress: false,
    DBLibraryHandlers: { query: async () => { throw new Error('The playlist no longer exists') } },
    store: { dispatch: async action => dispatches.push(action) }, t: key => key,
    showToast: toast => toasts.push(toast), hide: () => { hidden = true },
  })
  await addSelectedToPlaylists()
  assert.deepEqual(dispatches, ['grabAllPlaylists'])
  assert.equal(hidden, false)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /There was an issue with updating this playlist/)
})

test('playlist Save ignores repeated clicks through the write and refresh, then permits retry', async () => {
  const write = Promise.withResolvers(), refresh = Promise.withResolvers()
  let writes = 0
  const context = await functions('src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', ['addSelectedToPlaylists'], {
    addInProgress: false, selectedPlaylistIdList: ref(['playlist']), allPlaylists: ref([]),
    toBeAddedToPlaylistVideoList: ref([{ videoId: 'video' }]), addingDuplicateVideosEnabled: ref(true),
    DBLibraryHandlers: { query: () => { writes++; return write.promise } },
    store: { dispatch: () => refresh.promise }, t: key => key, showToast() {}, hide() {},
    getVideoThumbnailUrl: () => null, backendPreference: ref('local'), currentInvidiousInstanceUrl: ref(''), thumbnailPreference: ref(''),
  })
  const saving = context.addSelectedToPlaylists()
  const repeated = context.addSelectedToPlaylists()
  const writesDuringSave = writes
  write.reject(new Error('write failed'))
  await setImmediate()
  const repeatedDuringRefresh = context.addSelectedToPlaylists()
  const writesDuringRefresh = writes
  refresh.resolve()
  await Promise.all([saving, repeated, repeatedDuringRefresh])
  assert.equal(writesDuringSave, 1)
  assert.equal(writesDuringRefresh, 1)
  assert.equal(context.addInProgress, false)
  await context.addSelectedToPlaylists()
  assert.equal(writes, 2)
})

for (const outcome of ['saved', 'rejected write', 'no change', 'rejected refresh']) {
  test(`desktop playlist adds schedule automatic playlist sync only after the write: ${outcome}`, async () => {
    const write = Promise.withResolvers()
    const scheduled = []
    const context = await functions('src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', ['addSelectedToPlaylists'], {
      addInProgress: false, selectedPlaylistIdList: ref(['playlist']), allPlaylists: ref([]),
      toBeAddedToPlaylistVideoList: ref([{ videoId: 'video' }]), addingDuplicateVideosEnabled: ref(true),
      DBLibraryHandlers: { query: () => write.promise },
      store: { dispatch: async (action, reason) => {
        if (action === 'scheduleSyncServer') scheduled.push(reason)
        else if (outcome === 'rejected refresh') throw new Error('summary unavailable')
      } },
      t: key => key, showToast() {}, hide() {}, getVideoThumbnailUrl: () => null,
      backendPreference: ref('local'), currentInvidiousInstanceUrl: ref(''), thumbnailPreference: ref(''),
    })
    const saving = context.addSelectedToPlaylists()
    assert.deepEqual(scheduled, [])
    if (outcome === 'rejected write') write.reject(new Error('transaction rolled back'))
    else write.resolve({ changedIds: outcome === 'no change' ? [] : ['playlist'] })
    await saving
    assert.deepEqual(scheduled, ['saved', 'rejected refresh'].includes(outcome) ? ['playlists'] : [])
    assert.equal(context.addInProgress, false)
  })
}

for (const stage of ['write', 'refresh', 'success']) {
  test(`desktop history overwrite returns its released boolean result after ${stage}`, async () => {
    const failure = new Error('worker unavailable')
    const context = await functions('src/renderer/store/modules/history.js', ['overwriteHistory'], {
      DBHistoryHandlers: { overwrite: async () => { if (stage === 'write') throw failure } },
      migrateLegacyHistoryRecord: record => record,
    })
    const result = await context.overwriteHistory({ dispatch: async () => { if (stage === 'refresh') throw failure } }, [{ videoId: 'retained' }])
    assert.equal(result, stage === 'success')
  })
}

test('user playlist reload ignores superseded failures and recovers from a current failure', async () => {
  const pending = Promise.withResolvers()
  let reads = 0, fail = false
  const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['parseUserPlaylist'], {
    userStatisticsGeneration: 0, userPageGeneration: 0, userPageRevision: 0, playlistId: ref('playlist'),
    processedVideoSearchQuery: ref(''), userPlaylistPreloadIds: ref(null),
    userPageOptions: () => ({}), userPageCursor: ref(null), userStatistics: ref({}),
    playlistTitle: ref(''), playlistDescription: ref(''), firstVideoId: ref(''), firstVideoPlaylistItemId: ref(''),
    lastUpdatedDate: ref(null), viewCount: ref(0), channelName: ref(''), channelThumbnail: ref(''), channelId: ref(''),
    infoSource: ref('user'), playlistItems: ref([]), userPlaylistVisibleLimit: ref(0),
    playlistError: ref(''), nextPageError: ref('previous page failure'), playlistErrorRetryable: ref(false), isLoading: ref(true), isLoadingMore: ref(false),
    updateLastUpdatedDate() {}, updatePageTitle() {}, clampPlaylistScroll() {}, t: key => key,
    DBLibraryHandlers: { query: async method => {
      if (method === 'playlistStatistics') return { duration: 10, missingDuration: 0 }
      if (++reads === 1) return pending.promise
      if (fail) throw new Error('current failure')
      return { records: [{ videoId: 'retained' }], cursor: null, revision: 1 }
    } },
  })
  const playlist = { _id: 'playlist', playlistName: 'Retained' }
  const old = context.parseUserPlaylist(playlist)
  await context.parseUserPlaylist(playlist)
  assert.equal(context.nextPageError.value, '')
  pending.reject(new Error('superseded failure'))
  await old
  assert.equal(context.playlistError.value, '')
  fail = true
  await context.parseUserPlaylist(playlist)
  assert.notEqual(context.playlistError.value, '')
  assert.equal(context.playlistErrorRetryable.value, true)
  fail = false
  await context.parseUserPlaylist(playlist)
  assert.equal(context.playlistError.value, '')
  assert.equal(context.playlistErrorRetryable.value, false)
  assert.equal(context.isLoading.value, false)
})

for (const extent of [2, 300]) {
  test(`a history duration update refreshes the mounted playlist while retaining ${extent} loaded members`, async t => {
    const database = new DatabaseSync(':memory:'); database.exec(SCHEMA_SQL)
    t.after(() => database.close())
    const engine = new LibraryEngine(database)
    const videos = [{ videoId: 'fallback', title: 'Fallback' }, { videoId: 'explicit', lengthSeconds: 50 }, ...Array.from({ length: extent - 2 }, (_, index) => ({ videoId: `member-${index}`, lengthSeconds: 75 }))]
    const playlist = { _id: 'playlist', playlistName: 'Retained', lastUpdatedAt: 1, videos }
    await engine.collections.playlists.insertAsync(playlist)
    await engine.collections.history.insertAsync({ _id: 'history', videoId: 'fallback', timeWatched: 1, lengthSeconds: 100 })
    const state = reactive({ history: { historyRevision: 0 } })
    const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['parseUserPlaylist'], {
      userStatisticsGeneration: 0, SORT_BY_VALUES: { VideoDurationAscending: 'video_duration_ascending', VideoDurationDescending: 'video_duration_descending' }, userPageGeneration: 0, userPageRevision: 0, playlistId: vueRef('playlist'),
      userPlaylistPreloadIds: ref(null),
      sortOrder: vueRef('video_duration_ascending'), processedVideoSearchQuery: vueRef(''), locale: vueRef('en-US'),
      selectedUserPlaylist: vueRef(playlist), isUserPlaylistRequested: vueRef(true), store: { state }, watch,
      userPageOptions: cursor => ({ id: 'playlist', sort: 'video_duration_ascending', cursor }), userPageCursor: vueRef(null), userStatistics: vueRef({}),
      playlistTitle: ref(''), playlistDescription: ref(''), firstVideoId: ref(''), firstVideoPlaylistItemId: ref(''),
      lastUpdatedDate: ref(null), viewCount: ref(0), channelName: ref(''), channelThumbnail: ref(''), channelId: ref(''),
      infoSource: ref('user'), playlistItems: vueRef([]), userPlaylistVisibleLimit: ref(0),
      playlistError: ref(''), nextPageError: ref(''), playlistErrorRetryable: ref(false), isLoading: ref(true), isLoadingMore: ref(false),
      updateLastUpdatedDate() {}, updatePageTitle() {}, clampPlaylistScroll() {}, t: key => key,
      DBLibraryHandlers: { query: async (method, options) => engine[method](options) },
    })
    const { script, ast } = await source('src/renderer/views/Playlist/Playlist.vue')
    const registration = matching(ast, node => node.type === 'CallExpression' && node.callee.name === 'watch' && node.arguments[0]?.type === 'ArrayExpression' && script.slice(node.arguments[0].start, node.arguments[0].end).includes('processedVideoSearchQuery')).at(0)
    t.after(vm.runInContext(script.slice(registration.start, registration.end), context))
    await context.parseUserPlaylist(playlist, extent)
    assert.equal(context.playlistItems.value.length, extent)
    assert.equal(context.playlistItems.value.at(-1).videoId, 'fallback')
    await engine.collections.history.updateAsync({ _id: 'history' }, { $set: { lengthSeconds: 25 } })
    state.history.historyRevision++
    await nextTick(); await setImmediate()
    assert.equal(context.playlistItems.value.length, extent)
    assert.equal(context.playlistItems.value[0].videoId, 'fallback')
    assert.equal(context.userStatistics.value.duration, 75 + (extent - 2) * 75)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'playlist' })).videos, videos)
  })
}

for (const sort of ['video_duration_ascending', 'video_duration_descending', 'date_added_descending']) {
  test(`Watch playlist refreshes history-backed neighbors only for duration sorts: ${sort}`, async t => {
    const database = new DatabaseSync(':memory:'); database.exec(SCHEMA_SQL)
    t.after(() => database.close())
    const engine = new LibraryEngine(database)
    const videos = [{ videoId: 'fallback', title: 'Fallback' }, { videoId: 'explicit', title: 'Explicit', lengthSeconds: 50 }]
    await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Retained', videos })
    await engine.collections.history.insertAsync({ _id: 'h', videoId: 'fallback', timeWatched: 1, lengthSeconds: 100 })
    const state = reactive({ history: { historyRevision: 0 } })
    let reads = 0
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], {
      store: { state }, watch, props: reactive({ videoId: 'explicit' }), sortOrder: vueRef(sort), locale: vueRef('en-US'), isPagedPlaylist: vueRef(true),
      userWindowGeneration: 0, userWindowReady: vueRef(false), userWindowOwner: vueRef(''), userWindowKey: () => 'owner',
      isLoading: vueRef(false), prevVideoBeforeDeletion: vueRef(null), userWindow: vueRef({ index: -1 }), playlistItems: vueRef([]),
      userPlaylistWindowOptions: () => ({ id: 'p', sort, anchor: { videoId: 'explicit' } }),
      DBLibraryHandlers: { query: async (method, options) => { reads++; return engine[method](options) } }, showToast() {}, t: key => key,
    })
    const { script, ast } = await source('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue')
    const registration = matching(ast, node => node.type === 'CallExpression' && node.callee.name === 'watch' && node.arguments[0]?.type === 'ArrayExpression' && script.slice(node.arguments[0].start, node.arguments[0].end).includes('props.libraryMemberId')).at(0)
    assert.ok(registration)
    t.after(vm.runInContext(script.slice(registration.start, registration.end), context))
    await context.loadUserPlaylistWindow()
    const before = context.userWindow.value.records.map(item => item.videoId)
    await engine.collections.history.updateAsync({ _id: 'h' }, { $set: { lengthSeconds: 25 } })
    state.history.historyRevision++
    await nextTick(); await setImmediate()
    if (sort.startsWith('video_duration_')) {
      assert.equal(reads, 2)
      assert.deepEqual(context.userWindow.value.records.map(item => item.videoId), before.toReversed())
      assert.equal((sort.endsWith('ascending') ? context.userWindow.value.previous : context.userWindow.value.next).videoId, 'fallback')
    } else assert.equal(reads, 1)
    assert.equal(context.userWindowReady.value, true)
    assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, videos)
  })
}

for (const stale of [false, true]) {
  test(`watch playlist window failure ${stale ? 'preserves a newer loader' : 'releases the current loader'}`, async () => {
    const pending = Promise.withResolvers(), toasts = []
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], {
      userWindowGeneration: 0, userWindowReady: ref(false), userWindowOwner: ref(''), userWindowKey: () => 'current', isLoading: ref(true), userWindow: ref({ index: -1 }),
      userPlaylistWindowOptions: () => ({}), DBLibraryHandlers: { query: () => pending.promise },
      t: key => key, showToast: toast => toasts.push(toast),
    })
    const loading = context.loadUserPlaylistWindow()
    if (stale) context.userWindowGeneration++
    pending.reject(new Error('window unavailable'))
    await loading
    assert.equal(context.isLoading.value, stale)
    assert.equal(toasts.length, stale ? 0 : 1)
  })
}

test('watch playlist releases its loader when the deleted-current-video fallback query fails', async () => {
  const toasts = []
  let queries = 0
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], {
    userWindowGeneration: 0, userWindowReady: ref(false), userWindowOwner: ref(''), userWindowKey: () => 'current', isLoading: ref(true), prevVideoBeforeDeletion: ref(null),
    userWindow: ref({ index: 1, previous: { _libraryMemberId: 'previous' } }), playlistItems: ref([]), userPlaylistWindowOptions: () => ({}),
    DBLibraryHandlers: { query: async () => { if (++queries === 1) return { index: -1, records: [{ videoId: 'retained' }] }; throw new Error('fallback unavailable') } },
    t: key => key, showToast: toast => toasts.push(toast),
  })
  await context.loadUserPlaylistWindow()
  assert.equal(queries, 2)
  assert.equal(context.isLoading.value, false)
  assert.equal(toasts.length, 0)
  assert.equal(context.prevVideoBeforeDeletion.value, null)
  assert.equal(context.userWindow.value.index, -1)
  assert.deepEqual(structuredClone(context.playlistItems.value), [{ videoId: 'retained' }])
})

for (const outcome of ['missing', 'anchored', 'stale failure', 'stale success']) {
  test(`deletion fallback ${outcome} publishes only the usable current window and marker`, async () => {
    const fallback = Promise.withResolvers(), toasts = []
    const initial = { index: -1, records: [{ videoId: 'initial' }] }
    let queries = 0
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], {
      userWindowGeneration: 0, userWindowReady: ref(false), userWindowOwner: ref(''), userWindowKey: () => 'current', isLoading: ref(true), prevVideoBeforeDeletion: ref(null), playlistItems: ref([]),
      userWindow: ref({ index: 1, previous: { _libraryMemberId: 'previous' } }), userPlaylistWindowOptions: () => ({}),
      DBLibraryHandlers: { query: async () => ++queries === 1 ? initial : fallback.promise },
      t: key => key, showToast: toast => toasts.push(toast),
    })
    const loading = context.loadUserPlaylistWindow()
    await setImmediate()
    const stale = outcome.startsWith('stale')
    const newer = { index: 4, records: [{ videoId: 'newer' }] }
    if (stale) {
      context.userWindowGeneration++
      context.userWindow.value = newer
      context.playlistItems.value = newer.records
      context.prevVideoBeforeDeletion.value = { _libraryMemberId: 'newer-marker' }
    }
    const anchored = { index: 2, records: [{ videoId: 'anchored' }] }
    if (outcome === 'stale failure') fallback.reject(new Error('old fallback failed'))
    else fallback.resolve(outcome === 'missing' ? { index: -1, records: [{ videoId: 'unusable-anchor' }] } : anchored)
    await loading
    const expected = stale ? newer : outcome === 'anchored' ? anchored : initial
    assert.deepEqual(structuredClone(context.userWindow.value), expected)
    assert.deepEqual(structuredClone(context.playlistItems.value), expected.records)
    assert.deepEqual(structuredClone(context.prevVideoBeforeDeletion.value), stale ? { _libraryMemberId: 'newer-marker' } : outcome === 'anchored' ? { _libraryMemberId: 'previous' } : null)
    assert.equal(context.isLoading.value, stale)
    assert.equal(toasts.length, 0)
  })
}

for (const failure of [false, true]) {
  test(`paged watched cleanup reports ${failure ? 'failure' : 'the removed count'}`, async () => {
    const toasts = [], scheduled = []
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['handleRemoveWatchedVideosPromptAnswer'], {
      showRemoveWatchedVideosPrompt: ref(true), selectedUserPlaylist: ref({}), isPagedPlaylist: ref(true), props: { playlistId: 'playlist' },
      DBLibraryHandlers: { query: async () => { if (failure) throw new Error('cleanup failed'); return 3 } },
      store: { dispatch: async (action, reason) => { if (action === 'scheduleSyncServer') scheduled.push(reason) } }, showToast: toast => toasts.push(toast),
      t: (key, values) => values ? `${key}:${values.videoCount}` : key,
    })
    await context.handleRemoveWatchedVideosPromptAnswer('delete')
    assert.deepEqual(scheduled, failure ? [] : ['playlists'])
    assert.equal(toasts.length, 1)
    assert.match(toasts[0].message, failure ? /There was an issue/ : /removed:3$/)
  })
}

for (const action of ['exportAsFreeTubeDatabase', 'exportAsYouTubeCsv', 'exportAsListOfUrls']) {
  for (const deleted of [false, true]) {
    test(`${action} shows an error and writes nothing for a ${deleted ? 'deleted' : 'failed'} snapshot`, async () => {
      const toasts = []
      let writes = 0
      const context = await functions(playlistInfo, action === 'exportAsFreeTubeDatabase' ? [action] : ['orderedExportVideos', action], {
        props: { id: 'playlist', title: 'Retained' }, selectedUserPlaylist: ref({ playlistName: 'Retained' }),
        isUserPlaylist: ref(true), locale: ref('en-US'), store: { getters: { getUserPlaylistSortOrder: 'custom' } },
        getExportFilename: () => 'retained.db', getSortedPlaylistItems: videos => videos,
        DBLibraryHandlers: { query: async () => { if (deleted) return null; throw new Error('snapshot unavailable') } },
        writeFileWithPicker() { writes++; return false }, t: key => key, showToast: toast => toasts.push(toast),
      })
      await context[action]()
      assert.equal(writes, 0)
      assert.equal(toasts.length, 1)
      assert.match(toasts[0].message, /Unable to write file/)
    })
  }
}

test('failed playlist copy shows its load error without opening an empty prompt', async () => {
  const toasts = []
  const context = await functions(playlistInfo, ['toggleCopyVideosPrompt'], {
    snapshotPending: ref(false), props: { id: 'playlist', channelName: '', title: 'Retained' },
    isUserPlaylist: ref(true), selectedUserPlaylist: ref({}),
    DBLibraryHandlers: { query: async () => { throw new Error('snapshot unavailable') } },
    store: { dispatch() { assert.fail('failed snapshots must not open a copy prompt') } },
    t: key => key, showToast: toast => toasts.push(toast),
  })
  await context.toggleCopyVideosPrompt()
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /This playlist could not be loaded/)
})

test('failed unavailable-video removal releases its selection and shows an update error', async () => {
  const toasts = []
  const context = await functions(playlistInfo, ['handleRemoveDeadVideosPromptAnswer'], {
    showRemoveDeadVideosPrompt: ref(true), props: { id: 'playlist' }, deadVideoItemIds: ref(new Set(['member'])),
    DBLibraryHandlers: { query: async () => { throw new Error('stale member') } },
    t: key => key, showToast: toast => toasts.push(toast),
  })
  await context.handleRemoveDeadVideosPromptAnswer('delete')
  assert.equal(context.deadVideoItemIds.value.size, 0)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /There was an issue/)
})

for (const outcome of ['rejected read', 'missing playlist', 'rejected write', 'no matches', 'saved']) {
  test(`portable unavailable-video removal handles ${outcome} without retaining stale selection or losing fields`, async () => {
    const toasts = [], writes = []
    const playlist = { _id: 'playlist', unknown: new Date(2), videos: [{ playlistItemId: 'member', unknown: new Date(3) }, { playlistItemId: 'kept', unknown: new Date(4) }] }
    const before = structuredClone(playlist)
    const context = await functions(playlistInfo, ['handleRemoveDeadVideosPromptAnswer'], {
      process: { env: { IS_ELECTRON: false } }, showRemoveDeadVideosPrompt: ref(true), props: { id: 'playlist' },
      deadVideoItemIds: ref(new Set([outcome === 'no matches' ? 'absent' : 'member'])),
      DBLibraryHandlers: { query: async () => { if (outcome === 'rejected read') throw new Error('read failed'); return outcome === 'missing playlist' ? null : playlist } },
      store: { dispatch: async (_, record) => { if (outcome === 'rejected write') throw new Error('write failed'); writes.push(record); return true } },
      t: key => key, showToast: toast => toasts.push(toast),
    })
    await context.handleRemoveDeadVideosPromptAnswer('delete')
    assert.equal(context.deadVideoItemIds.value.size, 0)
    assert.deepEqual(playlist, before)
    assert.equal(toasts.length, outcome === 'no matches' ? 0 : 1)
    if (outcome === 'saved') assert.deepEqual(structuredClone(writes), [{ ...before, videos: [before.videos[1]] }])
    else {
      assert.equal(writes.length, 0)
      if (outcome !== 'no matches') assert.match(toasts[0].message, /There was an issue/)
    }
  })
}

test('dead-video scan handles a failed page read and releases its running state', async () => {
  const toasts = []
  const context = await functions(playlistInfo, ['scanDeadVideos'], {
    props: { id: 'playlist' }, deadVideoScanRunning: ref(false), deadVideoScanController: null,
    deadVideoProgress: ref({ checked: 0, total: 0 }), AbortController,
    DBLibraryHandlers: { query: async () => { throw new Error('page unavailable') } },
    showToast: toast => toasts.push(toast), t: key => key,
  })
  await context.scanDeadVideos()
  assert.equal(context.deadVideoScanRunning.value, false)
  assert.equal(context.deadVideoScanController, null)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /This playlist could not be loaded/)
})

test('dead-video scan owns the loading phase so a second click cannot start another scan', async () => {
  const pending = Promise.withResolvers()
  let reads = 0
  const context = await functions(playlistInfo, ['scanDeadVideos'], {
    props: { id: 'playlist' }, deadVideoScanRunning: ref(false), deadVideoScanController: null,
    deadVideoProgress: ref({ checked: 0, total: 0 }), AbortController,
    deadVideoItemIds: ref(new Set()), showRemoveDeadVideosPrompt: ref(false),
    DBLibraryHandlers: { query: () => { reads++; return pending.promise } },
    findDeadPlaylistItems: async () => ({ itemIds: new Set() }),
    showToast() {}, t: key => key,
  })
  const first = context.scanDeadVideos()
  const runningDuringLoad = context.deadVideoScanRunning.value
  const second = context.scanDeadVideos()
  pending.resolve({ records: [], cursor: null })
  await Promise.all([first, second])
  assert.equal(runningDuringLoad, true)
  assert.equal(reads, 1)
  assert.equal(context.deadVideoScanRunning.value, false)
})

test('CSV export handles missing legacy timestamps without changing playlist records', async () => {
  const videos = [{ videoId: 'missing' }, { videoId: 'invalid', timeAdded: 'invalid' }, { videoId: 'valid', timeAdded: 1000 }]
  const before = structuredClone(videos)
  let exported
  const { exportAsYouTubeCsv } = await functions(playlistInfo, ['orderedExportVideos', 'exportAsYouTubeCsv'], {
    props: { id: 'playlist', title: 'Legacy' }, isUserPlaylist: ref(true), locale: ref('en-US'),
    store: { getters: { getUserPlaylistSortOrder: 'custom' } },
    DBLibraryHandlers: { query: async () => ({ records: videos, cursor: null }) },
    getExportFilename: () => 'legacy.csv', t: key => key,
    writeFileWithPicker: async (_name, data) => { exported = data; return false },
  })
  await exportAsYouTubeCsv()
  assert.equal(exported, 'Video ID,Playlist video creation timestamp\nmissing,1970-01-01T00:00:00+00:00\ninvalid,1970-01-01T00:00:00+00:00\nvalid,1970-01-01T00:00:01+00:00\n\n\n\n\n\n')
  assert.deepEqual(videos, before)
})

test('a failed staged import retains its lease for retry and still releases other failed jobs', async t => {
  const { script, ast } = await source('src/main/index.js')
  const node = matching(ast, node => node.type === 'CallExpression' && node.callee.object?.name === 'ipcMain' && node.arguments[0]?.property?.name === 'LIBRARY_QUERY')[0]?.arguments[1]
  assert.ok(node, 'the actual library IPC handler must exist')
  const canceled = []
  const jobs = new LibraryJobs(async (method, data) => canceled.push([method, data.id]))
  t.after(() => { for (const id of jobs.jobs.keys()) jobs.complete(id) })
  const owner = new EventEmitter()
  jobs.track(owner, 'importStart', 'retry-stage')
  let fail = true
  const failure = new Error('disk unavailable')
  const request = vm.runInNewContext(`(${script.slice(node.start, node.end)})`, {
    isOpenTubeXUrl: () => true, libraryJobs: jobs,
    libraryRequest: async () => { if (fail) throw failure; return { restored: true } },
    syncOtherWindows() {}, IpcChannels: {}, SyncEvents: { GENERAL: { INVALIDATE: 'invalidate' } },
  })
  const event = { sender: owner, senderFrame: { url: 'app://renderer' } }
  await assert.rejects(request(event, { method: 'importApply', data: { id: 'retry-stage' } }), error => error === failure)
  assert.equal(jobs.jobs.has('retry-stage'), true)
  assert.deepEqual(canceled, [])
  fail = false
  assert.deepEqual(await request(event, { method: 'importApply', data: { id: 'retry-stage' } }), { restored: true })
  assert.equal(jobs.jobs.has('retry-stage'), false)
  jobs.track(owner, 'importStart', 'bad-chunk')
  fail = true
  await assert.rejects(request(event, { method: 'importChunk', data: { id: 'bad-chunk' } }), error => error === failure)
  assert.equal(jobs.jobs.has('bad-chunk'), false)
  assert.deepEqual(canceled, [['importCancel', 'bad-chunk']])
})

test('backup apply errors use an import error and leave the staged selection open for retry', async () => {
  const staged = { id: 'stage', counts: { history: 1 } }
  const toasts = []
  const context = await functions(dataSettings, ['importUnifiedBackup'], {
    backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null, backupBusy: ref(false), backupData: ref(staged), selectedBackupSections: ref(['history']),
    DBLibraryHandlers: { query: async () => { throw new Error('apply failed') } },
    showToast: toast => toasts.push(toast), t: key => key,
    closeBackupImport() { assert.fail('a failed import must remain retryable') },
  })
  await context.importUnifiedBackup()
  assert.equal(context.backupBusy.value, false)
  assert.equal(context.backupData.value, staged)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /Import Failed/)
})

for (const action of ['filterHistory', 'increaseLimit']) {
  test(`history ${action} bounds repeated stale pages and retains its last complete results`, async () => {
    let calls = 0
    const retained = [{ videoId: 'retained' }]
    const context = await functions('src/renderer/views/History/History.vue', ['filterHistory', 'increaseLimit'], {
      pageCursor: { id: 'old' }, searchGeneration: 0, activeData: ref(retained), isSearching: ref(false), historyReadFailed: ref(false), historyPageReadFailed: ref(false),
      showSearchFeedback: ref(true), showLoadMoreButton: ref(true), query: ref(''),
      dataLimit: ref(100), searchDataLimit: ref(100), doCaseSensitiveSearch: ref(false),
      sortBy: ref('newest'), HISTORY_SORT_BY_VALUES: {}, locale: ref('en-US'),
      filterHistoryAsync: { cancel() {} }, clampHistoryScroll() {},
      DBLibraryHandlers: { query: async () => { if (++calls > 6) throw new Error('unbounded retry'); return { stale: true } } },
    })
    await context[action]()
    assert.equal(calls, action === 'increaseLimit' ? 4 : 3)
    assert.deepEqual(context.activeData.value, retained)
    assert.equal(context.isSearching.value, false)
    assert.equal(context.showSearchFeedback.value, false)
  })
}

for (const outcome of ['success', 'failure']) {
  test(`a pending library page ${outcome} cannot publish after a remote playlist reset`, async () => {
    const pending = Promise.withResolvers()
    const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['getNextPage', 'resetState'], {
      infoSource: ref('user'), isLoadingMore: ref(false), userPageCursor: ref('next'), userPageGeneration: 1,
      playlistRequestGeneration: 1, playlistId: ref('saved'), playlistItems: ref([{ videoId: 'old' }]),
      userPlaylistVisibleLimit: ref(1), userPageOptions: cursor => ({ cursor }), t: key => key,
      DBLibraryHandlers: { query: () => pending.promise },
      releasePlaylistPreloadUi() {}, clearPlaylistPreloadComplete() {},
      ...Object.fromEntries(['isLoading', 'playlistTitle', 'playlistDescription', 'firstVideoId', 'playlistThumbnail', 'viewCount', 'videoCount', 'lastUpdated', 'lastUpdatedDate', 'channelName', 'channelThumbnail', 'channelId', 'showUnavailableVideosAlert', 'continuationData', 'nextInvidiousPlaylistPage', 'nextPageError', 'playlistError', 'playlistErrorRetryable'].map(name => [name, ref(null)])),
      fetchedLocalPlaylistItemCount: 0,
    })
    const loading = context.getNextPage()
    context.playlistId.value = 'remote'
    context.resetState()
    context.playlistItems.value = [{ videoId: 'remote' }]
    context.isLoadingMore.value = true
    if (outcome === 'success') pending.resolve({ records: [{ videoId: 'old-next' }], cursor: 'old-cursor' })
    else pending.reject(new Error('old page failed'))
    await loading
    assert.deepEqual(context.playlistItems.value, [{ videoId: 'remote' }])
    assert.equal(context.isLoadingMore.value, true)
    assert.equal(context.nextPageError.value, '')
    assert.equal(context.userPageCursor.value, null)
  })
}

test('desktop Watch Shorts reacts to subscription membership changes without revision changes', async () => {
  const { libraryShortsRequest } = await functions('src/renderer/views/Watch/Watch.js', ['libraryShortsRequest'], {
    hasConfiguredRestrictedPlaybackAuthentication: () => false,
  })
  const view = reactive({
    subscriptionShortsFeedActive: true, tabRoute: { query: {} }, videoId: 'current',
    $store: { getters: { getActiveProfile: { subscriptions: [{ id: 'first' }] } }, state: { subscriptionCache: { subscriptionVideosFeedVersion: 1 }, history: { historyRevision: 1 } } },
  })
  const requests = []
  const stop = watch(computed(() => libraryShortsRequest.call(view)), request => requests.push(request.subscriptions.map(channel => channel.id)), { immediate: true })
  try {
    view.$store.getters.getActiveProfile.subscriptions.push({ id: 'second' })
    await nextTick()
    view.$store.getters.getActiveProfile.subscriptions.splice(0, 1)
    await nextTick()
    assert.deepEqual(requests.map(ids => Array.from(ids)), [['first'], ['first', 'second'], ['second']])
    assert.deepEqual(Array.from(libraryShortsRequest.call(view).revision), [1, 1])
  } finally { stop() }
})

test('failed user-playlist pagination exposes retry and clears the error after success', async () => {
  let fail = true
  const retained = { videoId: 'retained' }, added = { videoId: 'added' }
  const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['getNextPage'], {
    infoSource: ref('user'), playlistId: ref('playlist'), isLoadingMore: ref(false), userPageCursor: ref({ id: 'next' }), userPageGeneration: 1,
    userPlaylistVisibleLimit: ref(1), playlistItems: ref([retained]), nextPageError: ref(''),
    userPageOptions: cursor => ({ cursor }), t: key => key,
    DBLibraryHandlers: { query: async () => { if (fail) throw new Error('page unavailable'); return { records: [added], cursor: null } } },
  })
  await context.getNextPage()
  assert.match(context.nextPageError.value, /More videos could not be loaded/)
  assert.equal(context.isLoadingMore.value, false)
  assert.deepEqual(context.playlistItems.value, [retained])
  fail = false
  await context.getNextPage()
  assert.equal(context.nextPageError.value, '')
  assert.equal(context.isLoadingMore.value, false)
  assert.deepEqual(Array.from(context.playlistItems.value), [retained, added])
})


test('data import failures reach the shared error toast without reporting success', async () => {
  const failure = new Error('disk unavailable')
  const toasts = [], errors = []
  const { runDataImport } = await functions(dataSettings, ['runDataImport'], {
    showToast: toast => toasts.push(toast), t: key => key, console: { error: error => errors.push(error) },
  })
  await runDataImport(async () => { throw failure })
  assert.deepEqual(errors, [failure])
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /Import Failed.*disk unavailable/)
})

test('portable dead-video scan handles a playlist deleted before its snapshot arrives', async () => {
  const toasts = []
  const context = await functions(playlistInfo, ['scanDeadVideos'], {
    process: { env: { IS_ELECTRON: false } }, props: { id: 'deleted' },
    deadVideoScanRunning: ref(false), deadVideoScanController: null,
    deadVideoProgress: ref({ checked: 0, total: 0 }), AbortController,
    DBLibraryHandlers: { query: async () => null }, showToast: toast => toasts.push(toast), t: key => key,
  })
  await context.scanDeadVideos()
  assert.equal(context.deadVideoScanRunning.value, false)
  assert.equal(context.deadVideoScanController, null)
  assert.equal(toasts.length, 1)
})

test('history stale-page retry discards partial results before restarting', async () => {
  const pages = [
    { records: [{ videoId: 'discarded' }], cursor: 'older' }, { stale: true },
    { records: [{ videoId: 'current' }], cursor: null },
  ]
  const cursors = [], cached = []
  const context = await functions('src/renderer/views/History/History.vue', ['filterHistory'], {
    searchGeneration: 0, activeData: ref([]), isSearching: ref(false), showSearchFeedback: ref(true), historyReadFailed: ref(false), historyPageReadFailed: ref(false),
    showLoadMoreButton: ref(true), query: ref(''), dataLimit: ref(100), searchDataLimit: ref(100),
    doCaseSensitiveSearch: ref(false), sortBy: ref('newest'), HISTORY_SORT_BY_VALUES: {}, locale: ref('en-US'),
    filterHistoryAsync: { cancel() {} }, clampHistoryScroll() {},
    DBLibraryHandlers: { query: async (_, options) => { cursors.push(options.cursor); return pages.shift() } },
    store: { dispatch: (_, records) => cached.push(records) },
  })
  await context.filterHistory()
  assert.deepEqual(cursors, [null, 'older', null])
  assert.deepEqual(structuredClone(context.activeData.value), [{ videoId: 'current' }])
  assert.deepEqual(structuredClone(cached), [[{ videoId: 'current' }]])
  assert.equal(context.showLoadMoreButton.value, false)
  assert.equal(context.isSearching.value, false)
})

test('a superseded playlist page failure preserves the new request loading state', async () => {
  const pending = Promise.withResolvers()
  const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['getNextPage'], {
    infoSource: ref('user'), playlistId: ref('playlist'), isLoadingMore: ref(false), userPageCursor: ref({ id: 'next' }), userPageGeneration: 1,
    userPageOptions: cursor => ({ cursor }), nextPageError: ref(''),
    DBLibraryHandlers: { query: () => pending.promise },
  })
  const loading = context.getNextPage()
  context.userPageGeneration++
  pending.reject(new Error('old request failed'))
  await loading
  assert.equal(context.isLoadingMore.value, true)
  assert.equal(context.nextPageError.value, '')
})


for (const loader of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  for (const rejectNetwork of [false, true]) {
    test(`${loader} starts networking during history hydration and waits before applying ${rejectNetwork ? 'errors' : 'metadata'}`, async () => {
      const history = Promise.withResolvers()
      let requests = 0
      const request = async () => {
        requests++
        if (rejectNetwork) throw new Error('Video unavailable')
        return loader === 'getVideoInformationLocal'
          ? { info: { playability_status: { status: 'LOGIN_REQUIRED', error_screen: { reason: { text: 'Private video' } } } } }
          : { error: 'Private video' }
      }
      const methods = await functions('src/renderer/views/Watch/Watch.js', [loader], {
        initializeNetworkRecovery: () => ({ ready: Promise.resolve() }), getConnectionState: () => 'online',
        getLocalVideoInfo: request, invidiousGetVideoInformation: request,
      })
      const context = {
        firstLoad: true, tabRoute: { params: { id: 'video' } },
        $store: { state: { history: { libraryPaged: true } }, dispatch: () => history.promise },
        isCurrentVideoLoad: () => true, getUnavailableVideoThumbnail: () => 'unavailable.png',
        setNonRetryablePlaybackError() {}, getRestrictedPlaybackErrorType: () => 'private', setRestrictedPlaybackError() {},
        updateTitle() {}, runIpBlockRecoveryScriptAndReload: async () => false, finishDownloadedPlaybackWithoutMetadata: () => false,
      }
      const loading = methods[loader].call(context, 1)
      await setImmediate()
      const requestsBeforeHydration = requests
      const loadingBeforeHydration = context.isLoading
      const appliedBeforeHydration = context.playabilityStatus
      history.resolve()
      await loading
      assert.equal(requestsBeforeHydration, 1, 'library latency must not defer the video request')
      assert.equal(loadingBeforeHydration, true, 'playback state still waits for saved history')
      assert.equal(appliedBeforeHydration, undefined)
      assert.equal(context.isLoading, false)
    })
  }
  test(`${loader} waits for saved history before finishing offline downloaded playback`, async () => {
    const history = Promise.withResolvers()
    let finished = 0
    const methods = await functions('src/renderer/views/Watch/Watch.js', [loader], {
      initializeNetworkRecovery: () => ({ ready: Promise.resolve() }), getConnectionState: () => 'offline',
    })
    const context = {
      firstLoad: true, tabRoute: { params: { id: 'video' } },
      $store: { state: { history: { libraryPaged: true } }, dispatch: () => history.promise },
      isCurrentVideoLoad: () => true, finishDownloadedPlaybackWithoutMetadata() { finished++; return true },
    }
    const loading = methods[loader].call(context, 1)
    await setImmediate()
    const finishedBeforeHydration = finished
    history.resolve()
    await loading
    assert.equal(finishedBeforeHydration, 0)
    assert.equal(finished, 1)
  })
}

test('empty membership hydration records absence and does not repeat Watch lookups', async () => {
  let reads = 0, hydration
  const { cachePlaylistMemberships } = await functions('src/renderer/store/modules/playlists.js', ['cachePlaylistMemberships'])
  const hydrator = await functions('src/renderer/helpers/libraryState.js', ['hydrateVideoState'], {
    pendingIds: new Set(), queued: false, pending: Promise.resolve(), setTimeout,
    DBLibraryHandlers: { query: async () => { reads++; return { history: [], memberships: [] } } },
  })
  const state = { playlists: { libraryPaged: true, playlistMemberships: {}, playlistVideoCounts: new Map() }, history: { libraryPaged: true, activeVideoIds: {} } }
  const store = {
    state, getters: { getPlaylistMemberships: state.playlists.playlistMemberships },
    commit(name, payload) { if (name === 'cachePlaylistMemberships') cachePlaylistMemberships(state.playlists, payload) },
    dispatch(name, ids) { assert.equal(name, 'hydrateVideoState'); hydration = hydrator.hydrateVideoState(store, ids); return hydration },
  }
  const { checkIfPlaylist } = await functions('src/renderer/views/Watch/Watch.js', ['checkIfPlaylist'])
  const view = { videoId: 'absent', selectedUserPlaylist: { _id: 'saved' }, tabRoute: { query: { playlistId: 'saved' } }, $store: store }
  view.checkIfPlaylist = () => checkIfPlaylist.call(view)
  view.checkIfPlaylist()
  await hydration
  await setImmediate()
  assert.equal(reads, 1)
  assert.deepEqual(structuredClone(state.playlists.playlistMemberships), { absent: {} })
  assert.equal(view.watchingPlaylist, false)
  assert.equal(view.playlistId, '')
})

for (const nextPlaylist of [null, 'next-playlist']) {
  for (const fail of [false, true]) {
    test(`stale playlist hydration ${fail ? 'failure' : 'completion'} preserves route state for ${nextPlaylist ?? 'a video without a playlist'}`, async () => {
      const pending = Promise.withResolvers()
      const { checkIfPlaylist } = await functions('src/renderer/views/Watch/Watch.js', ['checkIfPlaylist'])
      const view = {
        videoId: 'old-video', tabRoute: { query: { playlistId: 'old-playlist', playlistItemId: 'old-member' } },
        selectedUserPlaylist: { _id: 'old-playlist' },
        $store: { state: { playlists: { libraryPaged: true } }, getters: { getPlaylistMemberships: {} }, dispatch: () => pending.promise },
      }
      view.checkIfPlaylist = () => checkIfPlaylist.call(view)
      view.checkIfPlaylist()
      assert.equal(view.watchingPlaylist, true)
      view.videoId = 'next-video'
      view.tabRoute.query = nextPlaylist ? { playlistId: nextPlaylist, playlistItemId: 'next-member' } : {}
      view.selectedUserPlaylist = nextPlaylist ? { _id: nextPlaylist } : null
      view.$store.getters.getPlaylistMemberships['next-video'] = { [nextPlaylist]: 1 }
      view.checkIfPlaylist()
      const current = () => [view.playlistId, view.playlistType, view.playlistItemId, view.watchingPlaylist]
      const expected = nextPlaylist ? [nextPlaylist, 'user', 'next-member', true] : [undefined, '', null, false]
      assert.deepEqual(current(), expected)
      if (fail) pending.reject(new Error('old hydration failed'))
      else pending.resolve()
      await setImmediate()
      assert.deepEqual(current(), expected)
    })
  }
}

test('older playlist imports discard operational flags while retaining member data and unknown fields', async () => {
  const original = { _id: 'imported', playlistName: 'Imported', protected: true, removeOnWatched: true,
    lastUpdatedAt: 1, lastPlayedAt: 1, future: { keep: true },
    videos: [{ videoId: 'same', title: 'First', lengthSeconds: 1, timeAdded: 1, playlistItemId: 'duplicate', unknown: 'first' },
      { videoId: 'same', title: 'Second', lengthSeconds: 1, timeAdded: 2, playlistItemId: 'duplicate', unknown: 'second' }] }
  let imported
  const context = await functions(dataSettings, ['importPlaylists'], {
    readFileWithPicker: async () => ({ filename: 'playlists.db', content: JSON.stringify([original]) }),
    isJsonObject: value => value !== null && typeof value === 'object', crypto: { randomUUID: () => 'new' },
    importLibraryRecords: async (section, records) => { assert.equal(section, 'playlists'); imported = records },
    IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'downloads', t: key => key, showToast() {},
  })
  await context.importPlaylists()
  assert.equal(imported.length, 1)
  assert.equal(Object.hasOwn(imported[0], 'protected'), false)
  assert.equal(Object.hasOwn(imported[0], 'removeOnWatched'), false)
  assert.equal(Object.hasOwn(imported[0], 'lastPlayedAt'), false)
  assert.equal(Object.hasOwn(imported[0], 'lastUpdatedAt'), false)
  assert.deepEqual(structuredClone(imported[0].videos), original.videos)
  assert.deepEqual(structuredClone(imported[0].future), original.future)
})

for (const trigger of ['edit', 'stale', 'new route']) {
  test(`playlist ${trigger} reload keeps the appropriate loaded extent`, async () => {
    const extents = []
    const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['getPlaylistInfo', 'getNextPage'], {
      isUserPlaylistRequested: ref(true), userPlaylistsReady: ref(true), selectedUserPlaylist: ref({ _id: 'playlist' }),
      infoSource: ref(trigger === 'new route' ? 'local' : 'user'), playlistTitle: ref('Retained'),
      playlistItems: ref(Array.from({ length: 400 }, (_, index) => ({ videoId: `${index}` }))),
      isLoading: ref(false), isLoadingMore: ref(false), playlistError: ref(''), nextPageError: ref(''), playlistErrorRetryable: ref(false), nextPageError: ref(''),
      userPageCursor: ref('old cursor'), userPageGeneration: 1, playlistId: ref('playlist'),
      userPageOptions: cursor => ({ cursor }),
      DBLibraryHandlers: { query: async () => ({ stale: true }) },
      parseUserPlaylist: async (_, extent = 100) => { extents.push(extent) },
    })
    if (trigger === 'stale') await context.getNextPage()
    else context.getPlaylistInfo()
    assert.deepEqual(extents, [trigger === 'new route' ? 100 : 400])
  })
}

test('desktop RSS enrichment restores bounded durable verdicts before watch-page requests', async () => {
  const { mapConcurrently } = await import('../../src/renderer/helpers/concurrent-map.js')
  const { applyRssPremiereVerdict, collectResolvedNonPremiereVideoIds } = await import('../../src/renderer/helpers/subscription-entries.js')
  const { isRssUpcomingPremiereCandidate } = await functions('src/renderer/helpers/api/feed-rss.js', ['isRssUpcomingPremiereCandidate'])
  const known = Array.from({ length: 600 }, (_, index) => ({ videoId: `known-${index}`, isRSS: true, viewCount: '0', unknown: new Date(index) }))
  const unresolved = { videoId: 'unresolved', isRSS: true, viewCount: '0' }
  const reads = [], network = [], negatives = new Set()
  let concurrent = 0, maximum = 0
  const context = await functions('src/renderer/helpers/subscriptions.js', ['seedRssNonPremiereVideoIds', 'fetchRssVideoUpcomingInfo', 'enrichRssVideoIfNeeded', 'enrichSubscriptionRssEntries'], {
    store: { getters: { getSubscriptionCacheReady: true, getVideoCache: {}, getShortsCache: {}, getLiveCache: {} } },
    rssNonPremiereVideoIds: negatives, rssNonPremiereVideoIdsSeeded: false, rssUpcomingInfoRequests: new Map(), RSS_ENRICHMENT_CONCURRENCY: 3,
    collectResolvedNonPremiereVideoIds, applyRssPremiereVerdict, isRssUpcomingPremiereCandidate, mapConcurrently,
    DBLibraryHandlers: { query: async (method, { ids }) => {
      assert.equal(method, 'subscriptionRssVerdicts')
      assert.ok(ids.length <= 250)
      reads.push(ids); maximum = Math.max(maximum, ++concurrent)
      await setImmediate(); concurrent--
      return ids.filter(id => id.startsWith('known-'))
    } },
    fetchRssVideoUpcomingInfoUncached: async id => { network.push(id); return { isUpcoming: false, failed: true } },
  })
  const original = structuredClone(known)
  const result = await context.enrichSubscriptionRssEntries([...known, unresolved, { videoId: 'not RSS', viewCount: '0' }])
  assert.deepEqual(network, ['unresolved'])
  assert.deepEqual(structuredClone(result.slice(0, 600)), known.map(entry => ({ ...entry, isUpcoming: false })))
  assert.deepEqual(known, original)
  assert.equal(negatives.size, 600)
  assert.equal(context.rssNonPremiereVideoIdsSeeded, false, 'desktop metadata summaries cannot seed all durable verdicts')
  assert.equal(reads.length, 3)
  assert.ok(maximum <= 3)
  await context.enrichSubscriptionRssEntries([known[0], unresolved])
  assert.deepEqual(network, ['unresolved', 'unresolved'], 'failed network verdicts stay retryable')
  assert.deepEqual(structuredClone(reads.at(-1)), ['unresolved'])
})


test('legacy desktop subscription import merges the current profiles after another window edits them', async t => {
  const database = new DatabaseSync(':memory:'); database.exec(SCHEMA_SQL)
  t.after(() => database.close())
  const engine = new LibraryEngine(database)
  const main = { _id: 'allChannels', name: 'Original', bgColor: '#000', textColor: '#fff', subscriptions: [{ id: 'keep', showMembersOnly: false }, { id: 'removed' }], unknown: new Date(1) }
  await engine.collections.profiles.insertAsync(main)
  const current = { ...main, name: 'Edited in another window', subscriptions: [{ id: 'keep', showMembersOnly: true, unknown: new Date(2) }, { id: 'concurrent' }] }
  const incoming = { _id: 'imported', name: 'Imported', bgColor: '#111', textColor: '#eee', subscriptions: [{ id: 'keep', showMembersOnly: false }, { id: 'imported-channel' }] }
  let concurrent = false
  const edit = async () => {
    if (!concurrent) { concurrent = true; await engine.collections.profiles.updateAsync({ _id: main._id }, current) }
  }
  const scheduled = []
  const context = await functions(dataSettings, ['importFreeTubeSubscriptions'], {
    profileList: ref([main]), MAIN_PROFILE_ID: main._id, isJsonObject: value => value != null && typeof value === 'object' && !Array.isArray(value),
    t: key => key, showToast() {},
    DBLibraryHandlers: { query: async (method, options) => { await edit(); return operations[method](engine, options) } },
    store: { dispatch: async (action, profile) => {
      if (action === 'scheduleSyncServer') { scheduled.push(profile); return }
      if (action === 'grabAllProfiles') return true
      await engine.collections.profiles.updateAsync({ _id: profile._id }, profile, { upsert: true })
      if (profile._id !== main._id) await edit()
      return true
    } },
  })
  await context.importFreeTubeSubscriptions([incoming])
  assert.deepEqual(await engine.collections.profiles.findOneAsync({ _id: main._id }), { ...current, subscriptions: [...current.subscriptions, { id: 'imported-channel' }] })
  assert.deepEqual(await engine.collections.profiles.findOneAsync({ _id: incoming._id }), incoming)
  assert.deepEqual(scheduled, ['profilesOrSubscriptions'])
})

for (const method of ['persistPlaylistOrder', 'moveVideo']) {
  for (const changed of [false, true]) {
    test(`Watch ${method} schedules playlist sync after a committed change=${changed}`, async () => {
      const scheduled = []
      const write = Promise.withResolvers()
      const item = { videoId: 'video', playlistItemId: 'item', _libraryMemberId: 'member' }
      const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', [method], {
        selectedUserPlaylist: ref({ _id: 'playlist' }), isPagedPlaylist: ref(true), shuffleEnabled: ref(false),
        props: { playlistId: 'playlist' }, reversePlaylist: ref(false), playlistItems: ref([item]), userWindow: ref({ revision: 1 }),
        DBLibraryHandlers: { query: () => write.promise },
        store: { dispatch: async (action, reason) => { if (action === 'scheduleSyncServer') scheduled.push(reason) } },
        loadUserPlaylistWindow: async () => {}, showToast() {}, t: key => key,
      })
      const saving = method === 'moveVideo' ? context[method]('video', 'item', 1, 'member') : context[method]([item])
      assert.deepEqual(scheduled, [])
      write.resolve(changed)
      await saving
      assert.deepEqual(scheduled, changed ? ['playlists'] : [])
    })
  }
}

for (const method of ['persistPlaylistOrder', 'moveVideo']) {
  test(`Watch ${method} explains a rejected paged reorder and restores the durable window`, async () => {
    const toasts = []
    let reloads = 0
    const item = { videoId: 'video', playlistItemId: 'item', _libraryMemberId: 'member' }
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', [method], {
      selectedUserPlaylist: ref({ _id: 'playlist' }), isPagedPlaylist: ref(true), shuffleEnabled: ref(false),
      props: { playlistId: 'playlist' }, reversePlaylist: ref(false), playlistItems: ref([item]), userWindow: ref({ revision: 1 }),
      DBLibraryHandlers: { query: async () => { throw new Error('Stale playlist revision') } },
      loadUserPlaylistWindow: async () => { reloads++ }, showToast: toast => toasts.push(toast), t: key => key,
    })
    if (method === 'moveVideo') await context[method]('video', 'item', 1, 'member')
    else await context[method]([item])
    assert.equal(reloads, 1)
    assert.equal(toasts.length, 1)
    assert.match(toasts[0].message, /issue with updating this playlist/)
  })
}

for (const sort of ['video_duration_ascending', 'video_duration_descending']) {
  for (const action of ['exportAsYouTubeCsv', 'exportAsListOfUrls']) {
    test(`${action} uses full paged duration ordering ${sort} without persisting history fallback durations`, async t => {
      const db = new DatabaseSync(':memory:')
      db.exec(SCHEMA_SQL)
      t.after(() => db.close())
      const engine = new LibraryEngine(db)
      const videos = Array.from({ length: 302 }, (_, index) => ({ videoId: `video-${index}`, title: String(index).padStart(3, '0'), timeAdded: index, unknown: { index } }))
      await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Retained', videos })
      await engine.collections.history.insertAsync(videos.flatMap((video, index) => [
        { _id: `old-${index}`, videoId: video.videoId, timeWatched: 1, lengthSeconds: 10000 - index },
        { _id: `new-${index}`, videoId: video.videoId, timeWatched: 2, lengthSeconds: 302 - index },
      ]))
      const expected = (sort.endsWith('ascending') ? videos.toReversed() : videos).map(video => video.videoId)
      let exported, stale = false
      const calls = []
      const { script } = await source(playlistInfo)
      const names = script.includes('function orderedExportVideos(') ? ['orderedExportVideos', action] : [action]
      const context = await functions(playlistInfo, names, {
        props: { id: 'p', title: 'Retained' }, isUserPlaylist: ref(true), locale: ref('en-US'),
        store: { getters: { getUserPlaylistSortOrder: sort } }, getSortedPlaylistItems,
        DBLibraryHandlers: { query: async (method, options) => {
          calls.push({ method, options })
          if (method === 'playlistPage' && options.cursor && !stale) { stale = true; return { stale: true } }
          return engine[method](options)
        } },
        getExportFilename: () => 'retained', t: key => key, showToast: toast => assert.fail(toast.message),
        writeFileWithPicker: async (_name, value) => { exported = value; return false },
      })
      await context[action]()
      const ids = action === 'exportAsYouTubeCsv' ? exported.split('\n').slice(1).filter(Boolean).map(row => row.split(',')[0]) : exported.trim().split('\n').map(url => new URL(url).searchParams.get('v'))
      assert.deepEqual(ids, expected)
      assert.ok(calls.every(call => call.method === 'playlistPage' && call.options.limit <= 250))
      assert.ok(stale, 'discard a stale partial export and restart from the first page')
      assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos, videos)
    })
  }
}

for (const collection of ['watchStats', 'sessionsV2']) {
  for (const transition of ['before durable write', 'before renderer acknowledgement']) {
    test(`${collection} snapshot save rejects account changes ${transition}`, async t => {
      const db = new DatabaseSync(':memory:')
      db.exec(SCHEMA_SQL)
      t.after(() => db.close())
      const engine = new LibraryEngine(db)
      const settings = { syncServerEnabled: true, syncServerUrl: 'server', syncServerToken: 'token', syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '', syncServerPrivacySalt: '', syncServerSyncWatchStats: true, syncServerSnapshot: '{}' }
      await engine.collections.settings.insertAsync(Object.entries(settings).map(([_id, value]) => ({ _id, value })))
      const original = { ...settings }
      const replacement = JSON.stringify({ history: { retained: true }, [collection]: [{ account: 'replacement' }] })
      const entered = Promise.withResolvers(), resume = Promise.withResolvers()
      const commits = []
      class Cancelled extends Error {}
      const context = await functions('src/renderer/store/modules/sync-server.js', ['saveSnapshotSection'], {
        SyncServerCancelledError: Cancelled,
        DBLibraryHandlers: { query: async (method, options) => {
          assert.equal(method, 'syncSnapshotSection')
          let result
          if (transition === 'before renderer acknowledgement') result = await operations[method](engine, options)
          entered.resolve()
          await resume.promise
          return result ?? operations[method](engine, options)
        } },
      })
      const task = context.saveSnapshotSection({ rootState: { settings }, commit: (...args) => commits.push(args), dispatch() { assert.fail('desktop writes must be account-checked by the owner') } }, original, collection, [{ account: 'old' }])
      const rejected = assert.rejects(task, Cancelled)
      await entered.promise
      await engine.collections.settings.updateAsync({ _id: 'syncServerToken' }, { $set: { value: 'replacement' } })
      await engine.collections.settings.updateAsync({ _id: 'syncServerSnapshot' }, { $set: { value: replacement } })
      if (transition === 'before renderer acknowledgement') {
        settings.syncServerToken = 'replacement'
        settings.syncServerSnapshot = replacement
      }
      resume.resolve()
      await rejected
      assert.deepEqual(commits, [])
      assert.equal(await operations.syncSnapshotRead(engine), replacement)
    })
  }
}

for (const sort of ['date_added_descending', 'video_title_ascending']) {
  test(`ordinary portable playlist sort ${sort} refreshes only statistics after progress`, async t => {
    const db = { history: new Datastore({ inMemoryOnly: true }), playlists: new Datastore({ inMemoryOnly: true }) }
    const videos = Array.from({ length: 600 }, (_, index) => ({ videoId: `v${index}`, title: `Title ${index}`, unknown: new Date(index) }))
    const playlist = { _id: 'playlist', playlistName: 'Retained', lastUpdatedAt: 1, videos }
    await db.playlists.insertAsync(playlist)
    const { createPortableLibrary } = await import('../../src/datastores/handlers/library-web.js')
    const portable = createPortableLibrary({ history: { find: () => db.history.findAsync({}) }, playlists: { find: () => db.playlists.findAsync({}) } })
    const requested = [], state = reactive({ history: { historyRevision: 0 } })
    const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['parseUserPlaylist', 'refreshUserPlaylistStatistics'], {
      userStatisticsGeneration: 0, SORT_BY_VALUES: { VideoDurationAscending: 'video_duration_ascending', VideoDurationDescending: 'video_duration_descending' }, userPageGeneration: 0, userPageRevision: 0, playlistId: vueRef('playlist'),
      userPlaylistPreloadIds: ref(null), SORT_BY_VALUES: { VideoDurationAscending: 'video_duration_ascending', VideoDurationDescending: 'video_duration_descending' },
      sortOrder: vueRef(sort), processedVideoSearchQuery: vueRef(''), locale: vueRef('en-US'),
      selectedUserPlaylist: vueRef(playlist), isUserPlaylistRequested: vueRef(true), store: { state }, watch,
      userPageOptions: cursor => ({ id: 'playlist', sort, cursor }), userPageCursor: vueRef(null), userStatistics: vueRef({}),
      playlistTitle: ref(''), playlistDescription: ref(''), firstVideoId: ref(''), firstVideoPlaylistItemId: ref(''),
      lastUpdatedDate: ref(null), viewCount: ref(0), channelName: ref(''), channelThumbnail: ref(''), channelId: ref(''),
      infoSource: ref('user'), playlistItems: vueRef([]), userPlaylistVisibleLimit: ref(0),
      playlistError: ref(''), nextPageError: ref(''), playlistErrorRetryable: ref(false), isLoading: ref(true), isLoadingMore: ref(false),
      updateLastUpdatedDate() {}, updatePageTitle() {}, clampPlaylistScroll() {}, t: key => key,
      DBLibraryHandlers: { query: async (method, options) => { requested.push(method); return portable.query(method, options) } },
    })
    const { script, ast } = await source('src/renderer/views/Playlist/Playlist.vue')
    const registration = matching(ast, node => node.type === 'CallExpression' && node.callee.name === 'watch' && node.arguments[0]?.type === 'ArrayExpression' && script.slice(node.arguments[0].start, node.arguments[0].end).includes('processedVideoSearchQuery')).at(0)
    t.after(vm.runInContext(script.slice(registration.start, registration.end), context))
    await context.parseUserPlaylist(playlist, 600)
    const retained = context.playlistItems.value
    assert.equal(retained.length, 600)
    requested.length = 0
    await db.history.insertAsync({ _id: 'h', videoId: 'v599', timeWatched: 1, lengthSeconds: 120, watchProgress: 1 })
    state.history.historyRevision++
    await nextTick(); await setImmediate()
    assert.deepEqual(requested, ['playlistStatistics'], 'progress must not serialize/hash and re-page the entire portable membership')
    assert.equal(context.playlistItems.value, retained)
    assert.equal(context.userStatistics.value.duration, 120)
    assert.deepEqual((await db.playlists.findOneAsync({ _id: 'playlist' })).videos, videos)
  })
}

for (const captureFails of [false, true]) {
  test(`desktop mark-all captures complete feed identities before animation with capture failure ${captureFails}`, async t => {
    const database = new DatabaseSync(':memory:'); database.exec(SCHEMA_SQL); t.after(() => database.close())
    const engine = new LibraryEngine(database), events = [], marks = [], toasts = []
    const entries = [{ videoId: 'shown', isNewInSubscriptionFeed: true, unknown: new Date(1) }, { videoId: 'members', isMembersOnly: true, isNewInSubscriptionFeed: true }]
    await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: entries, videosTimestamp: new Date(1000) })
    const before = await engine.collections.subscriptionCache.findAsync({})
    const DBLibraryHandlers = { query: async (method, options) => {
      assert.equal(method, 'markSubscriptionEntries')
      events.push(options.capture ? 'capture' : 'mark')
      if (options.capture && captureFails) throw new Error('capture unavailable')
      return engine.transaction(() => markSubscriptionEntries(engine, structuredClone(options), { settings: { mergeSeenVideos: async ({ videos }) => { marks.push(...videos); return 'saved' } } }))
    } }
    const action = (await functions('src/renderer/store/modules/subscription-cache.js', ['markSubscriptionEntriesAsSeen'], { DBLibraryHandlers, toDate: value => new Date(value) })).markSubscriptionEntriesAsSeen
    const markingSeenTab = vueRef(null), state = { libraryPaged: true, videoCache: { channel: { videos: [], timestamp: new Date(1000) } } }
    const store = { getters: { getVideoCache: state.videoCache }, dispatch: async (name, payload) => {
      if (name === 'markSubscriptionEntriesAsSeen') return action({ state, commit() {}, dispatch: async () => {} }, payload)
      assert.fail(name)
    } }
    const context = await functions('src/renderer/views/Subscriptions/Subscriptions.vue', ['markAllAsSeen'], {
      store, DBLibraryHandlers, isElectron: true, markingSeenTab, newFeedView: ref('combined'), visibleTabs: ref(['videos']), activeSubscriptions: ref([{ id: 'channel' }]),
      getSubscriptionsForFeed: subscriptions => subscriptions, isMounted: true, currentTab: ref('new'), usesLogicalTabs: false, window: { scrollY: 0 }, resetNewFeedScroll: async () => {},
      newPanel: ref({ markAllAsSeen: async markSeen => {
        events.push('animation')
        await engine.collections.subscriptionCache.updateAsync({ _id: 'channel' }, { $set: { videos: [{ videoId: 'arrived', isNewInSubscriptionFeed: true }, entries[0], { ...entries[1], isMembersOnly: false }] } })
        await markSeen()
      } }),
      showToast: message => toasts.push(message), t: key => key,
    })
    await context.markAllAsSeen('new', 'videos')
    assert.equal(markingSeenTab.value, null)
    assert.deepEqual(events, captureFails ? ['capture'] : ['capture', 'animation', 'mark'])
    if (captureFails) {
      assert.deepEqual(await engine.collections.subscriptionCache.findAsync({}), before)
      assert.deepEqual(marks, []); assert.deepEqual(toasts, ['Storage Startup Error.Title'])
    } else {
      assert.deepEqual(marks, [{ videoId: 'shown', isMembersOnly: false }])
      assert.deepEqual((await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videos, [{ videoId: 'arrived', isNewInSubscriptionFeed: true }, { ...entries[0], isNewInSubscriptionFeed: false }, { ...entries[1], isMembersOnly: false }])
      assert.deepEqual(toasts, [])
    }
  })
}

for (const outcome of ['pending', 'failed', 'changed profile']) {
  test(`New feed removal waits for current replacement pages with ${outcome} refresh`, async () => {
    let release
    const waiting = new Promise(resolve => { release = resolve }), clearingVisibleContent = vueRef(false), records = vueRef([{ videoId: 'dismissed' }])
    const failed = vueRef(false), profile = { _id: 'original' }, loads = []
    const context = await functions('src/renderer/components/SubscriptionsNew.vue', ['markAllAsSeen'], {
      store: { getters: { getActiveProfile: profile } }, props: { activeCategory: 'videos' }, isElectron: true,
      feed: ref(null), clearingVisibleContent, isReducedMotionEnabled: () => true, nextTick,
      cancelRemovalAnimation() { clearingVisibleContent.value = false },
      pagedFeeds: { videos: { records, failed, load: async () => {
        loads.push('videos'); await waiting
        if (outcome === 'failed') { failed.value = true; throw new Error('replacement unavailable') }
        records.value = [{ videoId: 'arrived' }]
      } } },
    })
    let saved = false
    const request = context.markAllAsSeen(async () => { saved = true; if (outcome === 'changed profile') profile._id = 'new' })
    await nextTick(); await setImmediate()
    assert.equal(saved, true)
    if (outcome === 'changed profile') {
      await request; assert.deepEqual(loads, []); assert.deepEqual(records.value, [{ videoId: 'dismissed' }])
    } else {
      assert.equal(clearingVisibleContent.value, true, 'old SQLite cards must stay disposed while their replacement query is pending')
      release(); await request
      assert.deepEqual(loads, ['videos'])
      assert.deepEqual(Array.from(records.value, record => ({ ...record })), outcome === 'failed' ? [] : [{ videoId: 'arrived' }])
      assert.equal(failed.value, outcome === 'failed')
    }
    assert.equal(clearingVisibleContent.value, false)
  })
}

for (const failure of ['none', 'remove', 'grabAllPlaylists', 'grabHistory']) {
  test(`desktop removal reports the durable result when ${failure} fails`, async () => {
    const calls = []
    const { script, ast } = await source('src/renderer/store/modules/playlists.js')
    const action = matching(ast, node => node.type === 'ObjectMethod' && node.key?.name === 'removeVideo' && node.async)[0]
    const removeVideo = vm.runInNewContext(`(async function(${action.params.map(param => script.slice(param.start, param.end)).join(',')})${script.slice(action.body.start, action.body.end)})`, {
      console: { error() {} },
      DBLibraryHandlers: { query: async () => { if (failure === 'remove') throw new Error('write failed'); return true } },
    })
    const result = await removeVideo({ state: { libraryPaged: true }, dispatch: async action => {
      calls.push(action)
      if (action === failure) throw new Error('refresh failed')
    } }, { _id: 'playlist', memberId: 'member' })
    assert.equal(result, failure !== 'remove')
    if (failure !== 'remove') assert.ok(calls.includes('grabHistory'))
  })
}

test('an in-place playlist window reload leaves its existing cards mounted', async () => {
  let finish
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], {
    userWindowGeneration: 0, userWindowReady: ref(true), userWindowOwner: ref('owner'), userWindowKey: () => 'owner',
    isLoading: ref(false), userWindow: ref({ index: 0 }), prevVideoBeforeDeletion: ref(null), playlistItems: ref([{ videoId: 'existing' }]),
    userPlaylistWindowOptions: offset => ({ offset }), DBLibraryHandlers: { query: () => new Promise(resolve => { finish = resolve }) },
  })
  const pending = context.loadUserPlaylistWindow(100)
  assert.equal(context.isLoading.value, false)
  assert.equal(context.userWindowReady.value, false)
  assert.equal(context.playlistItems.value[0].videoId, 'existing')
  finish({ index: 100, records: [{ videoId: 'next' }] })
  await pending
  assert.equal(context.isLoading.value, false)
  assert.equal(context.userWindowReady.value, true)
})

test('repeated thumbnail visibility callbacks retain a loaded image and do not reread its blob', async () => {
  const { script, ast } = await source('src/renderer/components/WatchVideoMetadataHistory/WatchMetadataThumbnail.vue')
  const program = ast.program.body.filter(node => node.type !== 'ImportDeclaration').map(node => script.slice(node.start, node.end)).join('\n')
  let intersect, resolve, mounted, reads = 0
  const context = vm.createContext({
    defineProps: () => ({ revisionId: 'revision', fallbackUrl: null }), useTemplateRef: () => ref({}), ref,
    watch() {}, onMounted: fn => { mounted = fn }, onBeforeUnmount() {}, console: { error() {} },
    IntersectionObserver: class { constructor(callback) { intersect = callback } observe() {} disconnect() {} },
    DBLibraryHandlers: { query: () => { reads++; return new Promise(done => { resolve = done }) } },
  })
  vm.runInContext(program + '\nglobalThis.state = { source, busy }', context)
  mounted()
  intersect([{ isIntersecting: true }])
  intersect([{ isIntersecting: true }])
  assert.equal(reads, 1)
  resolve('thumbnail')
  await setImmediate()
  intersect([{ isIntersecting: true }])
  assert.equal(context.state.source.value, 'thumbnail')
  assert.equal(reads, 1)
  intersect([{ isIntersecting: false }])
  assert.equal(context.state.source.value, null)
  intersect([{ isIntersecting: true }])
  assert.equal(reads, 2)
  resolve('thumbnail')
  await setImmediate()
})

test('library IPC checks the sender before rejecting malformed query payloads', async () => {
  const { script, ast } = await source('src/main/index.js')
  const node = matching(ast, node => node.type === 'CallExpression' && node.callee.object?.name === 'ipcMain' && node.arguments[0]?.property?.name === 'LIBRARY_QUERY')[0].arguments[1]
  let checked = 0
  const request = vm.runInNewContext(`(${script.slice(node.start, node.end)})`, { isOpenTubeXUrl: url => { checked++; return url === 'trusted' } })
  for (const payload of [undefined, null, 'query', []]) {
    assert.equal(await request({ senderFrame: { url: 'untrusted' } }, payload), undefined)
    await assert.rejects(request({ senderFrame: { url: 'trusted' } }, payload), /Invalid library query payload/)
  }
  assert.equal(checked, 8)
})

for (const videos of [undefined, null, false, 'retained', { unknown: true }, [null], [false], [new Date(1)], [[]]]) {
  test(`portable backup rejects unreadable playlist shapes before any selected write: ${JSON.stringify(videos)}`, async () => {
    let writes = 0
    const toasts = []
    const data = { profiles: [{ _id: 'profile' }], playlists: [{ _id: 'playlist', ...(videos === undefined ? {} : { videos }) }] }
    const before = structuredClone(data)
    const context = await functions(dataSettings, ['importUnifiedBackup'], {
      process: { env: { IS_ELECTRON: false } }, Date, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
      backupBusy: ref(false), selectedBackupSections: ref(['profiles', 'playlists', 'history']), backupData: ref(data),
      DBProfileHandlers: { find: async () => { writes++; throw new Error('preflight did not stop profile writes') } },
      showToast: toast => toasts.push(toast), t: key => key,
    })
    await context.importUnifiedBackup()
    assert.equal(writes, 0)
    assert.deepEqual(data, before)
    assert.match(toasts.at(-1).message, /Import Failed.*Invalid backup playlists/)
    assert.equal(context.backupBusy.value, false)
  })
}

test('portable backup can restore supported selected sections while retaining an unselected opaque playlist', async () => {
  const { mergeBackupProfile } = await import('../../src/renderer/helpers/unifiedBackup.js')
  const profile = { _id: 'profile', name: 'Imported', subscriptions: [] }
  const data = { profiles: [profile], playlists: [{ _id: 'playlist', videos: null }], history: [{ _id: 'legacy', timeWatched: 1, unknown: { keep: true } }] }
  const before = structuredClone(data), saved = [], messages = []
  const context = await functions(dataSettings, ['importUnifiedBackup'], {
    process: { env: { IS_ELECTRON: false } }, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
    backupBusy: ref(false), selectedBackupSections: ref(['profiles']), backupData: ref(data), mergeBackupProfile,
    DBProfileHandlers: { find: async () => [], upsert: async record => saved.push(record) }, store: { dispatch: async () => {} },
    compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => messages.push(toast),
  })
  await context.importUnifiedBackup()
  assert.deepEqual(saved, [profile])
  assert.deepEqual(data, before)
  assert.match(messages.at(-1).message, /Backup imported/)
})

test('a paged playlist summary download reads all 20000 members before submitting IDs', async t => {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
  t.after(() => database.close())
  const engine = new LibraryEngine(database)
  const playlist = { _id: 'saved', playlistName: 'Saved', unknown: { retained: new Date(1) }, videos: [null, false, 42, 'retained', ['opaque'], {}, { videoId: null }, { videoId: 42 }, { videoId: '' }, ...Array.from({ length: 20000 }, (_, index) => ({ videoId: `v${String(index).padStart(10, '0')}`, playlistItemId: 'duplicate-item', unknown: index }))] }
  await engine.collections.playlists.insertAsync(playlist)
  let requested
  const context = await functions('src/renderer/components/WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue', ['startDownload'], {
    props: { userPlaylistId: playlist._id, videoIds: [], videoId: '', playlistId: '', playlistKey: playlist._id, isPlaylist: true, title: playlist.playlistName },
    DBLibraryHandlers: { query: async (method, options) => { assert.equal(method, 'playlistVideoIds'); return structuredClone(operations.playlistVideoIds(engine, options)) } },
    ytDlp: { ytDlpDownload: async data => { requested = structuredClone(data); return { id: 'download' } } },
    normalizeOptions: () => ({}), options: {}, isDirty: ref(false), selectedTemplate: ref(''), downloadId: ref(null), showToast() {}, t: key => key,
  })
  await context.startDownload()
  assert.deepEqual(requested.videoIds, Array.from({ length: 20000 }, (_, index) => `v${String(index).padStart(10, '0')}`))
  assert.equal(context.downloadId.value, 'download')
  assert.deepEqual(await engine.playlistSnapshot({ id: playlist._id }), playlist)
})


test('Home uses placeholders for opaque playlist first members without reading history or changing data', async () => {
  const file = 'src/renderer/views/Home/Home.vue'
  const { script, ast } = await source(file)
  const count = matching(ast, node => node.type === 'VariableDeclarator' && node.id.name === 'playlistVideoCount')[0].init
  const playlistVideoCount = vm.runInNewContext(`(${script.slice(count.start, count.end)})`, { store: { state: { playlists: { libraryPaged: true } } } })
  let reads = 0
  const context = await functions(file, ['videoThumbnail', 'playlistThumbnail'], {
    playlistVideoCount, thumbnailPlaceholder: 'placeholder', thumbnailPreference: ref('visible'), thumbnailOrigin: ref('origin'),
    store: { getters: { getHistoryCacheById: new Proxy({}, { get() { reads++; return undefined } }) } },
  })
  for (const firstVideo of [undefined, null, false, 42, 'opaque', [], {}, { videoId: null }, { videoId: 42 }, { videoId: '' }]) {
    for (const playlist of [{ videoCount: 2, firstVideo, videos: [] }, { videos: [firstVideo] }]) {
      const before = structuredClone(playlist)
      assert.equal(context.playlistThumbnail(playlist), 'placeholder')
      assert.deepEqual(playlist, before)
    }
  }
  for (const videos of [undefined, null, false, 42, 'retained', {}]) {
    assert.equal(context.playlistThumbnail({ videos }), 'placeholder')
  }
  assert.equal(reads, 0)
  assert.equal(context.playlistThumbnail({ videoCount: 1, firstVideo: { videoId: 'valid' }, videos: [] }), 'origin/vi/valid/maxresdefault.jpg')
  assert.equal(reads, 1)
})

test('Save thumbnails skip opaque first members and retain every playlist shape', async () => {
  let requests = 0
  const context = await functions('src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue', ['playlistVideoCount', 'playlistThumbnail'], {
    thumbnailPlaceholder: 'placeholder', getVideoThumbnailUrl() { requests++; return 'valid-thumbnail' },
    store: { getters: { getBackendPreference: 'local', getCurrentInvidiousInstanceUrl: 'instance' } },
  })
  for (const firstVideo of [undefined, null, false, 42, 'opaque', [], {}, { videoId: null }, { videoId: 42 }, { videoId: '' }]) {
    const playlist = { videoCount: 2, firstVideo, videos: [] }, before = structuredClone(playlist)
    assert.equal(context.playlistThumbnail(playlist), 'placeholder')
    assert.deepEqual(playlist, before)
  }
  for (const videos of [undefined, null, false, 42, 'retained', {}]) assert.equal(context.playlistThumbnail({ videos }), 'placeholder')
  assert.equal(requests, 0)
  assert.equal(context.playlistThumbnail({ videoCount: 1, firstVideo: { videoId: 'valid' }, videos: [] }), 'valid-thumbnail')
  assert.equal(requests, 1)
})

test('portable Save membership skips opaque members without changing retained playlists', async () => {
  const { script, ast } = await source('src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue')
  const initializer = matching(ast, node => node.type === 'VariableDeclarator' && node.id.name === 'containedIds')[0].init
  const playlists = [
    { _id: 'retained', videos: [null, false, 42, 'opaque', [], {}, { videoId: 'same' }] },
    ...[undefined, null, false, 42, 'retained', {}].map((videos, index) => ({ _id: `scalar-${index}`, videos })),
  ]
  const before = structuredClone(playlists)
  const result = vm.runInNewContext(script.slice(initializer.start, initializer.end), {
    computed: callback => callback(), props: { videoData: { videoId: 'same' } },
    allPlaylists: ref(playlists), store: { state: { playlists: { libraryPaged: false } } },
  })
  assert.deepEqual([...result], ['retained'])
  assert.deepEqual(playlists, before)
})

for (const importer of ['importFreeTubeWatchHistory', 'importLibreTubeWatchHistory', 'importYouTubeWatchHistory']) {
  test(`portable ${importer} retains every pre-existing duplicate and its newest progress`, async () => {
    const db = new Datastore({ inMemoryOnly: true })
    const original = [
      { _id: 'newest', videoId: 'same', title: 'Newest', author: 'Author', authorId: 'channel', type: 'video', lengthSeconds: 120, published: 20, timeWatched: 20, watchProgress: 97, isWatched: false, isLive: false, unknown: new Date(2) },
      { _id: 'older', videoId: 'same', title: 'Older', author: 'Author', authorId: 'channel', type: 'video', lengthSeconds: 120, published: 10, timeWatched: 10, watchProgress: 1, isWatched: true, isLive: false, unknown: new Date(1) },
    ]
    await db.insertAsync(original)
    const { mergeBackupHistory } = await import('../../src/renderer/helpers/unifiedBackup.js')
    const libre = await functions('src/renderer/helpers/libretube.js', ['isObject', 'toFiniteNumber', 'extractChannelIdFromUploaderUrl', 'convertLibreTubeWatchHistoryToOpenTubeX'], { YOUTUBE_CHANNEL_ID_LENGTH: 24 })
    const messages = []
    const context = await functions(dataSettings, [importer], {
      process: { env: { IS_ELECTRON: false } }, mergeBackupHistory,
      convertLibreTubeWatchHistoryToOpenTubeX: libre.convertLibreTubeWatchHistoryToOpenTubeX,
      isJsonObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
      DBHistoryHandlers: { find: () => db.findAsync({}).sort({ timeWatched: -1, _id: -1 }) },
      store: { dispatch: async (action, records) => {
        assert.equal(action, 'overwriteHistory')
        const values = records instanceof Map ? [...records.values()] : Object.prototype.toString.call(records) === '[object Map]' ? [...records.values()] : records
        await db.removeAsync({}, { multi: true })
        await db.insertAsync(values)
        return true
      } },
      showToast: toast => messages.push(toast), t: key => key,
    })
    const input = importer === 'importFreeTubeWatchHistory'
      ? [{ _id: 'imported', videoId: 'unrelated01', title: 'Imported', author: 'Source', authorId: 'channel', type: 'video', lengthSeconds: 120, published: 1, timeWatched: 1, watchProgress: 1, isLive: false }]
      : importer === 'importLibreTubeWatchHistory'
        ? { watchHistory: [{ videoId: 'unrelated01', title: 'Imported', uploader: 'Source', uploaderUrl: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', duration: 120 }] }
        : [{ products: ['YouTube'], title: 'Watched Imported', titleUrl: 'https://www.youtube.com/watch?v=unrelated01', time: '2024-01-01T00:00:00Z', subtitles: [{ name: 'Source', url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv' }] }]
    await context[importer](input)
    for (const record of original) assert.deepEqual(await db.findOneAsync({ _id: record._id }), record)
    assert.equal(await db.countAsync({}), 3)
    assert.equal((await db.findAsync({ videoId: 'same' }).sort({ timeWatched: -1 }))[0].watchProgress, 97)
    assert.match(messages.at(-1).message, /successfully imported/)
    context.store.dispatch = async () => false
    messages.length = 0
    await assert.rejects(context[importer](input), /Unable to import history/)
    assert.ok(messages.every(toast => !/successfully imported/.test(toast.message)))
    for (const record of original) assert.deepEqual(await db.findOneAsync({ _id: record._id }), record)
  })
}

for (const outcome of ['success', 'failure']) {
  test(`Watch ignores a saved window ${outcome} after switching to a remote playlist`, async () => {
    const pending = Promise.withResolvers(), toasts = []
    let owner = 'saved'
    const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], {
      userWindowGeneration: 0, userWindowKey: () => owner, userWindowReady: ref(true), userWindowOwner: ref('saved'),
      isLoading: ref(false), userWindow: ref({ index: 0, records: [] }), prevVideoBeforeDeletion: ref(null), playlistItems: ref([]),
      userPlaylistWindowOptions: () => ({ id: 'saved' }), DBLibraryHandlers: { query: () => pending.promise },
      t: key => key, showToast: toast => toasts.push(toast),
    })
    const loading = context.loadUserPlaylistWindow()
    owner = 'remote'
    const remote = [{ videoId: 'remote', title: 'Remote playlist member' }]
    context.playlistItems.value = remote
    context.userWindowOwner.value = null
    context.isLoading.value = true
    const before = structuredClone(context.userWindow.value)
    if (outcome === 'success') pending.resolve({ index: 0, records: [{ videoId: 'old-saved' }] })
    else pending.reject(new Error('stale saved window failed'))
    await loading
    assert.deepEqual(context.playlistItems.value, remote)
    assert.deepEqual(context.userWindow.value, before)
    assert.equal(context.userWindowOwner.value, null)
    assert.equal(context.userWindowReady.value, false)
    assert.equal(context.isLoading.value, true, 'the old request must not release the remote loader')
    assert.deepEqual(toasts, [])
  })
}

test('desktop ID-less legacy playlist imports merge repeatedly into editable summaries without copying members', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-idless-playlist-'))
  const database = new DatabaseSync(join(directory, 'library.sqlite'))
  database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
  const engine = new LibraryEngine(database), imports = new LibraryImports(engine)
  t.after(async () => {
    for (const id of imports.jobs.keys()) imports.cancel({ id })
    database.close()
    await rm(directory, { recursive: true, force: true })
  })
  const member = { videoId: 'kept', title: 'Kept', lengthSeconds: 10, timeAdded: 1, unknown: new Date(1) }
  const current = { _id: 'zzz-editable', playlistName: 'Older export', description: 'Retained description', createdAt: 7, lastUpdatedAt: 8, protected: false, videos: [member, { ...member, timeAdded: 2 }], unknown: new Date(2) }
  const readonly = [{ ...current, _id: 'favorites' }, { ...current, _id: 'a-protected', protected: true }]
  await engine.collections.playlists.insertAsync([...readonly, current])
  const incoming = [{ playlistName: current.playlistName, videos: [member, { videoId: 'added', title: 'Added', lengthSeconds: 20, timeAdded: 3 }] }]
  let summaries = 0, uuids = 0
  const context = await functions(dataSettings, ['importPlaylists'], {
    crypto: { randomUUID: () => `generated-${++uuids}` }, IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'downloads',
    readFileWithPicker: async () => ({ filename: 'pre-0.19.1.db', content: JSON.stringify(incoming) }),
    isJsonObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    DBPlaylistHandlers: { find() { assert.fail('desktop imports must not copy playlist members') } },
    DBLibraryHandlers: { query: async method => { assert.equal(method, 'playlistSummaries'); summaries++; return engine.playlistSummaries() } },
    importLibraryRecords: async (section, records) => {
      const job = imports.start({ format: 'records' })
      imports.chunk({ ...job, section, records })
      imports.finish(job)
      await imports.apply({ ...job, sections: [section] }, {})
    },
    t: key => key, showToast() {},
  })
  let saved
  for (let iteration = 0; iteration < 2; iteration++) {
    await context.importPlaylists()
    assert.equal(await engine.collections.playlists.countAsync({}), 3)
    saved = await engine.playlistSnapshot({ id: current._id })
    const appended = saved.videos[2]
    assert.equal(typeof appended.playlistItemId, 'string')
    assert.deepEqual(appended, { ...incoming[0].videos[1], playlistItemId: appended.playlistItemId })
    assert.deepEqual(saved, { ...current, lastUpdatedAt: saved.lastUpdatedAt, videos: [...current.videos, appended] })
    for (const playlist of readonly) assert.deepEqual(await engine.playlistSnapshot({ id: playlist._id }), playlist)
  }
  assert.equal(summaries, 2)
  assert.equal(uuids, 0)
  const unmatched = { playlistName: 'New legacy playlist', videos: [incoming[0].videos[1]] }
  context.readFileWithPicker = async () => ({ filename: 'pre-0.19.1.db', content: JSON.stringify([unmatched]) })
  await context.importPlaylists()
  const created = await engine.playlistSnapshot({ id: 'generated-1' })
  assert.ok(Number.isSafeInteger(created.createdAt) && created.createdAt > 0)
  assert.equal(created.lastUpdatedAt, created.createdAt)
  assert.deepEqual(created, { ...unmatched, _id: 'generated-1', createdAt: created.createdAt, lastUpdatedAt: created.lastUpdatedAt, protected: false, videos: [{ ...unmatched.videos[0], playlistItemId: created.videos[0].playlistItemId }] })
})

for (const sort of ['video_title_descending', 'video_duration_descending']) {
  test(`portable export uses every cached member without paged library reads: ${sort}`, async () => {
    const videos = Array.from({ length: 10000 }, (_, index) => ({ videoId: `v${index}`, title: `Title ${String(index).padStart(5, '0')}`, lengthSeconds: index % 2 === 0 ? 10 : null, unknown: new Date(index) }))
    const original = structuredClone(videos)
    const history = Object.fromEntries(videos.map((video, index) => [video.videoId, { lengthSeconds: index + 1 }]))
    const context = await functions(playlistInfo, ['orderedExportVideos'], {
      process: { env: { IS_ELECTRON: false } }, props: { id: 'p', sortedVideos: videos.slice(0, 250) },
      isUserPlaylist: ref(true), selectedUserPlaylist: ref({ _id: 'p', videos }), locale: ref('en-US'),
      store: { getters: { getUserPlaylistSortOrder: sort, getHistoryCacheById: history } }, getSortedPlaylistItems,
      DBLibraryHandlers: { query() { assert.fail('portable export must not repeatedly reread or hash the library') } },
    })
    const expected = videos.map(video => ({ ...video, ...(sort.startsWith('video_duration_') && !(Number.isFinite(video.lengthSeconds) && video.lengthSeconds > 0) ? { lengthSeconds: history[video.videoId].lengthSeconds } : {}) }))
    assert.deepEqual(structuredClone(await context.orderedExportVideos()), getSortedPlaylistItems(expected, sort, 'en-US'))
    assert.deepEqual(videos, original)
  })
}


test('paged Home shelves retain the first visible item across column changes and clamp shortened data', async () => {
  const { script, ast } = await source('src/renderer/views/Home/HomeShelf.vue')
  const node = matching(ast, node => node.type === 'CallExpression' && node.callee.name === 'watch')[0]
  const pageIndex = ref(49), props = { items: Array(100) }, pageCount = ref(200)
  let update
  vm.runInNewContext(script.slice(node.start, node.end), { watch: (_sources, callback) => { update = callback }, pageIndex, props, pageCount, layout: { value: { pageSize: 6 } } })
  update([200, 6, props.items], [200, 2, props.items])
  assert.equal(pageIndex.value, 16)
  props.items = Array(10)
  update([200, 6, props.items], [200, 6, Array(100)])
  assert.equal(pageIndex.value, 1)
})


for (const afterRead of [false, true]) {
  test(`portable restore preserves concurrent additions after preflight, after read: ${afterRead}`, async () => {
    const { mergeBackupPlaylist } = await import('../../src/renderer/helpers/unifiedBackup.js')
    const db = { playlists: new Datastore({ inMemoryOnly: true }) }
    const original = { _id: 'p', playlistName: 'Original', videos: [{ videoId: 'A' }], unknown: new Date(1) }
    const incoming = { _id: 'p', playlistName: 'Import', videos: [{ videoId: 'B' }] }
    await db.playlists.insertAsync(original)
    const base = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const Playlists = vm.runInNewContext(base.slice(base.indexOf('class Playlists {'), base.indexOf('class SearchHistory {')) + '\nPlaylists', { db, model })
    const concurrent = { videoId: 'concurrent' }
    const add = () => db.playlists.updateAsync({ _id: 'p' }, { $push: { videos: concurrent } })
    if (afterRead && Playlists.replaceIfUnchanged) {
      const replace = Playlists.replaceIfUnchanged.bind(Playlists)
      Playlists.replaceIfUnchanged = async (...args) => { await add(); return replace(...args) }
    }
    const messages = []
    const context = await functions(dataSettings, ['importUnifiedBackup'], {
      process: { env: { IS_ELECTRON: false } }, Date, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
      backupBusy: ref(false), selectedBackupSections: ref(['profiles', 'playlists']), backupData: ref({ profiles: [{ _id: 'profile', name: 'Profile', subscriptions: [] }], playlists: [incoming] }),
      DBPlaylistHandlers: Playlists, DBProfileHandlers: { find: async () => [], upsert: async () => { if (!afterRead) await add() } },
      mergeBackupPlaylist, mergeBackupProfile: (_previous, profile) => profile,
      store: { dispatch: async (method, value) => { if (method === 'updatePlaylist') { if (afterRead) await add(); await db.playlists.updateAsync({ _id: value._id }, value); return true } } },
      compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => messages.push(toast),
    })
    await context.importUnifiedBackup()
    const saved = await db.playlists.findOneAsync({ _id: 'p' })
    assert.deepEqual(saved.videos, afterRead ? [original.videos[0], concurrent] : [original.videos[0], concurrent, incoming.videos[0]])
    assert.deepEqual(saved.unknown, original.unknown)
    assert.match(messages.at(-1).message, afterRead ? /Import Failed/ : /Backup imported/)
  })
}

test('Copy and text exports omit opaque members while retaining the complete playlist snapshot', async () => {
  const videos = [null, false, {}, { videoId: 42 }, { videoId: '' }, { videoId: 'A', unknown: new Date(1) }]
  const snapshot = { _id: 'p', videos }, before = structuredClone(snapshot)
  let copied
  const context = await functions(playlistInfo, ['toggleCopyVideosPrompt', 'orderedExportVideos'], {
    snapshotPending: ref(false), props: { id: 'p', title: 'Playlist', channelName: '', description: '' }, isUserPlaylist: ref(true), selectedUserPlaylist: ref(snapshot),
    DBLibraryHandlers: { query: async method => method === 'playlistPage' ? { records: videos, cursor: null } : snapshot },
    store: { getters: { getUserPlaylistSortOrder: 'custom' }, dispatch: (_method, value) => { copied = value } }, locale: ref('en-US'),
    showToast() {}, t: key => key,
  })
  await context.toggleCopyVideosPrompt()
  assert.deepEqual(Array.from(copied.videos), [videos.at(-1)])
  assert.deepEqual(Array.from(await context.orderedExportVideos()), [videos.at(-1)])
  assert.deepEqual(snapshot, before)
})

test('linked playlist refresh skips null members and preserves scalar targets by rejecting writes', async () => {
  for (const videos of [[null, { videoId: 'A' }], null]) {
    const snapshot = { _id: 'p', videos }, before = structuredClone(snapshot), added = [], messages = []
    const context = await functions(playlistInfo, ['addMissingVideos'], {
      snapshotPending: ref(false), props: { id: 'p' }, selectedUserPlaylist: ref({ sourcePlaylistId: 'remote' }),
      loadSnapshot: async () => ({ videos: [{ videoId: 'A' }, { videoId: 'B' }] }), snapshotController: { signal: { aborted: false, throwIfAborted() {} } },
      DBLibraryHandlers: { query: async () => snapshot }, store: { dispatch: async (_method, value) => { added.push(value.videoData); return true } },
      showToast: toast => messages.push(toast), t: key => key,
    })
    await context.addMissingVideos()
    assert.deepEqual(structuredClone(added), Array.isArray(videos) ? [{ videoId: 'B' }] : [])
    assert.deepEqual(snapshot, before)
  }
})


for (const laterFailure of [false, true]) {
  test(`portable playlist restore schedules each durable write even after a later failure: ${laterFailure}`, async () => {
    const { mergeBackupPlaylist } = await import('../../src/renderer/helpers/unifiedBackup.js')
    const scheduled = [], writes = [], messages = []
    const context = await functions(dataSettings, ['importUnifiedBackup'], {
      process: { env: { IS_ELECTRON: false } }, Date, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
      backupBusy: ref(false), selectedBackupSections: ref(['playlists']), backupData: ref({ playlists: ['first', 'second'].map(_id => ({ _id, playlistName: _id, videos: [] })) }),
      DBPlaylistHandlers: { find: async () => [], replaceIfUnchanged: async (_previous, record) => {
        if (laterFailure && record._id === 'second') throw new Error('later write failed')
        writes.push(record._id); return { numAffected: 1 }
      } }, mergeBackupPlaylist,
      store: { dispatch: async method => { if (method === 'scheduleSyncServer') scheduled.push([...writes]) } },
      compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => messages.push(toast),
    })
    await context.importUnifiedBackup()
    assert.deepEqual(scheduled, laterFailure ? [['first']] : [['first'], ['first', 'second']])
    assert.match(messages.at(-1).message, laterFailure ? /Import Failed/ : /Backup imported/)
  })
}


test('Watch requests playable-only neighbors when moving its filtered desktop playlist', async () => {
  const calls = []
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['moveVideo'], {
    isPagedPlaylist: ref(true), shuffleEnabled: ref(false), playlistItems: ref([{ videoId: 'A', _libraryMemberId: 'member' }]),
    props: { playlistId: 'p' }, reversePlaylist: ref(false), userWindow: ref({ revision: 2 }),
    DBLibraryHandlers: { query: async (method, data) => { calls.push({ method, data: structuredClone(data) }); return true } },
    store: { dispatch: async () => true }, loadUserPlaylistWindow: async () => true, showToast() {}, t: key => key,
  })
  await context.moveVideo('A', undefined, 1, 'member')
  assert.deepEqual(calls, [{ method: 'movePlaylistMember', data: { id: 'p', memberId: 'member', direction: 1, revision: 2, playableOnly: true } }])
})


test('portable backup export completes its picked file after Data Settings closes', async () => {
  const { createUnifiedBackup, readUnifiedBackup } = await import('../../src/renderer/helpers/unifiedBackup.js')
  const db = new Datastore({ inMemoryOnly: true })
  const playlist = { _id: 'p', playlistName: 'Retained', videos: [{ videoId: 'A', unknown: new Date(2) }], unknown: new Date(1) }
  await db.insertAsync(playlist)
  const pending = Promise.withResolvers()
  let reading = false, written, opened = 0, closed = 0
  const writer = await functions('src/renderer/helpers/utils.js', ['writeFileWithPicker'], {
    process: { env: { IS_ELECTRON: false, IS_CAPACITOR: false } },
    window: { showSaveFilePicker: async () => ({ createWritable: async () => {
      opened++
      return { write: async data => { written = data; if (data === null) throw new Error('Invalid export content') }, close: async () => { closed++ } }
    } }) },
  })
  const toasts = []
  const context = await functions(dataSettings, ['exportUnifiedBackup', 'closeBackupImport', 'disposeBackupImport'], {
    process: { env: { IS_ELECTRON: false } },
    backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
    backupBusy: ref(false), selectedExportSections: ref(['playlists']), showBackupExport: ref(true),
    backupData: ref(null), showBackupImport: ref(false),
    getTodayDateStrLocalTimezone: () => '2026-10-13', START_IN_DIRECTORY: 'downloads',
    DBPlaylistHandlers: { find: async () => { reading = true; await pending.promise; return db.findAsync({}) } },
    createUnifiedBackup, promptAndWriteToFile: writer.writeFileWithPicker,
    t: key => key, showToast: toast => toasts.push(toast),
  })
  const exporting = context.exportUnifiedBackup()
  await setImmediate()
  assert.equal(reading, true)
  context.disposeBackupImport()
  assert.equal(context.backupBusy.value, true)
  pending.resolve()
  await exporting
  assert.ok(written instanceof Blob, 'a picked destination must receive the complete backup, never null')
  assert.deepEqual((await readUnifiedBackup(written)).data, { playlists: [playlist] })
  assert.equal(opened, 1)
  assert.equal(closed, 1)
  assert.equal(context.backupBusy.value, false)
  assert.deepEqual(toasts, [])
  assert.deepEqual(await db.findAsync({}), [playlist])
})


for (const fails of [false, true]) {
  test(`Save awaits membership before toggling a bookmark, lookup fails: ${fails}`, async () => {
    const db = new Datastore({ inMemoryOnly: true })
    const playlist = { _id: 'p', playlistName: 'Retained', videos: [{ videoId: 'same', unknown: new Date(1) }], unknown: new Date(2) }
    await db.insertAsync(playlist)
    const pending = Promise.withResolvers(), calls = [], toasts = [], containedIds = ref(new Set())
    const context = await functions('src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue', ['togglePlaylist'], {
      props: { videoData: { videoId: 'same' } }, containedIds, videoThumbnail: ref('thumbnail'),
      playlistDisplayName: playlist => playlist.playlistName, t: key => key, showToast: toast => toasts.push(toast),
      store: { state: { playlists: { libraryPaged: true } }, dispatch: async (action, payload) => {
        calls.push(action)
        if (action === 'hydrateVideoState') { await pending.promise; containedIds.value = new Set(['p']); return }
        if (action === 'removeVideo') await db.updateAsync({ _id: payload._id }, { $pull: { videos: { videoId: payload.videoId } } })
        if (action === 'addVideo') await db.updateAsync({ _id: payload._id }, { $push: { videos: payload.videoData } })
        return true
      } },
    })
    const toggling = context.togglePlaylist(playlist)
    await setImmediate()
    assert.deepEqual(calls, ['hydrateVideoState'])
    assert.deepEqual(await db.findOneAsync({ _id: 'p' }), playlist)
    if (fails) pending.reject(new Error('membership unavailable'))
    else pending.resolve()
    await toggling
    assert.deepEqual(calls, fails ? ['hydrateVideoState'] : ['hydrateVideoState', 'removeVideo'])
    assert.deepEqual(await db.findOneAsync({ _id: 'p' }), fails ? playlist : { ...playlist, videos: [] })
    assert.equal(toasts.length, 1)
  })
}


for (const format of ['array', 'ndjson']) {
  for (const race of ['picker', 'write']) {
    test(`portable legacy playlist ${format} import preserves concurrent ${race} edits`, async () => {
      const db = { playlists: new Datastore({ inMemoryOnly: true }) }
      const base = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
      const Playlists = vm.runInNewContext(base.slice(base.indexOf('class Playlists {'), base.indexOf('\nclass SearchHistory {')) + '\nPlaylists', { db, model })
      const member = id => ({ videoId: id, title: id, lengthSeconds: 60, timeAdded: 1, type: 'video', playlistItemId: id })
      const original = { _id: 'p', playlistName: 'Retained', description: 'Keep', lastUpdatedAt: 1, videos: [{ ...member('A'), unknown: new Date(123) }], unknown: new Date(456) }
      await db.playlists.insertAsync(original)
      const concurrent = { ...original, description: 'Concurrent edit', videos: [...original.videos, member('concurrent')] }
      const incoming = { _id: 'p', playlistName: 'Retained', videos: [member('B')] }
      let readFinished = false, savedBeforeWrite
      const replace = Playlists.replaceIfUnchanged.bind(Playlists)
      const DBPlaylistHandlers = {
        find: () => Playlists.find(),
        async replaceIfUnchanged(previous, next) {
          assert.equal(readFinished, true)
          if (race === 'write') await db.playlists.updateAsync({ _id: 'p' }, concurrent)
          savedBeforeWrite = await db.playlists.findOneAsync({ _id: 'p' })
          return replace(previous, next)
        },
      }
      const toasts = []
      const context = await functions('src/renderer/components/DataSettings/DataSettings.vue', ['importPlaylists', 'isJsonObject'], {
        process: { env: { IS_ELECTRON: false } }, IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'documents', DBPlaylistHandlers,
        readFileWithPicker: async () => {
          if (race === 'picker') await db.playlists.updateAsync({ _id: 'p' }, concurrent)
          readFinished = true
          return { filename: 'backup.db', content: format === 'array' ? JSON.stringify([incoming]) : JSON.stringify(incoming) + '\n' }
        },
        parseImportedLineDelimitedJson: value => value.trim().split('\n').map(line => JSON.parse(line)),
        processToBeAddedPlaylistVideo, deepCopy: structuredClone, structuredClone,
        showToast: toast => toasts.push(toast), t: key => key,
        store: { commit() {}, dispatch: async (action, payload) => {
          if (action === 'updatePlaylist') await Playlists.upsert(payload)
          else assert.ok(['grabAllPlaylists', 'scheduleSyncServer'].includes(action), action)
        } },
      })
      if (race === 'write') {
        await assert.rejects(context.importPlaylists(), /playlist changed/i)
        assert.deepEqual(await db.playlists.findOneAsync({ _id: 'p' }), savedBeforeWrite)
        assert.ok(toasts.every(toast => !toast.message.includes('successfully imported')))
      } else {
        await context.importPlaylists()
        const saved = await db.playlists.findOneAsync({ _id: 'p' })
        assert.deepEqual(saved, { ...concurrent, videos: [...concurrent.videos, incoming.videos[0]], lastUpdatedAt: saved.lastUpdatedAt })
        assert.ok(toasts.some(toast => toast.message.includes('successfully imported')))
      }
    })
  }
}


for (const subscriptions of [undefined, null, false, 42, 'retained', {}, new Date(123)]) {
  test(`Watch Shorts tolerates retained subscriptions ${String(subscriptions)}`, async () => {
    const profile = { _id: 'retained', subscriptions, unknown: new Date(456) }
    const before = structuredClone(profile)
    const context = await functions('src/renderer/views/Watch/Watch.js', ['libraryShortsRequest'], { hasConfiguredRestrictedPlaybackAuthentication: () => false })
    const result = context.libraryShortsRequest.call({ subscriptionShortsFeedActive: true, tabRoute: { query: {} }, videoId: 'video', $store: { getters: { getActiveProfile: profile }, state: { subscriptionCache: { subscriptionVideosFeedVersion: 1 }, history: { historyRevision: 2 } } } })
    assert.deepEqual(Array.from(result.subscriptions), [])
    assert.deepEqual(profile, before)
  })
}

test('paged playlist removal queues the durable ID when the legacy item ID is absent', async () => {
  const queued = [], videos = [], toasts = []
  const context = await functions('src/renderer/views/Playlist/Playlist.vue', ['removeVideoFromPlaylist'], {
    playlistItems: ref([{ videoId: 'video', _libraryMemberId: 'durable' }]), toBeDeletedPlaylistItemIds: ref(queued), videosWithPlaylistToUnset: ref(videos),
    undoToastAbortController: null, AbortController, setTimeout: () => 1, clearTimeout() {}, removeToBeDeletedVideosSometimes() {},
    showToast: toast => toasts.push(toast), t: key => key, getVideoThumbnailUrl: () => 'thumbnail', backendPreference: ref('local'), currentInvidiousInstanceUrl: ref(''), thumbnailPreference: ref('default'),
  })
  context.removeVideoFromPlaylist('video', null, 'durable')
  assert.deepEqual(queued, ['durable'])
  assert.deepEqual(videos, ['video'])
  assert.equal(toasts.length, 1)
})


test('playlist repair IPC sends only cloneable arguments to the worker and invalidates changed windows', async () => {
  const { DBActions, IpcChannels, SyncEvents } = await import('../../src/constants.js')
  const { script, ast } = await source('src/main/index.js')
  const node = matching(ast, node => node.type === 'CallExpression' && node.callee.object?.name === 'ipcMain' && node.arguments[0]?.property?.name === 'DB_PLAYLISTS')[0]?.arguments[1]
  assert.ok(node)
  let updates = [{ _id: 'p', changes: [{ videoId: 'video', fields: { title: 'Repaired' } }] }]
  const writes = [], events = []
  const request = vm.runInNewContext(`(${script.slice(node.start, node.end)})`, {
    DBActions, IpcChannels, SyncEvents, isOpenTubeXUrl: () => true,
    baseHandlers: { playlists: { repairMetadata: async (...args) => {
      writes.push(structuredClone(args))
      return { updates, repaired: updates.length, failed: 0 }
    } } }, syncOtherWindows: (...args) => events.push(args),
  })
  const event = { senderFrame: { url: 'file://app' } }, data = { playlistIds: ['p'], metadata: [{ videoId: 'video', title: 'Repaired' }] }
  assert.deepEqual(structuredClone(await request(event, { action: DBActions.PLAYLISTS.REPAIR_METADATA, data })), { updates: [{ _id: 'p' }], repaired: 1, failed: 0 })
  assert.deepEqual(writes, [[data]])
  assert.deepEqual(structuredClone(events.map(([channel, _event, payload]) => [channel, payload])), [[IpcChannels.SYNC_PLAYLISTS, { event: SyncEvents.GENERAL.INVALIDATE }]])
  updates = []
  assert.deepEqual(structuredClone(await request(event, { action: DBActions.PLAYLISTS.REPAIR_METADATA, data })), { updates, repaired: 0, failed: 0 })
  assert.equal(events.length, 1)
})

async function componentComputed(file, name, bindings) {
  const { script, ast } = await source(file)
  const declaration = matching(ast, node => node.type === 'VariableDeclarator' && node.id?.name === name)[0]
  assert.ok(declaration, name)
  return vm.runInNewContext(script.slice(declaration.init.start, declaration.init.end), { computed, ...bindings })
}

test('failed additional New categories suppress empty state without claiming new content', async () => {
  const bindings = { isElectron: true, newShorts: vueRef([]), newLive: vueRef([]), newPosts: vueRef([]), pagedFeeds: { shorts: { failed: vueRef(true) }, live: { failed: vueRef(false) }, posts: { failed: vueRef(false) } } }
  const content = await componentComputed('src/renderer/components/SubscriptionsNew.vue', 'hasAdditionalContent', bindings)
  assert.equal(content.value, false)
  const failure = await componentComputed('src/renderer/components/SubscriptionsNew.vue', 'hasAdditionalFailure', bindings)
  assert.equal(failure.value, true)
  bindings.newShorts.value = [{ videoId: 'short' }]
  assert.equal(content.value, true)
})

test('metadata thumbnail read failure displays its available fallback and releases busy state', async () => {
  const context = await functions('src/renderer/components/WatchVideoMetadataHistory/WatchMetadataThumbnail.vue', ['load'], { generation: 0, visible: true, source: ref(null), failed: ref(false), busy: ref(false), props: { revisionId: 'old', fallbackUrl: 'available.png' }, DBLibraryHandlers: { query: async () => { throw new Error('thumbnail read failed') } } })
  await context.load()
  assert.equal(context.source.value, 'available.png')
  assert.equal(context.failed.value, false)
  assert.equal(context.busy.value, false)
})

test('subscription load more preserves the shared maximum restored category extent', async () => {
  let extent = '400'
  const context = await functions('src/renderer/components/SubscriptionsTabUi/SubscriptionsTabUi.vue', ['increaseLimit'], { isPaged: true, pagedFeed: ref({ busy: ref(false), records: ref(Array(200)), more: async () => {} }), dataLimit: ref(100), subscriptionLimitStorageKey: 'new', sessionStorage: { getItem: () => extent, setItem: (_, value) => { extent = value } } })
  await context.increaseLimit()
  assert.equal(extent, '400')
  assert.equal(context.dataLimit.value, 200)
})

test('Save snapshots selected playlist IDs and reports only actual committed additions', async () => {
  const write = Promise.withResolvers(), selection = ref(['first', 'unchanged']), dispatched = [], toasts = []
  let requested
  const context = await functions('src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', ['addSelectedToPlaylists'], { addInProgress: false, selectedPlaylistIdList: selection, allPlaylists: ref([]), toBeAddedToPlaylistVideoList: ref([{ videoId: 'v' }]), addingDuplicateVideosEnabled: ref(false), DBLibraryHandlers: { query: (_, options) => { requested = options.ids; return write.promise } }, store: { dispatch: async (action, reason) => dispatched.push([action, reason]) }, t: (_, options) => options.playlistCount, showToast: toast => toasts.push(toast), hide() {}, getVideoThumbnailUrl: () => null, backendPreference: ref('local'), currentInvidiousInstanceUrl: ref(''), thumbnailPreference: ref('') })
  const saving = context.addSelectedToPlaylists()
  selection.value.push('changed-while-pending')
  write.resolve({ changedIds: ['first'] })
  await saving
  assert.deepEqual(Array.from(requested), ['first', 'unchanged'])
  assert.equal(toasts[0].message, 1)
  assert.deepEqual(dispatched[0], ['scheduleSyncServer', 'playlists'])
})

test('rejected paged next-video navigation does not announce successful playback', async () => {
  const toasts = []
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['playNextVideo'], { isPagedPlaylist: ref(true), canPlayNextVideo: ref(true), userWindow: ref({ next: { videoId: 'next' }, index: 0, total: 2 }), shuffleEnabled: ref(false), expectedAutoSkipItem: null, playUserPlaylistItem: async () => false, showToast: toast => toasts.push(toast), t: key => key })
  await context.playNextVideo()
  assert.deepEqual(toasts, [])
})

for (const field of ['Video', 'Shorts', 'Live', 'Posts']) {
  test(`stale ${field} cache writes do not invalidate subscription feeds`, async () => {
    const cache = field === 'Video' ? 'video' : field.toLowerCase()
    const state = { subscriptionVideosFeedVersion: 7, [cache + 'Cache']: { channel: { timestamp: new Date(10), videos: [], posts: [] } } }
    const name = `update${field}CacheByChannel`
    const context = await functions('src/renderer/store/modules/subscription-cache.js', [name], { toDate: value => new Date(value) })
    context[name](state, { channelId: 'channel', entries: [], timestamp: new Date(5) })
    assert.equal(state.subscriptionVideosFeedVersion, 7)
  })
}

test('playlist pending deletions subtract their known and missing durations until undo', async () => {
  const bindings = { process: { env: { IS_ELECTRON: true } }, toBeDeletedPlaylistItemIds: vueRef(['a', 'b', 'c']), playlistItems: vueRef([{ _libraryMemberId: 'a', videoId: 'first', lengthSeconds: 30 }, { _libraryMemberId: 'b', videoId: 'second' }, { _libraryMemberId: 'c', videoId: 'third' }, { _libraryMemberId: 'kept', lengthSeconds: 100 }]), historyCacheById: vueRef({ second: { lengthSeconds: 20 } }) }
  const contribution = await componentComputed('src/renderer/views/Playlist/Playlist.vue', 'pendingDeletionStatistics', bindings)
  assert.deepEqual(structuredClone(contribution.value), { duration: 50, missingDuration: 1 })
  const totals = { isUserPlaylistRequested: vueRef(true), userStatistics: vueRef({ duration: 150, missingDuration: 1 }), pendingDeletionStatistics: contribution }
  const duration = await componentComputed('src/renderer/views/Playlist/Playlist.vue', 'totalPlaylistDuration', totals)
  const approximate = await componentComputed('src/renderer/views/Playlist/Playlist.vue', 'isDurationApproximate', totals)
  assert.equal(duration.value, 100)
  assert.equal(approximate.value, false)
  bindings.toBeDeletedPlaylistItemIds.value = []
  assert.equal(duration.value, 150)
  assert.equal(approximate.value, true)
})

test('channel hydration failure preserves fetched results and releases retained IDs', async () => {
  const commits = [], target = ref([]), videos = [{ videoId: 'v' }]
  const context = await functions('src/renderer/views/Channel/Channel.vue', ['setChannelVideoResults'], { store: { state: { history: { libraryPaged: true } }, commit: (...args) => commits.push(args), dispatch: async () => { throw new Error('history unavailable') } } })
  assert.equal(await context.setChannelVideoResults(target, videos, () => true), true)
  assert.equal(target.value, videos)
  assert.deepEqual(commits.map(([action]) => action), ['retainVideoState', 'releaseVideoState'])
})

for (const cache of ['empty', 'failed', 'partial']) {
  test(`automatic Shorts download retains dated fetched candidates after ${cache} cache reads`, async () => {
    const downloads = [], videos = [{ videoId: 'dated', title: 'Fetched', published: 1 }, { videoId: 'undated' }]
    const context = await functions('src/renderer/helpers/automaticDownloads.js', ['startAutomaticDownloadsForChannel'], { supportsYtDlp: true, store: { getters: { getEnableDownloads: true, getYtDlpDownloads: {}, getYtDlpAutomaticDownloadRules: '' } }, parseAutomaticDownloadRules: () => ({ channel: {} }), normalizeAutomaticDownloadRule: () => ({}), DBLibraryHandlers: { query: async () => { if (cache === 'failed') throw new Error('cache read failed'); return cache === 'partial' ? [{ ...videos[0], title: 'Saved' }] : [] } }, parseCustomTemplates: () => ({}), getDownloadTemplateOptions: () => ({}), matchesAutomaticDownloadRule: () => true, scheduledVideoIds: new Set(), ytDlp: { ytDlpDownload: async data => { downloads.push(data); return { id: 'd' } } }, getThumbnail: () => null })
    await context.startAutomaticDownloadsForChannel({ id: 'channel' }, videos, 'shorts', key => key, null)
    assert.deepEqual(downloads.map(video => video.videoId), ['dated'])
    assert.equal(downloads[0].title, cache === 'partial' ? 'Saved' : 'Fetched')
  })
}

async function componentWatcher(file, dependency, bindings) {
  const { script, ast } = await source(file)
  const call = matching(ast, node => node.type === 'CallExpression' && node.callee?.name === 'watch' && script.slice(node.arguments[0].start, node.arguments[0].end).includes(dependency))[0]
  let callback
  vm.runInNewContext(script.slice(call.start, call.end), { console: { error() {} }, watch: (_, cb) => { callback = cb }, ...bindings })
  return callback
}

test('Save presence resets immediately and ignores an older completed selection read', async () => {
  const old = Promise.withResolvers(), current = Promise.withResolvers(), selection = ref({ counts: [{ id: 'stale' }], matches: ['stale'] })
  let calls = 0
  const read = await componentWatcher('src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', 'toBeAddedToPlaylistVideoIdList', { selectionGeneration: 0, selection, toBeAddedToPlaylistVideoIdList: vueRef(['v']), processedQuery: vueRef(''), allPlaylists: vueRef([]), DBLibraryHandlers: { query: () => ++calls === 1 ? old.promise : current.promise } })
  const a = read()
  assert.deepEqual(structuredClone(selection.value), { counts: [], matches: [] })
  const b = read()
  current.reject(new Error('current read failed'))
  await b
  old.resolve({ counts: [{ id: 'old' }], matches: ['old'] })
  await a
  assert.deepEqual(structuredClone(selection.value), { counts: [], matches: [] })
})

test('video playlist search stays pending until the current read finishes', async () => {
  const old = Promise.withResolvers(), current = Promise.withResolvers(), pending = vueRef(false), matches = vueRef(new Set())
  let calls = 0
  const read = await componentWatcher('src/renderer/views/UserPlaylists/UserPlaylists.vue', 'appliedQuery', { searchGeneration: 0, librarySearchPending: pending, libraryMatches: matches, appliedQuery: vueRef('video'), doSearchPlaylistsWithMatchingVideos: vueRef(true), allPlaylists: vueRef([]), DBLibraryHandlers: { query: () => ++calls === 1 ? old.promise : current.promise } })
  const a = read(), b = read()
  assert.equal(pending.value, true)
  old.resolve({ matches: ['old'] }); await a
  assert.equal(pending.value, true)
  assert.equal(matches.value.size, 0)
  current.resolve({ matches: ['new'] }); await b
  assert.equal(pending.value, false)
  assert.deepEqual([...matches.value], ['new'])
})

test('subscription profile import does not schedule sync before a durable refresh succeeds', async () => {
  const refresh = Promise.withResolvers(), scheduled = [], toasts = []
  const context = await functions(dataSettings, ['importFreeTubeSubscriptions'], { profileList: ref([{ _id: 'allChannels', subscriptions: [] }]), MAIN_PROFILE_ID: 'allChannels', isJsonObject: value => !!value && typeof value === 'object', t: key => key, showToast: toast => toasts.push(toast), DBLibraryHandlers: { query: async (_, { profiles }) => { assert.deepEqual(profiles[0].unknown, new Date(2)); return true } }, store: { dispatch: (action, reason) => action === 'grabAllProfiles' ? refresh.promise : Promise.resolve(scheduled.push(reason)) } })
  const importing = context.importFreeTubeSubscriptions([{ _id: 'p', name: 'Imported', bgColor: '#000', textColor: '#fff', subscriptions: [{ id: 'channel', name: 'Channel' }], unknown: new Date(2) }])
  await setImmediate()
  assert.deepEqual(scheduled, [])
  refresh.resolve(null)
  await assert.rejects(importing, /could not be refreshed/)
  assert.deepEqual(scheduled, [])
  assert.deepEqual(toasts, [])
})

test('unavailable-video scans exclude opaque members without changing page records', async () => {
  const records = [null, false, 42, {}, { videoId: '' }, { videoId: 42 }, { videoId: 'valid', _libraryMemberId: 'member', unknown: new Date(1) }]
  const original = structuredClone(records), scanned = [], toasts = []
  const context = await functions(playlistInfo, ['scanDeadVideos'], { props: { id: 'p' }, deadVideoScanRunning: ref(false), deadVideoScanController: null, deadVideoProgress: ref({}), deadVideoItemIds: ref(new Set()), showRemoveDeadVideosPrompt: ref(false), AbortController, DBLibraryHandlers: { query: async () => ({ records, cursor: null }) }, store: { getters: { getBackendPreference: 'invidious' } }, findDeadPlaylistItems: async entries => { scanned.push(...entries); return { itemIds: new Set() } }, showToast: toast => toasts.push(toast), t: key => key })
  await context.scanDeadVideos()
  assert.deepEqual(scanned.map(entry => entry.videoId), ['valid'])
  assert.equal(context.deadVideoProgress.value.total, 1)
  assert.deepEqual(records, original)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0].message, /no videos to remove/)
})

test('deleting the first playing member keeps the missing anchor and next surviving video', async () => {
  const initial = { index: -1, total: 2, next: { videoId: 'B' }, records: [{ videoId: 'B' }, { videoId: 'C' }] }
  let reads = 0
  const context = await functions('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', ['loadUserPlaylistWindow'], { userWindowGeneration: 0, userWindowReady: ref(true), userWindowOwner: ref('current'), userWindowKey: () => 'current', isLoading: ref(false), prevVideoBeforeDeletion: ref(null), playlistItems: ref([]), userWindow: ref({ index: 0, previous: { videoId: 'C', _libraryMemberId: 'last' } }), userPlaylistWindowOptions: () => ({}), DBLibraryHandlers: { query: async () => ++reads === 1 ? initial : { ...initial, index: 1, next: { videoId: 'B' } } }, t: key => key, showToast() {} })
  await context.loadUserPlaylistWindow()
  assert.equal(reads, 1)
  assert.equal(context.userWindow.value.index, -1)
  assert.equal(context.userWindow.value.next.videoId, 'B')
  assert.equal(context.prevVideoBeforeDeletion.value, null)
})

test('desktop large create and delete cycles keep membership counts limited to hydrated IDs', async () => {
  const { script, ast } = await source('src/renderer/store/modules/playlists.js')
  const counts = await import('../../src/renderer/helpers/playlist-video-counts.js')
  const context = vm.createContext({ ...counts })
  for (const name of ['summarizePlaylist', 'updateCachedPlaylistMembers']) {
    const fn = matching(ast, node => node.type === 'FunctionDeclaration' && node.id?.name === name)[0]
    if (fn) context[name] = vm.runInContext('(' + script.slice(fn.start, fn.end) + ')', context)
  }
  const declaration = matching(ast, node => node.type === 'VariableDeclarator' && node.id?.name === 'desktopMutations')[0]
  const mutations = vm.runInContext('(' + script.slice(declaration.init.start, declaration.init.end) + ')', context)
  context.mutations = mutations
  const state = { playlists: [], playlistMemberships: { active: { other: 2 } }, playlistVideoCounts: new Map([['active', 2]]) }
  const videos = [{ videoId: 'active' }, ...Array.from({ length: 20000 }, (_, i) => ({ videoId: `v-${i}` }))]
  for (let repeat = 0; repeat < 3; repeat++) {
    mutations.addPlaylist(state, { _id: 'large', videos })
    assert.equal(state.playlistVideoCounts.size, 1)
    assert.equal(state.playlistVideoCounts.get('active'), 3)
    assert.equal(state.playlistMemberships.active.large, 1)
    mutations.removePlaylists(state, ['large'])
    assert.equal(state.playlistVideoCounts.size, 1)
    assert.equal(state.playlistVideoCounts.get('active'), 2)
    assert.deepEqual(Object.keys(state.playlistMemberships.active), ['other'])
  }
})

test('a profile switch during the seen-removal DOM update skips stale manual reloads', async () => {
  const profile = { _id: 'original' }, loads = []
  let ticks = 0
  const context = await functions('src/renderer/components/SubscriptionsNew.vue', ['markAllAsSeen'], { store: { getters: { getActiveProfile: profile } }, props: { activeCategory: 'videos' }, isElectron: true, feed: ref(null), clearingVisibleContent: ref(false), isReducedMotionEnabled: () => true, nextTick: async () => { if (++ticks === 2) profile._id = 'replacement' }, cancelRemovalAnimation() {}, pagedFeeds: { videos: { records: ref([]), failed: ref(false), load: async () => loads.push(profile._id) } } })
  await context.markAllAsSeen(async () => {})
  assert.deepEqual(loads, [])
})

test('playlist move and drag writes block another edit until a current page revision is ready', { timeout: 5000 }, async t => {
  for (const action of ['moveUserVideo', 'onDragVideoEnd']) {
    const write = Promise.withResolvers(), refresh = Promise.withResolvers(), page = Promise.withResolvers()
    const playlistReordering = ref(false), playlistOrderReady = ref(true)
    let writes = 0
    const context = await functions('src/renderer/views/Playlist/Playlist.vue', [action], { playlistReordering, playlistOrderReady, playlistItems: ref([{ videoId: 'v', _libraryMemberId: 'member' }]), tempShownPlaylistItems: ref([{ videoId: 'v', _libraryMemberId: 'member' }]), toBeDeletedPlaylistItemIds: ref([]), playlistId: ref('p'), userPageRevision: 1, userPlaylistVisibleLimit: ref(300), DBLibraryHandlers: { query: () => { writes++; return write.promise } }, store: { getters: { getPlaylist: () => ({ _id: 'p' }) }, dispatch: action => action === 'grabAllPlaylists' ? refresh.promise : Promise.resolve() }, parseUserPlaylist: async (_, extent) => { assert.equal(extent, 300); await page.promise; playlistOrderReady.value = true }, setDraggedVideo() {}, removePendingVideosAfterDrag: false, showToast() {}, showTabToast() {}, t: key => key })
    const invoke = () => action === 'moveUserVideo' ? context[action]('v', null, 1, 'member') : context[action]()
    t.after(() => { write.resolve(false); refresh.resolve(); page.resolve() })
    const first = invoke(), repeated = invoke()
    await setImmediate()
    assert.equal(writes, 1)
    assert.equal(playlistReordering.value, true)
    write.resolve(true); await setImmediate(); await invoke()
    assert.equal(writes, 1)
    assert.equal(playlistOrderReady.value, false)
    refresh.resolve(); await setImmediate(); await invoke()
    assert.equal(writes, 1)
    page.resolve(); await Promise.all([first, repeated])
    assert.equal(playlistReordering.value, false)
    assert.equal(playlistOrderReady.value, true)
  }
})

test('portable Home derives counts from full arrays despite retained synthetic-looking metadata', async () => {
  const { script, ast } = await source('src/renderer/views/Home/Home.vue')
  const declaration = matching(ast, node => node.type === 'VariableDeclarator' && node.id?.name === 'playlistVideoCount')[0]
  const state = { playlists: { libraryPaged: false } }
  const count = vm.runInNewContext('(' + script.slice(declaration.init.start, declaration.init.end) + ')', { store: { state } })
  const record = { _id: 'favorites', videoCount: 0, _librarySummary: true, videos: [{ videoId: 'v' }] }
  assert.equal(count(record), 1)
  assert.equal(count({ ...record, videoCount: 42, videos: [] }), 0)
  state.playlists.libraryPaged = true
  assert.equal(count({ videoCount: 20000, videos: [] }), 20000)
})

test('portable unavailable scans skip retained null and scalar members', async () => {
  const videos = [null, false, 42, {}, { videoId: 'valid' }], scanned = []
  const context = await functions(playlistInfo, ['scanDeadVideos'], { process: { env: { IS_ELECTRON: false } }, props: { id: 'p' }, deadVideoScanRunning: ref(false), deadVideoScanController: null, deadVideoProgress: ref({}), deadVideoItemIds: ref(new Set()), showRemoveDeadVideosPrompt: ref(false), AbortController, DBLibraryHandlers: { query: async () => ({ videos }) }, store: { getters: { getBackendPreference: 'invidious' } }, findDeadPlaylistItems: async entries => { scanned.push(...entries); return { itemIds: new Set() } }, showToast() {}, t: key => key })
  await context.scanDeadVideos()
  assert.deepEqual(scanned.map(video => video.videoId), ['valid'])
  assert.deepEqual(videos, [null, false, 42, {}, { videoId: 'valid' }])
})
