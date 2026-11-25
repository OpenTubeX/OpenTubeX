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
results.push(await measure('History retention cleanup (10,000 of 20,000 entries)', async root => {
  const handlers = await datastoreHandlers(root)
  await handlers.db.history.insertAsync(videos)
  await handlers.db.recommendations.insertAsync(videos.slice(0, 1000).map(video => ({ _id: video.videoId })))
  return handlers
}, handlers => handlers.History.deleteOlderThan(size / 2), async (handlers, removed) => {
  assert.equal(removed.length, size / 2)
  assert.equal(await handlers.db.history.countAsync({}), size / 2)
  assert.equal(await handlers.db.recommendations.countAsync({ _id: { $ne: 'meta' } }), 0)
}))
results.push(await measure('Bulk history update (1,000 of 20,000 entries)', async root => {
  const handlers = await datastoreHandlers(root)
  await handlers.db.history.insertAsync(videos)
  await handlers.History.find()
  return handlers
}, handlers => handlers.History.updateSubscriptionState({ records: videos.slice(0, 1000).map(video => ({ ...video, isWatched: true })) }), async handlers => {
  assert.equal(await handlers.db.history.countAsync({ isWatched: true }), 1000)
  assert.equal(await handlers.db.history.countAsync({}), size)
}))
results.push(await measure('Fuzzy history search (20,000 entries)', () => videos,
  (entries, root) => searchModules.get(root).filterVideosWithQuery(entries, 'troubleshootnig'), (_fixture, matches) => {
    assert.equal(matches.length, size)
  }))

const report = { roots, size, warmups: 1, samples: 7, results }
console.log(JSON.stringify(report, null, 2))
if (output) await writeFile(output, JSON.stringify(report, null, 2))
