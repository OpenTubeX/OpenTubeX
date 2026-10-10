import { parentPort } from 'node:worker_threads'
import { getLibrary } from '../datastores/sqlite/instance.js'
import * as handlers from '../datastores/handlers/base.js'
import { LibraryExports } from '../datastores/sqlite/export.js'
import { LibrarySync } from '../datastores/sqlite/sync.js'
import { LibraryImports } from '../datastores/sqlite/import.js'
import { updateVideoMetadataCache, metadataPage, metadataThumbnail } from '../datastores/sqlite/metadata.js'
import * as operations from '../datastores/sqlite/operations.js'
import * as subscriptions from '../datastores/sqlite/subscriptions.js'

const operationMethods = new Set(['rendererSettings', 'syncSnapshotRead', 'syncSnapshotSummary', 'syncSnapshotHistory', 'storageUsage', 'historyRepairPage', 'historyRepairRecord', 'markAllHistory', 'applySubscriptionUnseenHistory', 'playlistSelection', 'addSelectedPlaylistVideos', 'removePlaylistMember', 'removePlaylistMembers', 'recommendationInputs', 'recommendationSubscriptionCandidates'])
const subscriptionMethods = new Set(['subscriptionEntries', 'subscriptionPremieres', 'updateSubscriptionPremieres', 'subscriptionShortsWindow', 'subscriptionSummaries', 'subscriptionPage', 'subscriptionEntry', 'markSubscriptionEntries'])

let exports
let imports
let sync

// One owner serializes complete transactions, rather than interleaving the
// individual read/modify/write calls from several windows or background jobs.
let pending = Promise.resolve()
parentPort.on('message', request => {
  pending = pending.catch(() => {}).then(async () => {
    const { id, target, method, args } = request
    try {
      const engine = await getLibrary()
      exports ??= new LibraryExports(engine)
      imports ??= new LibraryImports(engine)
      sync ??= new LibrarySync(engine)
      let result
      if (target === 'engine') {
        if (method === 'initialize') result = true
        else if (method === 'updateVideoMetadataCache') result = await engine.transaction(() => updateVideoMetadataCache(engine, args[0]))
        else if (method === 'metadataPage') result = await metadataPage(engine, args[0])
        else if (method === 'metadataThumbnail') result = metadataThumbnail(engine, args[0])
        else if (method === 'metadataSize') result = engine.prepare("SELECT coalesce(sum(length(data)), 0) AS bytes FROM record_blobs WHERE collection = 'videoMetadataCache'").get().bytes + engine.prepare("SELECT coalesce(sum(length(data)), 0) AS bytes FROM records WHERE collection = 'videoMetadataCache'").get().bytes
        else if (method === 'clearMetadata') result = await engine.collections.videoMetadataCache.removeAsync({}, { multi: true })
        else if (operationMethods.has(method)) result = await engine.transaction(() => operations[method](engine, args[0], handlers))
        else if (subscriptionMethods.has(method)) result = await engine.transaction(() => subscriptions[method](engine, args[0], handlers))
        else if (method.startsWith('syncHistory') || method.startsWith('syncPlaylist')) {
          const action = { syncHistoryStart: 'start', syncHistoryChunk: 'chunk', syncHistoryPlan: 'plan', syncHistoryPage: 'page', syncHistoryApply: 'apply', syncHistoryCancel: 'cancel', syncPlaylistStart: 'start', syncPlaylistChunk: 'chunk', syncPlaylistPlan: 'plan', syncPlaylistPage: 'page', syncPlaylistApply: 'apply', syncPlaylistCancel: 'cancel' }[method]
          if (!action) throw new Error('Unknown sync request')
          result = await engine.transaction(() => sync[action](args[0], handlers))
        } else if (method === 'exportStart') result = exports.start(...args)
        else if (method === 'exportNext') result = exports.next(...args)
        else if (method === 'exportCancel') result = exports.cancel(...args)
        else if (method === 'importStart') result = imports.start(...args)
        else if (method === 'importChunk') result = imports.chunk(...args)
        else if (method === 'importFinish') result = imports.finish(...args)
        else if (method === 'importApply') result = await imports.apply(args[0], handlers)
        else if (method === 'importCancel') result = imports.cancel(...args)
        else if (method === 'compact') {
          // A multi-call export pins a read snapshot. Preserve that job and
          // fail promptly instead of blocking its next chunk behind a vacuum.
          if (exports.jobs.size) throw new Error('Finish or cancel the current library export before compacting storage')
          result = engine.compact()
        } else if (method === 'checkpoint') { engine.database.exec('PRAGMA wal_checkpoint(PASSIVE)'); result = true } else if (['historyPage', 'playlistSummaries', 'playlistPage', 'videoState', 'historySummary', 'playlistSnapshot', 'playlistWindow', 'playlistStatistics', 'movePlaylistMember', 'cleanupPlaylist', 'reorderPlaylistMembers'].includes(method)) result = await engine[method](...args)
        else throw new Error('Unknown library request')
      } else {
        result = await engine.transaction(async () => {
          if (target.startsWith('handler:')) {
            const name = target.slice(8)
            const handler = Object.hasOwn(handlers, name) ? handlers[name] : null
            if (!handler || !Object.hasOwn(handler, method) || typeof handler[method] !== 'function') throw new Error('Unknown library handler')
            if (target === 'handler:subscriptionCache') {
              if (method === 'find') return subscriptions.subscriptionSummaries(engine)
              if (method === 'updateShortsWithChannelPageShortsByChannelId') return subscriptions.updateSubscriptionShortsMetadata(engine, { channelId: args[0], entries: args[1] })
              const field = { updateVideosByChannelId: 'videos', updateShortsByChannelId: 'shorts', updateLiveStreamsByChannelId: 'liveStreams', updateCommunityPostsByChannelId: 'communityPosts' }[method]
              if (field) return subscriptions.updateSubscriptionFeed(engine, { channelId: args[0], entries: args[1], timestamp: args[2], field })
            }
            return handler[method](...args)
          }
          const name = target.slice(11)
          if (!target.startsWith('collection:') || !Object.hasOwn(engine.collections, name)) throw new Error('Unknown library collection')
          const collection = engine.collections[name]
          if (method === 'find') {
            const [query, projection, options] = args
            const cursor = collection.findAsync(query, projection).sort(options.sort).skip(options.skip)
            if (options.limit !== null) cursor.limit(options.limit)
            return cursor
          }
          if (!['findOneAsync', 'countAsync', 'insertAsync', 'updateAsync', 'removeAsync'].includes(method)) throw new Error('Unknown collection request')
          return collection[method](...args)
        })
      }
      parentPort.postMessage({ id, result })
    } catch (error) { parentPort.postMessage({ id, error: { name: error.name, message: error.message, code: error.code, locale: error.locale, useAITranslationCompletions: error.useAITranslationCompletions, collection: error.collection, deleted: error.deleted, previous: error.previous, items: error.items } }) }
  })
})
