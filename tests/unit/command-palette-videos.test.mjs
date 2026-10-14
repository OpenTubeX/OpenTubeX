import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { babelParse, parse } from 'vue/compiler-sfc'
import assert from 'node:assert/strict'
import test from 'node:test'

import { hasDownloadSearchChanged, isLocalVideoMutation, iterateLocalVideoCommands } from '../../src/renderer/helpers/commandPaletteVideos.js'
import { filterCommandPaletteCommands, filterCommandPaletteCommandsAsync } from '../../src/renderer/helpers/commandPalette.js'

function registry(overrides = {}) {
  const navigations = []
  const removedItems = []
  const playedDownloads = []
  const commands = Array.from(iterateLocalVideoCommands({
    history: [],
    playlists: [],
    downloads: {},
    queue: [],
    group: 'Local videos',
    sources: { history: 'History', playlists: 'Playlists', downloads: 'Downloads', queue: 'Queue' },
    playLibraryVideo: (video, route) => navigations.push(route),
    playDownloadedVideo: (id, file) => playedDownloads.push({ id, file }),
    playQueuedVideo: route => navigations.push(route),
    removeQueuedVideo: id => removedItems.push(id),
    ...overrides,
  }))
  return { commands, navigations, removedItems, playedDownloads }
}

test('finds stored video titles, authors, IDs, and sources with fuzzy matching', () => {
  const { commands } = registry({
    history: [{ videoId: 'local123456', title: 'Résumé of a journey', author: 'North Channel' }],
  })
  for (const query of ['resume journey', 'nrth chanel', 'local123456', 'journey history']) {
    assert.equal(filterCommandPaletteCommands(commands, query, 'en-US').length, 1, query)
  }
  assert.equal(commands[0].detail, 'History · North Channel')
  assert.equal(commands[0].searchOnly, true)
})

test('keeps duplicate videos in each source and preserves the selected playlist item', () => {
  const video = { videoId: 'local123456', title: 'Journey', isShort: false }
  const { commands, navigations } = registry({
    history: [video],
    playlists: [{ _id: 'playlist-1', playlistName: 'Travel', videos: [
      { ...video, playlistItemId: 'first' }, { ...video, playlistItemId: 'second' },
    ] }],
  })
  assert.equal(commands.length, 3)
  assert.equal(new Set(commands.map(command => command.id)).size, 3)
  assert.equal(commands[2].detail, 'Playlists: Travel')
  commands[2].run()
  assert.deepEqual(navigations[0], {
    path: '/watch/local123456',
    query: { playlistId: 'playlist-1', playlistType: 'user', playlistItemId: 'second', short: 'false' },
  })
  commands[0].run()
  assert.deepEqual(navigations[1], { path: '/watch/local123456', query: { short: 'false' } })
})

test('history playback respects the saved-playlist setting and reads current context', () => {
  const video = {
    videoId: 'local123456', title: 'Journey', isShort: false,
    lastViewedPlaylistId: 'playlist-1', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'first',
  }
  for (const enabled of [true, false]) {
    const { commands, navigations } = registry({ history: [video], saveVideoHistoryWithLastViewedPlaylist: enabled })
    commands[0].run()
    assert.deepEqual(navigations[0], {
      path: '/watch/local123456',
      query: { short: 'false', ...(enabled ? {
        playlistId: 'playlist-1', playlistType: 'user', playlistItemId: 'first',
      } : {}) },
    })
    video.lastViewedPlaylistItemId = 'second'
    commands[0].run()
    assert.equal(navigations[1].query.playlistItemId, enabled ? 'second' : undefined)
    video.lastViewedPlaylistItemId = 'first'
  }
})

test('searches available download files and delegates playback of the selected file', () => {
  const { commands, playedDownloads } = registry({
    downloads: {
      42: { id: 42, title: 'Downloaded playlist', status: 'completed', mode: 'video', playlistKey: 'saved-playlist', files: [
        { videoId: 'first', title: 'First journey', author: 'North Channel' },
        { videoId: 'second', title: 'Second journey' },
        { videoId: 'deleted', title: 'Deleted journey', available: false },
      ] },
      43: { id: 43, videoId: 'audio', title: 'Audio journey', author: 'South Channel', status: 'completed', mode: 'audio', files: [{ videoId: 'audio' }] },
      44: { id: 44, title: 'Metadata journey', mode: 'info', files: [{ videoId: 'info' }] },
      45: { id: 45, title: 'Pending journey', mode: 'video', files: [] },
    },
  })
  assert.deepEqual(commands.map(command => command.label), ['First journey', 'Second journey', 'Audio journey'])
  assert.equal(commands[0].detail, 'Downloads · North Channel')
  assert.equal(commands[2].detail, 'Downloads · South Channel')
  commands[1].run()
  assert.deepEqual(playedDownloads[0], { id: 42, file: { videoId: 'second', title: 'Second journey' } })
})

test('untitled playlist downloads use each file name or ID rather than the aggregate title', () => {
  const { commands } = registry({ downloads: {
    42: { id: 42, status: 'completed', mode: 'video', title: 'Whole playlist', files: [
      { videoId: 'first', path: '/downloads/First journey.webm' },
      { videoId: 'second', path: 'C:\\downloads\\Second journey.mp4' },
      { videoId: 'third' },
    ] },
    43: { id: 43, status: 'completed', mode: 'audio', title: 'Audio journey', videoId: 'audio', files: [{ videoId: 'audio' }] },
  } })
  assert.deepEqual(commands.map(command => command.label), ['First journey', 'Second journey', 'third', 'Audio journey'])
})

test('normalized-empty streaming queries never read library metadata', async () => {
  let reads = 0
  function * commands() {
    reads++
    yield { label: 'Journey', group: 'Local videos', localVideo: true }
  }
  assert.deepEqual(await filterCommandPaletteCommandsAsync(commands(), '\u0301', 'en-US', () => false), [])
  assert.equal(reads, 0)
})

test('removes only the selected queue entry and retains its saved route', () => {
  const route = { path: '/watch/queued', query: { downloadId: '42', short: 'true' } }
  const { commands, navigations, removedItems } = registry({
    queue: [{ videoId: 'queued', title: 'Queued journey', queueItemId: 7, route }],
  })
  commands[0].run()
  assert.deepEqual(removedItems, [7])
  assert.deepEqual(navigations, [route])
})

test('offers downloaded files only once local playback accepts their status', () => {
  for (const status of ['queued', 'downloading', 'processing', 'failed', 'cancelled', 'completed']) {
    const { commands } = registry({
      downloads: { 42: { id: 42, status, mode: 'video', files: [{ videoId: 'saved', available: true }] } },
    })
    assert.equal(commands.length, status === 'completed' ? 1 : 0, status)
  }
})

test('does not offer external downloads as YouTube watch-page results on desktop', () => {
  const { commands } = registry({ downloads: { 42: {
    id: 42, status: 'completed', mode: 'video', retryPayload: { externalUrl: 'https://vimeo.com/123456' },
    files: [{ videoId: '123456', title: 'External video', extension: 'mp4', path: '/downloads/external.mp4' }],
  } } })
  assert.deepEqual(commands, [])
})

test('respects the existing iOS playable-file filter', () => {
  const previous = process.env.IS_IOS
  process.env.IS_IOS = 'true'
  try {
    const { commands } = registry({
      downloads: { 42: { id: 42, status: 'completed', mode: 'video', files: [
        { videoId: 'supported', extension: 'mp4' },
        { videoId: 'unsupported', extension: 'webm' },
      ] } },
    })
    assert.deepEqual(commands.map(command => command.label), ['supported'])
  } finally {
    if (previous === undefined) delete process.env.IS_IOS
    else process.env.IS_IOS = previous
  }
})

test('iOS native downloads without YouTube IDs remain searchable by their file titles', () => {
  const previous = process.env.IS_IOS
  process.env.IS_IOS = 'true'
  try {
    const { commands, playedDownloads } = registry({ downloads: { 42: {
      id: 42, videoId: '', title: 'Aggregate title', status: 'completed', mode: 'video',
      retryPayload: { externalUrl: 'https://vimeo.com/123' },
      files: [{ videoId: '', path: '/downloads/Native file.mp4', extension: 'mp4', available: true }],
    } } })
    assert.equal(commands[0].label, 'Native file')
    commands[0].run()
    assert.equal(playedDownloads[0].file.path, '/downloads/Native file.mp4')
  } finally {
    if (previous === undefined) delete process.env.IS_IOS
    else process.env.IS_IOS = previous
  }
})

test('skips entries without video IDs and falls back to the ID when the title is missing', () => {
  const { commands, navigations } = registry({
    history: [{ title: 'Missing ID' }, { videoId: 'local123456' }],
    queue: [{ videoId: 'queue123456', queueItemId: 8 }],
  })
  assert.deepEqual(commands.map(command => command.label), ['local123456', 'queue123456'])
  commands[1].run()
  assert.deepEqual(navigations[0], { path: '/watch/queue123456', query: {} })
})

test('limits broad local video matches after ranking the entire library, preserving actions', () => {
  const { commands } = registry({
    history: Array.from({ length: 100 }, (_, index) => ({
      videoId: `video${index}`, title: index === 99 ? 'Journey' : `Journey ${index}`,
    })),
  })
  const action = { id: 'action', label: 'Journey', group: 'Navigation' }
  const matches = filterCommandPaletteCommands([...commands, action], 'journey', 'en-US')
  assert.equal(matches.length, 51)
  assert.equal(matches[0], action)
  assert.equal(matches[1].label, 'Journey')
  assert.equal(filterCommandPaletteCommands(commands, 'video98', 'en-US')[0].label, 'Journey 98')
})

test('cooperative search preserves ranking and allows a newer query to cancel old work', async () => {
  const { commands } = registry({
    history: Array.from({ length: 2000 }, (_, index) => ({
      videoId: `video${index}`, title: `Journey through the mountains ${index}`, author: 'North Channel',
    })),
  })
  let yieldedToInput = false
  const pending = filterCommandPaletteCommandsAsync(commands, 'jorney nrth', 'en-US')
  setTimeout(() => { yieldedToInput = true }, 0)
  assert.deepEqual(await pending, filterCommandPaletteCommands(commands, 'jorney nrth', 'en-US'))
  assert.equal(yieldedToInput, true)
  let cancellationChecks = 0
  assert.equal(await filterCommandPaletteCommandsAsync(commands, 'jorney', 'en-US', () => ++cancellationChecks > 2), null)
})

test('cancelled streaming searches stop reading metadata before scanning the library', async () => {
  let titleReads = 0
  const context = {
    history: Array.from({ length: 10000 }, (_, index) => ({
      videoId: `video${index}`,
      get title() { titleReads++; return 'Mountain journey' },
    })),
    playlists: [], downloads: {}, queue: [], group: 'Local videos',
    sources: { history: 'History' }, navigate() {}, removeQueuedVideo() {},
  }
  const commands = iterateLocalVideoCommands(context)
  assert.equal(titleReads, 0)
  let cancellationChecks = 0
  assert.equal(await filterCommandPaletteCommandsAsync(commands, 'mountain', 'en-US', () => ++cancellationChecks > 3), null)
  assert.ok(titleReads > 0 && titleReads < 10)
})

test('metadata mutations refresh results while playback progress does not', () => {
  for (const type of ['upsertToHistoryCache', 'applyPlaylistMetadataRepairs', 'upsertPlaylistToList', 'removeVideos', 'setAllPlaylists', 'addVideoToWatchQueue', 'removeYtDlpDownload']) {
    assert.equal(isLocalVideoMutation(type), true, type)
  }
  for (const type of ['updateRecordWatchProgressInHistoryCache', 'updateRecordLastViewedPlaylistIdInHistoryCache', 'addOpenPrompt']) {
    assert.equal(isLocalVideoMutation(type), false, type)
  }
})

test('download byte-count updates do not invalidate search, but file metadata changes do', () => {
  const download = { id: 42, title: 'Journey', status: 'downloading', mode: 'video', files: [{ videoId: 'local123456', title: 'Mountain journey', author: 'North Channel', available: true }] }
  const progress = { ...download, status: 'downloading', progress: 90, files: download.files.map(file => ({ ...file })) }
  assert.equal(hasDownloadSearchChanged(download, progress), false)
  for (const fields of [{ title: 'Renamed file' }, { author: 'Other channel' }, { available: false }, { videoId: 'other' }, { extension: 'webm' }, { path: '/renamed.webm' }]) {
    assert.equal(hasDownloadSearchChanged(download, { ...progress, files: [{ ...download.files[0], ...fields }] }), true)
  }
  assert.equal(hasDownloadSearchChanged(download, { ...progress, playlistKey: 'saved' }), true)
  assert.equal(hasDownloadSearchChanged(download, { ...progress, retryPayload: { externalUrl: 'https://vimeo.com/123' } }), true)
  assert.equal(hasDownloadSearchChanged(download, { ...progress, status: 'completed' }), true)
  assert.equal(hasDownloadSearchChanged(download, { ...progress, files: [] }), true)
  assert.equal(hasDownloadSearchChanged(undefined, download), true)
})

test('saved local video commands preserve occurrence identity and skip opaque memberships', () => {
  const run = [], video = { videoId: 'same', title: 'Exact member', playlistItemId: 'legacy', _libraryMemberId: 'member-id' }
  const context = { history: [], playlists: [{ _id: 'scalar', videos: null }, { _id: 'p', playlistName: 'Name', videos: [null, { retained: true }, video] }], downloads: {}, queue: [], group: 'Local videos', sources: { playlists: 'Playlists' }, playLibraryVideo: (...args) => run.push(args) }
  const commands = [...iterateLocalVideoCommands(context)]
  assert.equal(commands.length, 1)
  commands[0].run()
  assert.deepEqual(run[0][1], { path: '/watch/same', query: { playlistId: 'p', playlistType: 'user', libraryMemberId: 'member-id', playlistItemId: 'legacy' } })
})

async function paletteSearchController(bindings) {
  const text = await readFile(new URL('../../src/renderer/components/FtCommandPalette/FtCommandPalette.vue', import.meta.url), 'utf8')
  const script = parse(text).descriptor.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const registration = ast.program.body.find(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'watch' && node.expression.arguments[0]?.type === 'ArrayExpression')
  const callback = registration.expression.arguments[1]
  const context = vm.createContext({ videoMatches: { value: [] }, searchPending: { value: false }, toRaw: value => value,
    iterateLocalVideoCommands, filterCommandPaletteCommandsAsync, setTimeout, console, ...bindings })
  return { context, search: vm.runInContext(script.slice(callback.start, callback.end), context) }
}

const emptyVideoSources = { history: [], playlists: [], downloads: {}, queue: [], group: 'Local videos', sources: { history: 'History', playlists: 'Playlists' }, playLibraryVideo() {} }

test('the palette searches bounded storage metadata instead of requiring full renderer caches', async () => {
  const requests = [], video = { videoId: 'hidden', title: 'Hidden destination' }
  const sources = { ...emptyVideoSources, loadLibrarySources: async (...args) => { requests.push(args); return { history: [video], playlists: [] } } }
  const { context, search } = await paletteSearchController()
  await search(['hidden', sources, 'en-US'], [], () => {})
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], ['hidden', 'en-US', 'Local videos', sources.sources])
  assert.equal(context.videoMatches.value.length, 1)
  assert.equal(context.videoMatches.value[0].label, video.title)
  assert.equal(context.searchPending.value, false)
})

for (const stale of [false, true]) {
  test(`palette storage rejection ${stale ? 'cannot publish over a newer search' : 'clears the loader and reports the failure'}`, async () => {
    const pending = Promise.withResolvers(), called = Promise.withResolvers(), errors = [], toasts = []
    const { context, search } = await paletteSearchController({ console: { error: error => errors.push(error) }, t: key => key, showToast: toast => toasts.push(toast) })
    const sources = { ...emptyVideoSources, loadLibrarySources: () => { called.resolve(); return pending.promise } }
    let dispose
    const loading = search(['hidden', sources, 'en-US'], [], callback => { dispose = callback })
    await called.promise
    if (stale) { dispose(); context.videoMatches.value = ['newer']; context.searchPending.value = true }
    pending.reject(new Error('storage unavailable'))
    await loading
    assert.equal(context.searchPending.value, stale)
    assert.deepEqual(Array.from(context.videoMatches.value), stale ? ['newer'] : [])
    assert.equal(errors.length, stale ? 0 : 1)
    assert.equal(toasts.length, stale ? 0 : 1)
  })
}
