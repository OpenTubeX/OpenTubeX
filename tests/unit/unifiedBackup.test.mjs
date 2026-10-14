import assert from 'node:assert/strict'
import test from 'node:test'

import { strToU8, unzipSync, zipSync } from 'fflate'
import { readFile } from 'node:fs/promises'
import { compileFunction } from 'node:vm'
import { parse as parseVue, babelParse as parseJavaScript } from 'vue/compiler-sfc'
import Datastore from '@seald-io/nedb'
import { createStore } from 'vuex'
import { toRaw } from 'vue'
import model from '@seald-io/nedb/lib/model.js'
import * as historyHelpers from '../../src/history.js'
import * as backupHelpers from '../../src/renderer/helpers/unifiedBackup.js'

import { BACKUP_SECTIONS, createUnifiedBackup, mergeBackupHistoryRecord, mergeBackupPlaylist, mergeBackupProfile, mergeBackupWatchStatsAdjustment, mergeBackupWatchStatsRecord, readUnifiedBackup, validateBackupWatchStats } from '../../src/renderer/helpers/unifiedBackup.js'

test('portable backup codecs retain Dates and leave historical ISO strings unchanged', async () => {
  const base = { settings: {}, profiles: [], playlists: [], history: [], searchHistory: [], watchStats: { records: [], adjustment: null } }
  const original = { ...base, history: [{ _id: 'dated', videoId: 'video', timeWatched: new Date(0), unknown: [new Date(1), '1970-01-01T00:00:00.001Z'] }] }
  assert.deepEqual((await readUnifiedBackup(createUnifiedBackup(original))).data, original)
})

const data = {
  settings: { theme: 'dark' },
  profiles: [{ _id: 'main', name: 'Main', subscriptions: [] }],
  playlists: [{ _id: 'favorites', playlistName: 'Favorites', videos: [] }],
  history: [{ videoId: 'abcdefghijk', timeWatched: 1 }],
  searchHistory: [{ _id: 'search', query: 'music' }],
  watchStats: {
    records: [{ date: '2026-09-26', seconds: 42, historyEstimateApplied: true }],
    adjustment: { defaultSpeed: 1.5 },
  },
}

test('round trips every backup section in a ZIP archive', async () => {
  const backup = createUnifiedBackup(data)
  const result = await readUnifiedBackup(backup)
  assert.equal(result.manifest.format, 'opentubex-backup')
  assert.equal(result.manifest.version, 1)
  assert.deepEqual(result.data, data)
  assert.deepEqual(Object.keys(result.data), BACKUP_SECTIONS)
})

test('partial backups contain and restore only the selected sections', async () => {
  for (const sections of BACKUP_SECTIONS.map(section => [section]).concat([['profiles', 'history']])) {
    const selected = Object.fromEntries(sections.map(section => [section, data[section]]))
    const backup = createUnifiedBackup(selected)
    assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await backup.arrayBuffer()))), ['manifest.json', ...sections.map(section => `${section}.json`)])
    const restored = await readUnifiedBackup(backup)
    assert.deepEqual(restored.manifest.sections, sections)
    assert.deepEqual(restored.data, selected)
  }
  assert.throws(() => createUnifiedBackup({}), /No backup sections selected/)
})

test('complete backups without a sections manifest still restore all data', async () => {
  const files = Object.fromEntries(BACKUP_SECTIONS.map(section => [`${section}.json`, strToU8(JSON.stringify(data[section]))]))
  files['manifest.json'] = strToU8('{"format":"opentubex-backup","version":1}')
  assert.deepEqual((await readUnifiedBackup(new Blob([zipSync(files)]))).data, data)
})

test('rejects invalid section lists and missing, extra, or malformed selected data', async () => {
  for (const sections of [[], ['unknown'], ['settings', 'settings'], 'settings', [null]]) {
    const files = { 'manifest.json': strToU8(JSON.stringify({ format: 'opentubex-backup', version: 1, sections })) }
    await assert.rejects(readUnifiedBackup(new Blob([zipSync(files)])), /Invalid backup sections/)
  }
  const manifest = strToU8('{"format":"opentubex-backup","version":1,"sections":["settings"]}')
  for (const files of [{}, { 'settings.json': strToU8('{}'), 'history.json': strToU8('[]') }]) {
    await assert.rejects(readUnifiedBackup(new Blob([zipSync({ 'manifest.json': manifest, ...files })])), /missing or unexpected files/)
  }
  await assert.rejects(readUnifiedBackup(createUnifiedBackup({ history: [null] })), /Invalid backup history/)
})

test('rejects an incomplete archive before restoring data', async () => {
  const backup = new Blob([zipSync({ 'manifest.json': strToU8('{"format":"opentubex-backup","version":1}') })])
  await assert.rejects(readUnifiedBackup(backup), /missing or unexpected files/)
})

test('rejects malformed records before restoring data', async () => {
  const malformed = { ...data, playlists: [{ _id: 42, videos: [] }] }
  await assert.rejects(readUnifiedBackup(createUnifiedBackup(malformed)), /Invalid backup playlists/)
  await assert.rejects(readUnifiedBackup(createUnifiedBackup({
    ...data,
    profiles: [{ name: 'Broken', subscriptions: [] }],
  })), /Invalid backup profiles/)
})

for (const id of ['allChannels', 'custom']) {
  test(`backup retains a released null profile name: ${id}`, async () => {
    const input = { ...data, profiles: [{ _id: id, name: null, subscriptions: [], unknown: { keep: true } }] }
    const reading = readUnifiedBackup(createUnifiedBackup(input))
    assert.deepEqual((await reading).data, input)
  })
}

const retainedBackupShapes = [
  ...[{}, { subscriptions: null }, { subscriptions: false }, { subscriptions: 42 }, { subscriptions: 'retained' }, { subscriptions: [null, false, { unknown: true }, { id: 'channel' }] }]
    .map(fields => ['profiles', { _id: 'legacy', name: 'Legacy', unknown: { keep: true }, ...fields }]),
  ...[{}, { videos: null }, { videos: false }, { videos: 42 }, { videos: 'retained' }, { videos: { unknown: true } }, { videos: [null, false, 42, { unknown: true }] }]
    .map(fields => ['playlists', { _id: 'legacy', playlistName: 'Legacy', unknown: { keep: true }, ...fields }]),
  ['history', { _id: 'legacy', timeWatched: null, watchProgress: '7', unknown: { keep: true } }],
  ['history', { _id: 'legacy', videoId: 42, timeWatched: 'old', unknown: { keep: true } }],
  ...[{}, { query: null }, { query: 42 }].map(fields => ['searchHistory', { _id: 'legacy query', unknown: { keep: true }, ...fields }]),
]
for (const [section, record] of retainedBackupShapes) {
  test(`generated backup explicitly round trips retained ${section} shape ${JSON.stringify(record)}`, async () => {
    const input = { ...data, [section]: [record] }
    assert.deepEqual((await readUnifiedBackup(createUnifiedBackup(input))).data, input)
  })
}

test('rejects non-finite history timestamps and progress', async () => {
  const files = Object.fromEntries(BACKUP_SECTIONS.map(section => [`${section}.json`, strToU8(JSON.stringify(data[section]))]))
  files['manifest.json'] = strToU8('{"format":"opentubex-backup","version":1}')
  files['history.json'] = strToU8('[{"videoId":"abcdefghijk","timeWatched":1e400,"watchProgress":1e400}]')
  await assert.rejects(readUnifiedBackup(new Blob([zipSync(files)])), /Invalid backup history/)
})

test('rejects malformed watch statistics before a datastore write', () => {
  assert.throws(() => validateBackupWatchStats({ records: null, adjustment: null }), /Invalid backup watchStats/)
  assert.throws(() => validateBackupWatchStats({ records: [{ date: 'bad', seconds: 42 }], adjustment: null }), /Invalid backup watchStats/)
  assert.throws(() => validateBackupWatchStats({ records: [{ date: '2026-09-26', seconds: -1 }], adjustment: null }), /Invalid backup watchStats/)
  assert.throws(() => validateBackupWatchStats({ records: [] }), /Invalid backup watchStats/)
  assert.doesNotThrow(() => validateBackupWatchStats({ records: [], adjustment: [] }))
  assert.doesNotThrow(() => validateBackupWatchStats(data.watchStats))
})

test('rejects backup versions the importer cannot read', async () => {
  const files = Object.fromEntries(BACKUP_SECTIONS.map(section => [`${section}.json`, strToU8(JSON.stringify(data[section]))]))
  files['manifest.json'] = strToU8('{"format":"opentubex-backup","version":2}')
  await assert.rejects(readUnifiedBackup(new Blob([zipSync(files)])), /Unsupported backup version/)
})

test('merges subscriptions and playlist videos without dropping local entries', () => {
  const currentProfile = { _id: 'main', name: 'Local', subscriptions: [{ id: 'local' }] }
  const incomingProfile = { _id: 'main', name: 'Imported', subscriptions: [{ id: 'imported' }] }
  assert.deepEqual(mergeBackupProfile(currentProfile, incomingProfile).subscriptions.map(channel => channel.id), ['local', 'imported'])

  const currentPlaylist = { _id: 'favorites', playlistName: 'Local', videos: [{ videoId: 'local', timeAdded: 1 }] }
  const incomingPlaylist = { _id: 'favorites', playlistName: 'Imported', videos: [{ videoId: 'imported', timeAdded: 2 }] }
  const merged = mergeBackupPlaylist(currentPlaylist, incomingPlaylist)
  assert.deepEqual(merged.videos.map(video => video.videoId), ['local', 'imported'])
  assert.deepEqual(mergeBackupPlaylist(merged, incomingPlaylist).videos, merged.videos)

  const protectedLocal = { ...currentPlaylist, protected: true }
  const unprotectedImport = { ...incomingPlaylist, protected: false }
  assert.equal(mergeBackupPlaylist(protectedLocal, unprotectedImport).protected, true)
})

test('profile merging preserves every opaque and repeated subscription occurrence', () => {
  const current = { _id: 'p', name: 'Local', subscriptions: [null, null, { id: 'channel', local: true }, { id: 'channel', second: true }, { unknown: new Date(1) }] }
  const incoming = { _id: 'p', name: 'Imported', subscriptions: [null, null, null, { id: 'channel', title: 'First' }, { id: 'channel', title: 'Second' }, { unknown: new Date(1) }, false] }
  const before = structuredClone(current)
  const merged = mergeBackupProfile(current, incoming)
  assert.deepEqual(merged.subscriptions, [null, null, { id: 'channel', local: true, title: 'First' }, { id: 'channel', second: true, title: 'Second' }, { unknown: new Date(1) }, null, false])
  assert.deepEqual(mergeBackupProfile(merged, incoming), merged)
  assert.deepEqual(current, before)
  assert.throws(() => mergeBackupProfile({ _id: 'p', subscriptions: null }, incoming), /incompatible profile subscriptions/)
})

test('clears a conflicting adjustment when both sets contain watch-time estimates', () => {
  const estimated = [{ date: '2026-09-26', seconds: 42, historyEstimateApplied: true }]
  assert.equal(mergeBackupWatchStatsAdjustment(estimated, { defaultSpeed: 2 }, estimated, null), null)
  assert.deepEqual(mergeBackupWatchStatsAdjustment(estimated, { defaultSpeed: 2 }, estimated, { defaultSpeed: 2 }), { defaultSpeed: 2 })
  assert.deepEqual(mergeBackupWatchStatsAdjustment(estimated, { defaultSpeed: 2 }, [], null), { defaultSpeed: 2 })
})

test('ID-less backup history retains distinct visits instead of replacing an identified occurrence', () => {
  const current = [{ _id: 'saved', videoId: 'same', timeWatched: 1, unknown: new Date(1) }]
  const incoming = [{ videoId: 'same', timeWatched: 2, unknown: new Date(2) }, { videoId: 'same', timeWatched: 3, unknown: new Date(3) }]
  const merged = [...backupHelpers.mergeBackupHistory(current, incoming).values()]
  assert.deepEqual(merged, [...current, ...incoming])
  assert.deepEqual([...backupHelpers.mergeBackupHistory(merged, incoming).values()], [...merged, ...incoming])
  assert.deepEqual(current, [{ _id: 'saved', videoId: 'same', timeWatched: 1, unknown: new Date(1) }])
})

test('older backups cannot reduce watch progress or daily watch time', () => {
  const currentHistory = { videoId: 'abcdefghijk', timeWatched: 20, watchProgress: 90, isWatched: true, title: 'Latest' }
  const olderHistory = { videoId: 'abcdefghijk', timeWatched: 10, watchProgress: 30, isWatched: false, title: 'Old' }
  assert.deepEqual(mergeBackupHistoryRecord(currentHistory, olderHistory), currentHistory)
  assert.deepEqual(mergeBackupHistoryRecord(olderHistory, currentHistory), currentHistory)

  const currentStats = { date: '2026-09-26', seconds: 90 }
  const olderStats = { date: '2026-09-26', seconds: 30 }
  assert.deepEqual(mergeBackupWatchStatsRecord(currentStats, olderStats), currentStats)
  assert.deepEqual(mergeBackupWatchStatsRecord(olderStats, currentStats), currentStats)
})

test('portable backup restoration retains every identified history occurrence across repeated restores', async () => {
  const db = { history: new Datastore({ inMemoryOnly: true }), settings: new Datastore({ inMemoryOnly: true }) }
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const original = [
    { _id: 'local', videoId: 'same', title: 'Local', timeWatched: 30, watchProgress: 90, isWatched: true, unknown: { local: true } },
    { _id: 'local-missing', title: 'No video ID', timeWatched: 20, isWatched: true, unknown: { local: true } },
    { _id: 'string-older', videoId: 'same', timeWatched: 'aaa', isWatched: true },
    { _id: 'string-newest', videoId: 'same', timeWatched: 'zzz', isWatched: true, unknown: { retained: true } },
  ]
  await db.history.insertAsync(original)
  const incoming = [
    ...[undefined, undefined, null, null, 42, '42', 'same', 'same'].map((videoId, index) => ({
      _id: `imported-${index}`, ...(videoId === undefined ? {} : { videoId }), timeWatched: index + 1,
      watchProgress: 12, isWatched: true, title: `Imported ${index}`, unknown: { index },
    })),
  ]
  const { data: decoded } = await readUnifiedBackup(createUnifiedBackup({ ...data, history: incoming }))
  const base = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const baseDependencies = { db, ...historyHelpers, HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated', recommendations: { async remove() {} } }
  const baseClasses = parseJavaScript(base, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'ClassDeclaration' && ['Settings', 'History'].includes(node.id.name))
    .map(node => base.slice(node.start, node.end)).join('\n')
  const History = compileFunction(baseClasses + '\nreturn History', Object.keys(baseDependencies))(...Object.values(baseDependencies))
  const historyModule = await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8')
  const nodes = parseJavaScript(historyModule, { sourceType: 'module' }).program.body
  const historySource = nodes.filter(node => node.type !== 'ImportDeclaration').map(node => node.type === 'ExportDefaultDeclaration'
    ? 'return ' + historyModule.slice(node.declaration.start, node.declaration.end)
    : historyModule.slice(node.start, node.end)).join('\n')
  const dependencies = { ...historyHelpers, toRaw, process: { env: { IS_ELECTRON: false } }, DBHistoryHandlers: History }
  // Resolve the actual bare import, so the fixture cannot hide a missing binding.
  for (const node of nodes) {
    if (node.type === 'ImportDeclaration' && node.source.value === '@seald-io/nedb/lib/model.js') {
      dependencies[node.specifiers[0].local.name] = (await import(node.source.value)).default
    }
  }
  const history = compileFunction(historySource, Object.keys(dependencies))(...Object.values(dependencies))
  const store = createStore({ modules: { history } })
  const component = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
  const script = parseVue(component).descriptor.scriptSetup.content
  const declaration = parseJavaScript(script, { sourceType: 'module' }).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'importUnifiedBackup')
  assert.ok(declaration, 'exercise the actual restore entry point')
  const messages = []
  const bindings = {
    ...backupHelpers, store, DBHistoryHandlers: History, process: { env: { IS_ELECTRON: false } },
    backupBusy: { value: false }, selectedBackupSections: { value: ['history'] }, backupData: { value: decoded },
    compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => messages.push(toast),
  }
  const thumbnailHelpers = parseJavaScript(script, { sourceType: 'module' }).program.body.filter(node => node.type === 'FunctionDeclaration' && ['isJsonObject', 'normalizeImportedPlaylistThumbnail'].includes(node.id.name)).map(node => script.slice(node.start, node.end)).join('\n')
  const restore = compileFunction(thumbnailHelpers + '\nreturn ' + script.slice(declaration.start, declaration.end), Object.keys(bindings))(...Object.values(bindings))
  const expected = [...original, ...incoming].toSorted((a, b) => model.compareThings(a._id, b._id))
  for (let repeat = 0; repeat < 2; repeat++) {
    await restore()
    assert.deepEqual(await db.history.findAsync({}).sort({ _id: 1 }), expected)
    assert.equal(toRaw(store.state.history.historyCacheSorted).length, expected.length)
    assert.deepEqual(toRaw(store.state.history.historyCacheById.same), (await History.find()).find(record => record.videoId === 'same'))
    await store.dispatch('grabHistory')
    assert.deepEqual(toRaw(store.state.history.historyCacheById.same), (await History.find()).find(record => record.videoId === 'same'))
    assert.equal(messages.at(-1).message, 'Settings.Data Settings.Backup imported')
  }
  assert.equal(await store.dispatch('overwriteHistory', new Map([...original, ...incoming].map(record => [record._id, record]))), true)
  assert.deepEqual(toRaw(store.state.history.historyCacheById.same), (await History.find()).find(record => record.videoId === 'same'))
  assert.deepEqual(decoded.history, incoming)
})

for (const times of [[100, '2'], ['100', 2], [new Date(100), '200'], ['200', new Date(100)]]) {
  test(`history merge uses the same retained timestamp ordering as NeDB for ${times.map(String).join(' and ')}`, async () => {
    const db = new Datastore({ inMemoryOnly: true })
    const current = { _id: 'current', videoId: 'same', timeWatched: times[0], watchProgress: 12, isWatched: false, title: 'Current' }
    const imported = { _id: 'imported', videoId: 'same', timeWatched: times[1], watchProgress: 12, isWatched: false, title: 'Imported' }
    await db.insertAsync([current, imported])
    const newest = (await db.findAsync({}).sort({ timeWatched: -1 }))[0]
    assert.deepEqual(mergeBackupHistoryRecord(current, imported), newest)
  })
}

for (const [saved, imported] of [
  [{ timeAdded: 10 }, { videoId: null, timeAdded: 10 }],
  [{ videoId: 'same' }, { videoId: 'same', timeAdded: null }],
  [{ playlistItemId: 'item', timeAdded: 10 }, { playlistItemId: 'item', videoId: null, timeAdded: 10 }],
  [{ videoId: 'same', timeAdded: new Date(10) }, { videoId: 'same', timeAdded: new Date(10).toISOString() }],
]) {
  test(`playlist backup merging preserves typed identities ${model.serialize(saved)} and ${model.serialize(imported)}`, () => {
    const current = { _id: 'p', playlistName: 'Retained', videos: [{ ...saved, unknown: 'saved' }] }
    const incoming = { ...current, videos: [{ ...imported, unknown: 'imported' }] }
    const merged = mergeBackupPlaylist(current, incoming)
    assert.deepEqual(merged.videos, [...current.videos, ...incoming.videos])
    assert.deepEqual(mergeBackupPlaylist(merged, incoming).videos, merged.videos)
  })
}

for (const invalid of [undefined, null, '45', false, -1]) {
  for (const numericSide of ['current', 'imported']) {
    test(`history restore keeps valid ${numericSide} progress over ${String(invalid)}`, () => {
      const current = { _id: 'entry', timeWatched: 1, watchProgress: numericSide === 'current' ? 45 : invalid }
      const imported = { _id: 'entry', timeWatched: 2, watchProgress: numericSide === 'imported' ? 45 : invalid }
      assert.equal(mergeBackupHistoryRecord(current, imported).watchProgress, 45)
    })
  }
}


test('legacy version-one backups preserve literal marker objects without an encoding marker', async () => {
  const original = { ...data, settings: { literal: { '$$date': 0 }, escaped: '$$literal' } }
  const files = Object.fromEntries(BACKUP_SECTIONS.map(section => [section + '.json', strToU8(JSON.stringify(original[section]))]))
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'opentubex-backup', version: 1 }))
  assert.deepEqual((await readUnifiedBackup(new Blob([zipSync(files)]))).data, original)
})

test('encoded backups distinguish Dates from literal date and object markers', async () => {
  const original = { ...data, settings: { actual: new Date(0), literal: { '$$date': 0 }, object: { '$$backupObject': [['$$date', 0]] }, escaped: '$$literal' } }
  const result = await readUnifiedBackup(createUnifiedBackup(original))
  assert.equal(result.manifest.encoding, 'opentubex-json-v1')
  assert.deepEqual(result.data, original)
})


for (const adapter of ['nedb', 'sqlite']) {
  test(`retained malformed watch statistics restore without coercion and remain idempotent: ${adapter}`, async t => {
    const helpers = await import('../../src/renderer/helpers/unifiedBackup.js')
    let database
    const db = adapter === 'nedb' ? { watchStats: new Datastore({ inMemoryOnly: true }) } : await (async () => {
      const { DatabaseSync } = await import('node:sqlite')
      const { LibraryEngine } = await import('../../src/datastores/sqlite/engine.js')
      const { SCHEMA_SQL } = await import('../../src/datastores/sqlite/schema.js')
      database = new DatabaseSync(':memory:')
      database.exec(SCHEMA_SQL)
      const engine = new LibraryEngine(database)
      t.after(() => database.close())
      return engine.collections
    })()
    const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const bindings = { db, model, ...helpers }
    const WatchStats = compileFunction(source.slice(source.indexOf('class WatchStats {'), source.indexOf('class Profiles {')) + '\nreturn WatchStats', Object.keys(bindings))(...Object.values(bindings))
    const records = [
      { _id: 'bad-date', date: 'retained', seconds: 42, unknown: new Date(1) },
      { _id: 'negative', date: '2026-10-09', seconds: -1, unknown: new Date(2) },
      { _id: 'string', date: '2026-10-09', seconds: 'legacy', unknown: new Date(3) },
      { _id: 'missing', date: null, unknown: new Date(4) },
    ]
    const current = { _id: 'current', date: '2026-10-09', seconds: 100, unknown: new Date(5) }
    await db.watchStats.insertAsync(current)
    const backup = { records, adjustment: null }
    await WatchStats.validateBackup(backup)
    assert.deepEqual(await db.watchStats.findAsync({}), [current])
    for (let repeat = 0; repeat < 2; repeat++) {
      await WatchStats.mergeBackup(backup)
      assert.deepEqual(await db.watchStats.findAsync({ date: { $exists: true } }).sort({ _id: 1 }), [...records, current].toSorted((a, b) => model.compareThings(a._id, b._id)))
    }
    const before = await db.watchStats.findAsync({}).sort({ _id: 1 })
    await assert.rejects(WatchStats.mergeBackup({ records: [{ ...records[0], seconds: 43 }], adjustment: null }), /conflicting retained watch statistics/i)
    assert.deepEqual(await db.watchStats.findAsync({}).sort({ _id: 1 }), before)
    const duplicate = { _id: 'new-retained', date: 'retained', seconds: 'legacy', future: new Date(9) }
    await assert.rejects(WatchStats.mergeBackup({ records: [{ date: '2026-10-10', seconds: 5 }, duplicate, structuredClone(duplicate)], adjustment: null }), /duplicate retained/i)
    assert.deepEqual(await db.watchStats.findAsync({}).sort({ _id: 1 }), before)
  })
}


for (const adjustment of ['retained', 42, false, [], new Date(1)]) {
  test(`retained watch-stat adjustment restores exactly and rejects conflict before writes: ${model.serialize(adjustment)}`, async () => {
    const db = { watchStats: new Datastore({ inMemoryOnly: true }) }
    const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const bindings = { db, model, ...backupHelpers }
    const WatchStats = compileFunction(source.slice(source.indexOf('class WatchStats {'), source.indexOf('class Profiles {')) + '\nreturn WatchStats', Object.keys(bindings))(...Object.values(bindings))
    for (let repeat = 0; repeat < 2; repeat++) {
      await WatchStats.mergeBackup({ records: [], adjustment })
      assert.deepEqual(await WatchStats.getHistoricalAdjustment(), adjustment)
    }
    const before = await db.watchStats.findAsync({}).sort({ _id: 1 })
    await assert.rejects(WatchStats.mergeBackup({ records: [{ date: '2026-10-12', seconds: 5 }], adjustment: { defaultSpeed: 2 } }), /Conflicting retained watch-stat adjustments/)
    assert.deepEqual(await db.watchStats.findAsync({}).sort({ _id: 1 }), before)
  })
}


for (const adapter of ['nedb', 'sqlite']) {
  for (const existing of [false, true]) {
    test(`restoring a date-bearing reserved watch-stat marker preserves all retained fields: ${adapter}/${existing}`, async t => {
      let database
      const db = adapter === 'nedb' ? { watchStats: new Datastore({ inMemoryOnly: true }) } : await (async () => {
        const { DatabaseSync } = await import('node:sqlite')
        const { LibraryEngine } = await import('../../src/datastores/sqlite/engine.js')
        const { SCHEMA_SQL } = await import('../../src/datastores/sqlite/schema.js')
        database = new DatabaseSync(':memory:'); database.exec(SCHEMA_SQL)
        t.after(() => database.close())
        return new LibraryEngine(database).collections
      })()
      const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
      const bindings = { db, model, ...backupHelpers }
      const WatchStats = compileFunction(source.slice(source.indexOf('class WatchStats {'), source.indexOf('class Profiles {')) + '\nreturn WatchStats', Object.keys(bindings))(...Object.values(bindings))
      const current = { _id: 'history-watch-time-v1', completedAt: 5, hadEstimates: false, adjustment: null, existingUnknown: new Date(1) }
      if (existing) await db.watchStats.insertAsync(current)
      const marker = { _id: 'history-watch-time-v1', date: null, seconds: 'retained', adjustment: null, unknown: new Date(2) }
      const other = { _id: 'other', date: null, seconds: -1, unknown: new Date(3) }
      for (let repeat = 0; repeat < 2; repeat++) {
        await WatchStats.mergeBackup({ records: [marker, other], adjustment: null })
        const saved = await db.watchStats.findOneAsync({ _id: marker._id })
        assert.deepEqual(saved, { ...(existing ? current : {}), ...marker, completedAt: saved.completedAt, hadEstimates: false })
        assert.deepEqual(await db.watchStats.findOneAsync({ _id: other._id }), other)
      }
      const before = await db.watchStats.findAsync({}).sort({ _id: 1 })
      await assert.rejects(WatchStats.mergeBackup({ records: [{ ...marker, unknown: new Date(4) }, { date: '2026-10-12', seconds: 5 }], adjustment: null }), /Conflicting retained watch-stat marker/)
      assert.deepEqual(await db.watchStats.findAsync({}).sort({ _id: 1 }), before)
    })
  }
}


test('portable restore accumulates repeated playlist records without dropping incoming members', async () => {
  const db = new Datastore({ inMemoryOnly: true })
  const original = { _id: 'retained', playlistName: 'Retained', protected: false, videos: [{ videoId: 'local', playlistItemId: 'local', description: 'keep local', viewCount: 42 }], unknown: new Date(1) }
  const unrelated = { _id: 'unselected', playlistName: 'Unrelated', videos: [{ videoId: 'other', description: 'keep other', viewCount: 0, unknown: new Date(4) }] }
  await db.insertAsync([original, unrelated])
  const incoming = ['A', 'B'].map(videoId => ({ _id: original._id, playlistName: 'Imported', videos: [{ videoId, playlistItemId: videoId, description: 'keep imported', viewCount: 0, unknown: new Date(videoId === 'A' ? 2 : 3) }] }))
  const { data: decoded } = await readUnifiedBackup(createUnifiedBackup({ playlists: incoming }))
  const component = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
  const script = parseVue(component).descriptor.scriptSetup.content
  const declaration = parseJavaScript(script, { sourceType: 'module' }).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'importUnifiedBackup')
  const messages = []
  const bindings = {
    ...backupHelpers, process: { env: { IS_ELECTRON: false } },
    backupBusy: { value: false }, selectedBackupSections: { value: ['playlists'] }, backupData: { value: decoded },
    backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
    DBPlaylistHandlers: {
      find: () => db.findAsync({}),
      replaceIfUnchanged: async (previous, record) => db.updateAsync({ _id: record._id, $where() { return model.serialize(this) === model.serialize(previous) } }, record),
    },

    compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => messages.push(toast),
  }
  const playlistSource = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
  const moduleCode = parseJavaScript(playlistSource, { sourceType: 'module' }).program.body.filter(node => node.type !== 'ImportDeclaration').map(node => node.type === 'ExportDefaultDeclaration'
    ? 'return ' + playlistSource.slice(node.declaration.start, node.declaration.end)
    : playlistSource.slice(node.start, node.end)).join('\n')
  const dependencies = { process: { env: { IS_ELECTRON: false } }, DBPlaylistHandlers: { ...bindings.DBPlaylistHandlers, upsert: () => assert.fail('Refresh must not rewrite records') }, ...await import('../../src/renderer/helpers/playlist-video-counts.js') }
  const playlists = compileFunction(moduleCode, Object.keys(dependencies))(...Object.values(dependencies))
  bindings.store = createStore({ modules: { playlists }, actions: { scheduleSyncServer() {} }, state: { settings: { quickBookmarkTargetPlaylistId: original._id } } })
  const thumbnailHelpers = parseJavaScript(script, { sourceType: 'module' }).program.body.filter(node => node.type === 'FunctionDeclaration' && ['isJsonObject', 'normalizeImportedPlaylistThumbnail'].includes(node.id.name)).map(node => script.slice(node.start, node.end)).join('\n')
  const restore = compileFunction(thumbnailHelpers + '\nreturn ' + script.slice(declaration.start, declaration.end), Object.keys(bindings))(...Object.values(bindings))
  for (let repeat = 0; repeat < 2; repeat++) {
    await restore()
    const saved = await db.findOneAsync({ _id: original._id })
    assert.deepEqual(saved, { ...original, playlistName: 'Imported', videos: [original.videos[0], ...incoming.flatMap(playlist => playlist.videos)], ...(Object.hasOwn(saved, 'lastUpdatedAt') ? { lastUpdatedAt: saved.lastUpdatedAt } : {}) })
    assert.match(messages.at(-1).message, /Backup imported/)
    assert.deepEqual(await db.findOneAsync({ _id: unrelated._id }), unrelated)
    assert.deepEqual(toRaw(bindings.store.state.playlists.playlists.find(record => record._id === unrelated._id)), unrelated)
    assert.deepEqual(toRaw(bindings.store.state.playlists.playlists.find(record => record._id === original._id)), saved)
  }
})


test('portable startup preserves every retained playlist name without writing generated labels', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
  const nodes = parseJavaScript(source, { sourceType: 'module' }).program.body
  const code = nodes.filter(node => node.type !== 'ImportDeclaration').map(node => node.type === 'ExportDefaultDeclaration'
    ? 'return ' + source.slice(node.declaration.start, node.declaration.end)
    : source.slice(node.start, node.end)).join('\n')
  const counts = await import('../../src/renderer/helpers/playlist-video-counts.js')
  for (const label of [undefined, null, false, 42, ['retained'], { future: true }]) {
    const db = new Datastore({ inMemoryOnly: true })
    const record = { _id: 'retained', protected: false, createdAt: 1, lastUpdatedAt: 1, videos: [{ videoId: 'A', playlistItemId: 'item', timeAdded: 1, type: 'video' }], ...(label === undefined ? {} : { playlistName: label }) }
    await db.insertAsync(record)
    let writes = 0
    const bindings = {
      process: { env: { IS_ELECTRON: false } }, ...counts,
      DBPlaylistHandlers: { find: () => db.findAsync({}), upsert: async record => { writes++; await db.updateAsync({ _id: record._id }, record) } },
      console: { error(error) { throw error } },
    }
    const playlists = compileFunction(code, Object.keys(bindings))(...Object.values(bindings))
    const store = createStore({ modules: { playlists }, state: { settings: { quickBookmarkTargetPlaylistId: record._id } } })
    await store.dispatch('grabAllPlaylists')
    assert.equal(writes, 0)
    assert.deepEqual(await db.findOneAsync({ _id: record._id }), record)
    assert.deepEqual(toRaw(store.state.playlists.playlists[0]), record)
  }
})


test('profile ordering tolerates retained names without coercing or changing stored records', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8')
  const node = parseJavaScript(source, { sourceType: 'module' }).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'profileSort')
  const collator = new Intl.Collator(undefined, { usage: 'sort', caseFirst: 'upper', sensitivity: 'case', numeric: true })
  const compare = compileFunction('return ' + source.slice(node.start, node.end), ['MAIN_PROFILE_ID', 'collator'])('allChannels', collator)
  const labels = [undefined, null, false, 42, [], {}, new Date(1)]
  const records = [{ _id: 'allChannels', name: 42 }, ...labels.map((name, index) => ({ _id: `unknown-${index}`, unknown: new Date(index), ...(name === undefined ? {} : { name }) })), { _id: 'named', name: 'Zebra' }]
  const db = new Datastore({ inMemoryOnly: true })
  await db.insertAsync(records)
  assert.deepEqual((await db.findAsync({})).sort(compare).map(record => record._id), records.map(record => record._id))
  assert.equal(compare({ _id: 'a', name: 'é' }, { _id: 'b', name: 'e\u0301' }), 0)
  assert.deepEqual(await db.findAsync({}).sort({ _id: 1 }), records.toSorted((a, b) => model.compareThings(a._id, b._id)))
})


for (const conflict of ['adjustment', 'record']) {
  test(`portable restore preflights watch-stat ${conflict} conflicts before any selected section writes`, async () => {
    const db = Object.fromEntries(['watchStats', 'profiles', 'playlists', 'history', 'searchHistory'].map(name => [name, new Datastore({ inMemoryOnly: true })]))
    const original = {
      watchStats: [{ _id: 'history-watch-time-v1', adjustment: 'retained', completedAt: 1 }, { _id: 'malformed', date: null, seconds: 'original' }],
      profiles: [{ _id: 'profile', name: 'Original', subscriptions: [] }],
      playlists: [{ _id: 'playlist', playlistName: 'Original', videos: [] }],
      history: [{ _id: 'history', videoId: 'same', timeWatched: 1 }],
      searchHistory: [{ _id: 'search', query: 'original' }],
    }
    for (const [name, records] of Object.entries(original)) await db[name].insertAsync(records)
    const incoming = {
      profiles: [{ _id: 'profile', name: 'Changed', subscriptions: [] }],
      playlists: [{ _id: 'playlist', playlistName: 'Changed', videos: [] }],
      history: [{ _id: 'new-history', videoId: 'new', timeWatched: 2 }],
      searchHistory: [{ _id: 'new-search', query: 'changed' }],
      watchStats: { records: conflict === 'record' ? [{ _id: 'malformed', date: null, seconds: 'changed' }] : [], adjustment: conflict === 'adjustment' ? 42 : 'retained' },
    }
    const base = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
    const dependencies = { db, model, ...backupHelpers }
    const WatchStats = compileFunction(base.slice(base.indexOf('class WatchStats {'), base.indexOf('class Profiles {')) + '\nreturn WatchStats', Object.keys(dependencies))(...Object.values(dependencies))
    const component = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
    const script = parseVue(component).descriptor.scriptSetup.content
    const declaration = parseJavaScript(script, { sourceType: 'module' }).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'importUnifiedBackup')
    const messages = [], writes = []
    const bindings = {
      ...backupHelpers, mergeSearchHistoryEntries: (_current, entries) => entries,
      backupBusy: { value: false }, selectedBackupSections: { value: Object.keys(incoming) }, backupData: { value: incoming },
      process: { env: { IS_ELECTRON: false } }, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
      DBWatchStatsHandlers: WatchStats,
      DBProfileHandlers: { find: () => db.profiles.findAsync({}), upsert: async record => { writes.push('profiles'); return db.profiles.updateAsync({ _id: record._id }, record, { upsert: true }) } },
      DBPlaylistHandlers: { find: () => db.playlists.findAsync({}) },
      DBHistoryHandlers: { find: () => db.history.findAsync({}) },
      DBSearchHistoryHandlers: { find: () => db.searchHistory.findAsync({}) },
      store: { dispatch: async (action, value) => {
        if (action === 'updatePlaylist') { writes.push('playlists'); await db.playlists.updateAsync({ _id: value._id }, value, { upsert: true }); return true }
        if (action === 'overwriteHistory' || action === 'overwriteSearchHistory') { writes.push(action); return true }
      } },
      compactAllDatastores: async () => true, closeBackupImport() {}, t: key => key, showToast: toast => messages.push(toast),
    }
    const thumbnailHelpers = parseJavaScript(script, { sourceType: 'module' }).program.body.filter(node => node.type === 'FunctionDeclaration' && ['isJsonObject', 'normalizeImportedPlaylistThumbnail'].includes(node.id.name)).map(node => script.slice(node.start, node.end)).join('\n')
    const restore = compileFunction(thumbnailHelpers + '\nreturn ' + script.slice(declaration.start, declaration.end), Object.keys(bindings))(...Object.values(bindings))
    await restore()
    assert.match(messages.at(-1).message, /Conflicting retained watch[- ]stat/)
    assert.deepEqual(writes, [])
    for (const [name, records] of Object.entries(original)) assert.deepEqual(await db[name].findAsync({}).sort({ _id: 1 }), records.toSorted((a, b) => model.compareThings(a._id, b._id)))
    assert.equal(bindings.backupBusy.value, false)
  })
}


test('Electron watch-stat preflight is read-only and keeps the published merge payload unchanged', async () => {
  const { DBActions, IpcChannels, SyncEvents } = await import('../../src/constants.js')
  const db = { watchStats: new Datastore({ inMemoryOnly: true }) }
  const original = { _id: 'day', date: '2026-10-13', seconds: 5 }
  await db.watchStats.insertAsync(original)
  const base = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const dependencies = { db, model, ...backupHelpers }
  const WatchStats = compileFunction(base.slice(base.indexOf('class WatchStats {'), base.indexOf('class Profiles {')) + '\nreturn WatchStats', Object.keys(dependencies))(...Object.values(dependencies))
  const main = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
  const nodes = [parseJavaScript(main, { sourceType: 'module' }).program]
  let call
  while (nodes.length) {
    const node = nodes.pop()
    if (node.type === 'CallExpression' && node.callee.object?.name === 'ipcMain' &&
        node.callee.property?.name === 'handle' && node.arguments[0]?.property?.name === 'DB_WATCH_STATS') { call = node; break }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) nodes.push(...value.filter(entry => entry?.type))
      else if (value?.type) nodes.push(value)
    }
  }
  assert.ok(call, 'exercise the actual main-process watch-stat endpoint')
  const handlerNode = call.arguments[1]
  const broadcasts = []
  const bindings = { DBActions, IpcChannels, SyncEvents, baseHandlers: { watchStats: WatchStats }, isOpenTubeXUrl: () => true, syncOtherWindows: (...args) => broadcasts.push(args) }
  const endpoint = compileFunction('return ' + main.slice(handlerNode.start, handlerNode.end), Object.keys(bindings))(...Object.values(bindings))
  const renderer = await readFile(new URL('../../src/datastores/handlers/electron.js', import.meta.url), 'utf8')
  const classNode = parseJavaScript(renderer, { sourceType: 'module' }).program.body.find(node => node.type === 'ClassDeclaration' && node.id.name === 'WatchStats')
  const calls = []
  const RendererWatchStats = compileFunction(renderer.slice(classNode.start, classNode.end) + '\nreturn WatchStats', ['DBActions', 'dbWatchStats'])(DBActions, async (action, data) => {
    calls.push({ action, data })
    return endpoint({ senderFrame: { url: 'app://test' } }, { action, data })
  })
  const backup = { records: [{ date: original.date, seconds: 10 }], adjustment: null }
  assert.equal(await RendererWatchStats.validateBackup(backup), true)
  assert.deepEqual(await db.watchStats.findAsync({}), [original])
  assert.deepEqual(broadcasts, [])
  assert.deepEqual(calls, [{ action: DBActions.WATCH_STATS.VALIDATE_BACKUP, data: backup }])
  const retained = { _id: 'retained', date: null, seconds: 'unknown' }
  await assert.rejects(RendererWatchStats.validateBackup({ records: [retained, { ...retained }], adjustment: null }), /Duplicate retained watch statistics/)
  assert.deepEqual(await db.watchStats.findAsync({}), [original])
  assert.deepEqual(broadcasts, [])
  await RendererWatchStats.mergeBackup(backup)
  assert.deepEqual(calls.at(-1), { action: DBActions.WATCH_STATS.MERGE_BACKUP, data: backup })
  assert.equal(broadcasts.length, 1)
  assert.equal((await db.watchStats.findOneAsync({ _id: original._id })).seconds, 10)
})


test('foundation Save filtering displays retained names without modifying durable values', async () => {
  const db = new Datastore({ inMemoryOnly: true })
  const records = [undefined, null, false, 42, {}, [], new Date(1)].map((playlistName, index) => ({ _id: `retained-${index}`, ...(playlistName === undefined ? {} : { playlistName }), videos: [], unknown: new Date(index) }))
  await db.insertAsync(records)
  const component = await readFile(new URL('../../src/renderer/components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue', import.meta.url), 'utf8')
  const script = parseVue(component).descriptor.scriptSetup.content
  const ast = parseJavaScript(script, { sourceType: 'module' }).program.body
  const helper = ast.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'playlistDisplayName')
  const name = compileFunction('return ' + script.slice(helper.start, helper.end), ['t'])(key => key)
  const initializer = ast.find(node => node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'filteredPlaylists')).declarations.find(item => item.id.name === 'filteredPlaylists').init
  const filter = compileFunction('return ' + script.slice(initializer.start, initializer.end), ['computed', 'playlists', 'search', 'playlistDisplayName'])
  const saved = await db.findAsync({}).sort({ _id: 1 })
  assert.deepEqual(filter(callback => callback(), { value: saved }, { value: 'playlists' }, name), saved)
  assert.deepEqual(await db.findAsync({}).sort({ _id: 1 }), records)
})
