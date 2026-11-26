import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { datastoreHandlers, playlistStore, repositoryRoot } from '../../tests/helpers/library-performance.mjs'

const roots = [process.argv[2], process.argv[3]].map(root => path.resolve(root ?? repositoryRoot))
const output = process.argv[4]
const searchModules = new Map(await Promise.all(roots.map(async root => [
  root, await import(pathToFileURL(path.join(root, 'src/renderer/helpers/historySearch.js'))),
])))
const size = 20000
const videos = Array.from({ length: size }, (_, index) => ({
  videoId: `video-${index}`,
  playlistItemId: `item-${index}`,
  title: `Practical troubleshooting techniques episode ${index}`,
  author: 'Example Channel',
  timeWatched: index,
}))
const removedIds = videos.slice(0, size / 2).map(video => video.playlistItemId)
// History saves the watch page's HTML description, usually with chapters and links.
const description = index => [
  `In episode ${index} we walk through practical troubleshooting techniques for home networks, from checking cables to reading router logs.`,
  'Chapters:',
  ...Array.from({ length: 12 }, (_, chapter) => {
    const seconds = chapter * 95
    return `<a href="https://www.youtube.com/watch?v=video-${index}&amp;t=${seconds}s">${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}</a> Step ${chapter + 1}: isolating the fault`
  }),
  'Links mentioned in this video:',
  ...Array.from({ length: 6 }, (_, link) => `<a href="https://example.com/guides/${index}/${link}">https://example.com/guides/${index}/${link}</a>`),
  'Support the channel to get early access to new episodes and the archive of past live streams. 😀',
].join('<br>')
const historyVideos = videos.map(({ playlistItemId: _playlistItemId, ...video }, index) => ({
  ...video,
  authorId: 'UCexampleexampleexample1',
  description: description(index),
  lengthSeconds: 1200,
  watchProgress: 600,
  isWatched: false,
  type: 'video',
}))

/**
 * The desktop history datastore of `root`, which the main process reads, as
 * it opens on a start after an earlier version saved `records`. On a later
 * start, it opened once before.
 */
async function historyDatastore(root, records, start) {
  const [{ SqliteDatastore }, { createNodeSqliteDriver }, options] = await Promise.all([
    import(pathToFileURL(path.join(root, 'src/datastores/sqlite.js'))),
    import(pathToFileURL(path.join(root, 'src/datastores/sqliteNode.js'))),
    import(pathToFileURL(path.join(root, 'src/datastores/datastoreOptions.js')))
      .then(module => module.DATASTORE_OPTIONS.history, () => ({ indexes: ['videoId', 'lastViewedPlaylistId'] })),
  ])
  const driver = createNodeSqliteDriver(':memory:')
  await new SqliteDatastore({ driver, indexes: options.indexes }).insertAsync(records)
  if (start === 'later') await new SqliteDatastore({ ...options, driver }).loadDatabaseAsync()
  return new SqliteDatastore({ ...options, driver })
}

async function measure(name, setup, action, verify) {
  const samples = [[], []]
  for (let iteration = 0; iteration < 8; iteration++) {
    // Alternate before/after order to reduce warm-up and load bias. Setup and
    // correctness assertions are excluded from the measured operation.
    for (const target of iteration % 2 ? [1, 0] : [0, 1]) {
      const fixture = await setup(roots[target])
      const start = performance.now()
      const result = await action(fixture, roots[target])
      const elapsed = performance.now() - start
      await verify(fixture, result)
      if (iteration > 0) samples[target].push(elapsed)
    }
  }
  const [before, after] = samples.map(values => {
    values.sort((a, b) => a - b)
    return { medianMs: values[Math.floor(values.length / 2)], samplesMs: values }
  })
  const reductionPercent = (before.medianMs - after.medianMs) / before.medianMs * 100
  console.log(`${name}: ${before.medianMs.toFixed(2)} ms -> ${after.medianMs.toFixed(2)} ms (${reductionPercent.toFixed(1)}% less time)`)
  return { name, before, after, reductionPercent }
}

const results = []
results.push(await measure('Playlist metadata update (20,000 saved videos)', async root => {
  const store = await playlistStore(root)
  store.commit('setAllPlaylists', [{ _id: 'playlist', videos }])
  return store
}, store => store.commit('upsertPlaylistToList', { _id: 'playlist', lastPlayedAt: 123 }), store => {
  assert.equal(store.getters.getPlaylist('playlist').lastPlayedAt, 123)
  assert.equal(store.getters.getPlaylistVideoCounts.size, size)
}))
results.push(await measure('Playlist bulk removal (10,000 of 20,000 entries)', async root => {
  const handlers = await datastoreHandlers(root)
  await handlers.db.playlists.insertAsync({ _id: 'playlist', videos })
  return handlers
}, handlers => handlers.Playlists.deleteVideoIdsByPlaylistId('playlist', 123, removedIds), async handlers => {
  const playlist = await handlers.db.playlists.findOneAsync({ _id: 'playlist' })
  assert.deepEqual(playlist.videos.map(video => video.playlistItemId), videos.slice(size / 2).map(video => video.playlistItemId))
  assert.equal(playlist.lastUpdatedAt, 123)
}))
// Records saved before history shortened descriptions, which the first start
// shortens, and records as each version saves them
for (const [saved, start] of [['saved before the limit', 'first'], ['saved before the limit', 'later'], ['saved by each version', 'later']]) {
  results.push(await measure(`History load with descriptions ${saved}, ${start} start (20,000 entries)`, async root => {
    const { migrateLegacyHistoryRecord } = await import(pathToFileURL(path.join(root, 'src/history.js')))
    return historyDatastore(root, saved === 'saved before the limit' ? historyVideos : historyVideos.map(migrateLegacyHistoryRecord), start)
  }, async store => {
    // Opening the database, then the main process reads the stored JSON, and each window parses it.
    const serialized = await store.findSerializedAsync()
    return serialized.map(record => JSON.parse(record))
  }, (store, records) => {
    store.driver.close()
    assert.equal(records.length, size)
  }))
}
results.push(await measure('History retention cleanup (10,000 of 20,000 entries)', async root => {
  const handlers = await datastoreHandlers(root)
  await handlers.db.history.insertAsync(historyVideos)
  await handlers.db.recommendations.insertAsync(videos.slice(0, 1000).map(video => ({ _id: video.videoId })))
  return handlers
}, handlers => handlers.History.deleteOlderThan(size / 2), async (handlers, removed) => {
  assert.equal(removed.length, size / 2)
  assert.equal(await handlers.db.history.countAsync({}), size / 2)
  assert.equal(await handlers.db.recommendations.countAsync({ _id: { $ne: 'meta' } }), 0)
}))
results.push(await measure('Bulk history update (1,000 of 20,000 entries)', async root => {
  const handlers = await datastoreHandlers(root)
  await handlers.db.history.insertAsync(historyVideos)
  await handlers.History.find()
  return handlers
}, handlers => handlers.History.updateSubscriptionState({ records: historyVideos.slice(0, 1000).map(video => ({ ...video, isWatched: true })) }), async handlers => {
  assert.equal(await handlers.db.history.countAsync({ isWatched: true }), 1000)
  assert.equal(await handlers.db.history.countAsync({}), size)
}))
results.push(await measure('Fuzzy history search (20,000 entries)', () => historyVideos,
  (entries, root) => searchModules.get(root).filterVideosWithQuery(entries, 'troubleshootnig'), (_fixture, matches) => {
    assert.equal(matches.length, size)
  }))

const report = { roots, size, warmups: 1, samples: 7, results }
console.log(JSON.stringify(report, null, 2))
if (output) await writeFile(output, JSON.stringify(report, null, 2))
