import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { strToU8, zipSync } from 'fflate'
import { previewBackupImport, previewTakeoutImport, parseTakeoutWatchHistory } from '../../src/renderer/helpers/import-preview.js'
import { mergeBackupProfile, mergeBackupPlaylist, mergeBackupHistory } from '../../src/renderer/helpers/unifiedBackup.js'
import { importTakeoutPlaylist } from '../../src/renderer/helpers/takeout-playlist-import.js'
import { forEachTakeoutImportEntry, listYouTubeTakeoutZipEntries } from '../../src/renderer/helpers/youtube-takeout-zip.js'

const counts = row => [row.added, row.existing, row.skipped]

test('backup preview counts distinct identities and subscription memberships without changing data', () => {
  const data = {
    settings: { uiScale: 125, unknown: true, syncServerToken: 'private' },
    profiles: [{ _id: 'primary', subscriptions: [{ id: 'old' }, { id: 'new' }] }, { _id: 'new', subscriptions: [{ id: 'new' }] }],
    playlists: [{ _id: 'same' }, { _id: 'new' }],
    history: [{ videoId: 'old' }, { videoId: 'new' }, { videoId: 'new' }],
    searchHistory: [{ _id: 'different-id', query: 'query' }, { _id: 'filters', query: 'query', searchSettings: { type: 'video' } }],
    watchStats: { records: [{ date: '2026-10-01' }, { date: '2026-10-02' }], adjustment: null },
  }
  const current = {
    settings: { uiScale: 100 },
    profiles: [{ _id: 'primary', subscriptions: [{ id: 'old' }] }],
    playlists: [{ _id: 'same' }],
    history: [{ videoId: 'old' }],
    searchHistory: [{ _id: 'original-id', query: 'query' }],
    watchStats: [{ date: '2026-10-01' }],
  }
  const before = structuredClone({ data, current })
  const rows = previewBackupImport(data, current)
  assert.deepEqual(rows.map(counts), [[0, 1, 2], [1, 1, 0], [2, 1, 0], [1, 1, 0], [1, 1, 0], [1, 1, 0], [1, 1, 0]])
  assert.deepEqual({ data, current }, before)
})

test('Takeout preview matches import names, empty playlists, deduplication, filters and excluded history', async () => {
  const watched = videoId => ({ products: ['YouTube'], title: 'Watched video', titleUrl: `https://www.youtube.com/watch?v=${videoId}`, time: '2025-01-01T00:00:00Z' })
  const searched = settings => ({ products: ['YouTube'], titleUrl: 'https://www.youtube.com/results?search_query=query', time: '2025-01-01T00:00:00Z', searchSettings: settings })
  const file = new Blob([zipSync({
    'Account/subscriptions/subscriptions.csv': strToU8('Channel Id,Channel Url,Channel Title\nold,url,Old\nnew,url,"New, channel"\nnew,url,Duplicate\n'),
    'Account/history/watch-history.json': strToU8(JSON.stringify([
      watched('abcdefghijk'), watched('abcdefghijk'), watched('lmnopqrstuv'),
      { ...watched('adadadadada'), details: [{}] }, { products: ['YouTube'], title: 'Deleted' },
      { ...watched('otherproduct'), products: ['Google Search'] }, { ...watched('invalidtime'), time: 'invalid' },
    ])),
    'Account/history/search-history.json': strToU8(JSON.stringify([
      searched(), searched(), searched({ type: 'video' }), { ...searched(), time: 'invalid' },
      { ...searched(), details: [{}] }, { products: ['YouTube'], title: 'Removed search' },
      { ...searched(), products: ['Google Search'] },
    ])),
    'Account/playlists/List-videos.csv': strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    'Another/playlists/List-videos.csv': strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    'Account/playlists/playlists.csv': strToU8('Playlist ID,Playlist Title (Original)\nPLlist,List\nPLempty,Empty\nPLreserved,List (2)\n'),
    'Broken/history/search-history.json': strToU8('{broken'),
    'Account/videos/unrelated.mp4': new Uint8Array(128),
  })])
  const entries = await listYouTubeTakeoutZipEntries(file)
  const current = { subscriptions: [{ id: 'old' }], playlists: [{ playlistName: 'List' }], history: [{ videoId: 'abcdefghijk' }], searchHistory: [{ _id: 'id', query: 'query' }] }
  const before = structuredClone(current)
  const rows = await previewTakeoutImport(file, entries, current)
  assert.deepEqual(counts(rows.find(row => row.category === 'subscriptions')), [1, 1, 0])
  assert.deepEqual(counts(rows.find(row => row.category === 'history')), [1, 1, 1])
  assert.deepEqual(counts(rows.find(row => row.category === 'searchHistory')), [1, 1, 1])
  assert.equal(rows.find(row => row.category === 'searchHistory').failedFiles, 1)
  assert.deepEqual(counts(rows.find(row => row.category === 'playlists')), [3, 1, 0])
  const names = []
  await forEachTakeoutImportEntry(file, new Set(['playlists']), entries, entry => names.push(entry.playlist.playlistName), error => { throw error })
  assert.deepEqual(names, ['List', 'List (3)', 'Empty', 'List (2)'])
  assert.deepEqual(current, before)
})

test('Takeout preview reports unsupported playlist files while preserving usable accounts', async () => {
  const file = new Blob([zipSync({
    'Bad/playlists/playlists.csv': strToU8('wrong header\n'),
    'Bad/playlists/Broken-videos.csv': strToU8('wrong header\n'),
    'Good/playlists/playlists.csv': strToU8('Playlist ID,Playlist Title (Original)\nPLempty,Empty\n'),
  })])
  const rows = await previewTakeoutImport(file, await listYouTubeTakeoutZipEntries(file), { playlists: [] })
  assert.deepEqual(counts(rows[0]), [1, 0, 0])
  assert.equal(rows[0].failedFiles, 2)
})

const component = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')

function componentSection(startMarker, endMarker) {
  const start = component.indexOf(startMarker)
  const end = component.indexOf(endMarker)
  assert.ok(start >= 0, `Missing component section start: ${startMarker}`)
  assert.ok(end > start, `Missing or misplaced component section end: ${endMarker}`)
  return component.slice(start, end)
}

test('Takeout selection opens before decoding and previews only selected categories', async () => {
  const file = { name: 'large-history.zip' }
  const entries = [{ type: 'history', path: 'history/watch-history.json' }, { type: 'subscriptions', path: 'subscriptions/subscriptions.csv' }]
  const previewCalls = []
  const reads = []
  const errors = []
  const context = vm.createContext({
    ref: value => ({ value }), shallowRef: value => ({ value }), computed: getter => ({ get value() { return getter() } }),
    pickFileWithPicker: async () => file, listYouTubeTakeoutZipEntries: async () => entries,
    readImportState: async categories => { reads.push(categories); return {} },
    primaryProfile: { value: { subscriptions: [] } }, IMPORT_DIRECTORY_ID: '', START_IN_DIRECTORY: '',
    t: key => key, showToast: error => errors.push(error),
    previewTakeoutImport: async (_file, selected) => {
      previewCalls.push(selected)
      return selected.map(entry => ({ category: entry.type, added: 1, existing: 0, skipped: 0 }))
    },
  })
  vm.runInContext(componentSection('const showTakeoutImport =', 'async function importSelectedTakeoutData()'), context)
  await context.selectTakeoutZip()
  assert.equal(vm.runInContext('showTakeoutImport.value', context), true)
  assert.equal(previewCalls.length, 0, 'Opening category selection must not parse history')
  assert.equal(reads.length, 0, 'Opening category selection must not load current history')
  vm.runInContext('selectedTakeoutTypes.value = ["subscriptions"]', context)
  await context.previewSelectedTakeoutData()
  assert.deepEqual(previewCalls, [[entries[1]]])
  assert.deepEqual(Array.from(reads[0]), [])
  assert.equal(vm.runInContext('takeoutPreviewReady.value', context), true)
  vm.runInContext('selectedTakeoutTypes.value.push("history")', context)
  assert.equal(vm.runInContext('takeoutPreviewReady.value', context), false, 'Newly selected categories need a preview before importing')
  assert.deepEqual(errors, [])
})

test('duplicate backup identities accumulate subscriptions and videos promised by the preview', async () => {
  const data = {
    profiles: ['A', 'B'].map(id => ({ _id: 'same-profile', name: 'Profile', subscriptions: [{ id }] })),
    playlists: ['A', 'B'].map(videoId => ({ _id: 'same-playlist', playlistName: 'Playlist', videos: [{ videoId, timeAdded: 100 }] })),
  }
  const rows = previewBackupImport(data, { profiles: [], playlists: [] })
  assert.equal(rows.find(row => row.unit).added, 2)
  const profiles = new Map()
  const playlists = new Map()
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: false } }, backupDisposed: false, backupImportGeneration: 0, backupWriteGeneration: null,
    backupBusy: { value: false }, backupData: { value: data }, selectedBackupSections: { value: ['profiles', 'playlists'] },
    DBProfileHandlers: { find: async () => [...profiles.values()], replaceIfUnchanged: async (previous, record) => { assert.deepEqual(previous, profiles.get(record._id)); profiles.set(record._id, record); return { numAffected: 1 } } },
    DBPlaylistHandlers: { find: async () => [...playlists.values()], replaceIfUnchanged: async (previous, record) => { assert.deepEqual(previous, playlists.get(record._id)); playlists.set(record._id, record); return { numAffected: 1 } } },
    mergeBackupProfile, mergeBackupPlaylist, normalizeImportedPlaylistThumbnail: async () => {},

    store: { dispatch: async (action, record) => { if (action === 'updatePlaylist') playlists.set(record._id, record); return true } },
    compactAllDatastores: async () => true, closeBackupImport() {}, showToast() {}, t: key => key,
  })
  vm.runInContext(componentSection('async function importUnifiedBackup()', 'const showTakeoutImport'), context)
  await context.importUnifiedBackup()
  assert.deepEqual(Array.from(profiles.get('same-profile').subscriptions, channel => channel.id), ['A', 'B'])
  assert.deepEqual(Array.from(playlists.get('same-playlist').videos, video => video.videoId), ['A', 'B'])
})

test('watch history with empty subtitles imports the record counted in the preview', async () => {
  const record = { products: ['YouTube'], title: 'Watched Example', titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk', time: '2025-01-01T00:00:00Z', subtitles: [] }
  const file = new Blob([zipSync({ 'Takeout/YouTube/history/watch-history.json': strToU8(JSON.stringify([record])) })])
  const rows = await previewTakeoutImport(file, await listYouTubeTakeoutZipEntries(file), { history: [] })
  assert.equal(rows[0].added, 1)
  let imported
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: false } }, DBHistoryHandlers: { find: async () => [] }, mergeBackupHistory,
    parseTakeoutWatchHistory, historyCacheById: { value: {} }, deepCopy: structuredClone,
    store: { dispatch: async (_action, records) => { imported = records; return true } }, showToast() {}, t: key => key,
  })
  vm.runInContext(componentSection('async function importYouTubeWatchHistory(', 'const showExportWatchHistoryPrompt'), context)
  await context.importYouTubeWatchHistory([record])
  const saved = Array.isArray(imported) ? imported.find(record => record.videoId === 'abcdefghijk') : imported.get('abcdefghijk')
  assert.equal(saved.isWatched, true)
  assert.equal(saved.author, '')
})

test('watch history parsing excludes malformed records from preview counts and preserves usable entries', () => {
  const valid = { products: ['YouTube'], title: 'Watched Example', titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk', time: '2025-01-01T00:00:00Z', subtitles: [] }
  const { entries, skipped } = parseTakeoutWatchHistory([valid, { ...valid, title: null }, { ...valid, time: 'invalid' }, { ...valid, details: [{}] }, null])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].videoId, 'abcdefghijk')
  assert.equal(skipped, 2)
})

test('preview reports existing generated playlist names as merge targets on repeated imports', async () => {
  const file = new Blob([zipSync({
    'First/playlists/List-videos.csv': strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    'Second/playlists/List-videos.csv': strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-01T00:00:00Z\n'),
  })])
  const paths = await listYouTubeTakeoutZipEntries(file)
  const playlists = { value: [
    { _id: 'first', playlistName: 'List', videos: [] },
    { _id: 'second', playlistName: 'List (2)', videos: [{ videoId: 'zzzzzzzzzzz', timeAdded: 10 }] },
  ] }
  const storage = {
    find: async () => playlists.value,
    create: async () => { assert.fail('Matching names must merge rather than create renamed duplicates') },
    update: async playlist => {
      const index = playlists.value.findIndex(saved => saved._id === playlist._id)
      assert.ok(index >= 0)
      playlists.value[index] = playlist
    },
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const preview = await previewTakeoutImport(file, paths, { playlists: playlists.value })
    assert.deepEqual(counts(preview[0]), [0, 2, 0])
    await forEachTakeoutImportEntry(file, new Set(['playlists']), paths, entry => importTakeoutPlaylist(entry.playlist, storage), error => { throw error })
    assert.equal(playlists.value.length, 2)
    assert.deepEqual(Array.from(playlists.value[1].videos, video => video.videoId), ['zzzzzzzzzzz', 'lmnopqrstuv'])
  }
})

test('oversized history is reported without preventing smaller subscription previews or imports', async () => {
  const archive = zipSync({
    'Takeout/YouTube/history/watch-history.json': strToU8('[]'),
    'Takeout/YouTube/subscriptions/subscriptions.csv': strToU8('Channel Id,Channel Url,Channel Title\nUCsmall,url,Small channel\n'),
  })
  new DataView(archive.buffer).setUint32(22, 256 * 1024 * 1024 + 1, true)
  const file = new Blob([archive])
  const paths = await listYouTubeTakeoutZipEntries(file)
  const rows = await previewTakeoutImport(file, paths, { history: [], subscriptions: [] })
  assert.equal(rows.find(row => row.category === 'history').failedFiles, 1)
  assert.equal(rows.find(row => row.category === 'subscriptions').added, 1)
  const imported = []
  const errors = []
  await forEachTakeoutImportEntry(file, new Set(['history', 'subscriptions']), paths, entry => imported.push(entry.type), (error, type) => errors.push(type))
  assert.deepEqual(imported, ['subscriptions'])
  assert.deepEqual(errors, ['history'])
})

test('unreadable playlist video files are not restored as empty metadata-only playlists', async () => {
  const archive = zipSync({
    'Takeout/YouTube/playlists/List-videos.csv': strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    'Takeout/YouTube/playlists/playlists.csv': strToU8('Playlist ID,Playlist Title (Original)\nPLlist,List\nPLempty,Empty\n'),
  })
  new DataView(archive.buffer).setUint32(22, 256 * 1024 * 1024 + 1, true)
  const file = new Blob([archive])
  const paths = await listYouTubeTakeoutZipEntries(file)
  const rows = await previewTakeoutImport(file, paths, { playlists: [] })
  assert.equal(rows[0].failedFiles, 1)
  assert.equal(rows[0].added, 1)
  const names = []
  await forEachTakeoutImportEntry(file, new Set(['playlists']), paths, entry => names.push(entry.playlist.playlistName), () => {})
  assert.deepEqual(names, ['Empty'])
})


test('backup preview tolerates retained opaque subscriptions without mutating them', () => {
  const profiles = [undefined, null, false, 'retained', [null, false, { unknown: new Date(1) }, { id: 'channel' }]].map((subscriptions, index) => ({ _id: String(index), subscriptions }))
  const before = structuredClone(profiles)
  const rows = previewBackupImport({ profiles }, { profiles })
  assert.deepEqual(counts(rows[0]), [0, profiles.length, 0])
  assert.equal(rows[1].added, 0)
  assert.deepEqual(profiles, before)
})


test('backup preview compares retained Date identities by value and keeps string IDs distinct', () => {
  const data = { history: [{ videoId: new Date(1) }, { videoId: 1 }, { videoId: '1' }] }
  const current = { history: [{ videoId: new Date(1) }, { videoId: '1' }] }
  const before = structuredClone({ data, current })
  assert.deepEqual(counts(previewBackupImport(data, current)[0]), [1, 2, 0])
  assert.deepEqual({ data, current }, before)
})
