import { filterVideosWithQuery } from '../../renderer/helpers/historySearch.js'
import { canMarkHistoryEntryAsWatched, isHistoryEntryWatched } from '../../history.js'
import { getContinueWatchingCandidates } from '../../renderer/helpers/homeSections.js'
import { getSortedPlaylistItems } from '../../renderer/helpers/playlists.js'
import model from '@seald-io/nedb/lib/model.js'

async function snapshotRevision(records) {
  // Offsets and positional IDs are safe only against their original snapshot.
  // Include unknown fields and Date types without storing another full copy
  // or introducing a new persisted format.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(model.serialize(records)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

// The same bounded query contract is used by native/browser persistence.
// These adapters retain their shipped storage until their SQLite migration
// has been verified on the corresponding platform.
export function createPortableLibrary({ history, playlists }) {
  let playlistOrder = null
  const newestHistory = async () => (await history.find()).toSorted((left, right) => model.compareThings(right.timeWatched, left.timeWatched) || model.compareThings(right._id, left._id))
  return {
    async query(method, options = {}) {
      if (method === 'playlistSummaries') return (await playlists.find()).map(playlist => ({ ...playlist, videoCount: Array.isArray(playlist.videos) ? playlist.videos.length : 0, firstVideo: Array.isArray(playlist.videos) ? playlist.videos[0] ?? null : null, videos: [] }))
      if (method === 'playlistImportCandidates') return (await playlists.find()).filter(playlist => playlist.playlistName === options.name).map(playlist => ({ _id: playlist._id, playlistName: playlist.playlistName, ...(Object.hasOwn(playlist, 'protected') ? { protected: playlist.protected } : {}) }))
      if (method === 'playlistVideoIds') {
        const playlist = (await playlists.find()).find(playlist => playlist._id === options.id)
        if (!playlist) throw new Error('The playlist no longer exists')
        return (Array.isArray(playlist.videos) ? playlist.videos : []).filter(video => typeof video?.videoId === 'string' && video.videoId).map(video => video.videoId)
      }
      if (method === 'playlistSnapshot') return (await playlists.find()).find(playlist => playlist._id === options.id) ?? null
      if (['playlistPage', 'playlistStatistics', 'movePlaylistMember', 'reorderPlaylistMembers', 'cleanupPlaylist'].includes(method)) {
        const playlist = (await playlists.find()).find(playlist => playlist._id === options.id)
        if (!playlist) throw new Error('The playlist no longer exists')
        // Retain unsupported legacy values on disk; queries expose an empty
        // membership view and no-op edits must not replace the saved shape.
        const videos = Array.isArray(playlist.videos) ? playlist.videos : []
        const revision = ['playlistPage', 'movePlaylistMember', 'reorderPlaylistMembers'].includes(method) ? await snapshotRevision(playlist.videos) : null
        const query = options.query?.trim().toLowerCase() ?? ''
        const view = JSON.stringify([options.id, options.sort ?? 'custom', query, options.locale ?? 'en-US', !!options.reverse])
        if (options.cursor && (options.cursor.revision !== revision || options.cursor.view !== view)) return { stale: true }
        const memberIndex = memberId => {
          const index = Number(memberId)
          if (typeof memberId !== 'string' || !Number.isSafeInteger(index) || String(index) !== memberId || index < 0 || index >= videos.length) throw new Error('The playlist member no longer exists')
          return index
        }
        const saveVideos = async videos => {
          const { numAffected } = await playlists.replaceVideosIfUnchanged(playlist._id, playlist.videos, videos, Date.now())
          if (!numAffected) throw new Error('The playlist changed; reload it before editing')
        }
        if (method === 'playlistStatistics') {
          const now = Date.now()
          let refreshAt = null
          const byId = new Map()
          for (const record of await newestHistory()) {
            if (!byId.has(record.videoId)) byId.set(record.videoId, record)
          }
          let duration = 0
          let missingDuration = 0
          let uniqueCount = 0
          const uniqueIds = new Set()
          for (const video of videos) {
            if (video !== null && typeof video === 'object' && ['string', 'number', 'boolean'].includes(typeof video.videoId)) {
              if (!uniqueIds.has(video.videoId)) { uniqueCount++; uniqueIds.add(video.videoId) }
            } else uniqueCount++
            if (video === null || typeof video !== 'object') {
              missingDuration++
              continue
            }
            const record = byId.get(video.videoId)
            if (record?.isUpcoming === true && record.premiereTimestamp != null) {
              const premiere = Number(record.premiereTimestamp) * 1000
              if (Number.isFinite(premiere) && premiere > now && isHistoryEntryWatched(record, premiere)) refreshAt = Math.min(refreshAt ?? premiere, premiere)
            }
            const seconds = Number.isFinite(video.lengthSeconds) && video.lengthSeconds > 0 ? video.lengthSeconds : byId.get(video.videoId)?.lengthSeconds
            if (Number.isFinite(seconds) && seconds > 0) duration += seconds
            else missingDuration++
          }
          return {
            total: videos.length,
            uniqueCount,
            duration,
            missingDuration,
            watchedCount: videos.filter(video => video !== null && typeof video === 'object' && isHistoryEntryWatched(byId.get(video.videoId))).length,
            ...(options.includeExpiry ? { refreshAt } : {}),
          }
        }
        if (method === 'movePlaylistMember') {
          if (options.revision !== revision) throw new Error('The playlist changed; reload it before reordering')
          if (![-1, 1, 'top', 'bottom'].includes(options.direction)) throw new Error('Invalid playlist move')
          const index = memberIndex(options.memberId)
          const playable = video => typeof video?.videoId === 'string' && video.videoId.length > 0
          if (options.playableOnly && !playable(videos[index])) throw new Error('The playlist member is not playable')
          const reordered = videos.slice()
          if (options.playableOnly && (options.direction === 'top' || options.direction === 'bottom')) {
            const positions = videos.flatMap((video, position) => playable(video) ? [position] : [])
            const source = positions.indexOf(index)
            const target = options.direction === 'top' ? 0 : positions.length - 1
            if (source === target) return false
            const ordered = positions.map(position => videos[position])
            const [member] = ordered.splice(source, 1)
            ordered.splice(target, 0, member)
            positions.forEach((position, offset) => { reordered[position] = ordered[offset] })
            await saveVideos(reordered)
            return true
          }
          let target = options.direction === 'top' ? 0 : options.direction === 'bottom' ? videos.length - 1 : index + options.direction
          if (options.direction === -1 || options.direction === 1) {
            const excluded = new Set(options.excludedMemberIds ?? [])
            while (target >= 0 && target < videos.length && (excluded.has(String(target)) || (options.playableOnly && !playable(videos[target])))) target += options.direction
          }
          if (target < 0 || target >= videos.length) return false
          if (options.direction === -1 || options.direction === 1) {
            [reordered[index], reordered[target]] = [reordered[target], reordered[index]]
          } else {
            const [member] = reordered.splice(index, 1)
            reordered.splice(target, 0, member)
          }
          await saveVideos(reordered)
          return true
        }
        if (method === 'reorderPlaylistMembers') {
          if (options.revision !== revision) throw new Error('The playlist changed; reload it before reordering')
          if (!Array.isArray(options.memberIds) || new Set(options.memberIds).size !== options.memberIds.length) throw new Error('Invalid playlist member order')
          if (options.memberIds.length === 0) return false
          const positions = options.memberIds.map(memberIndex).toSorted((a, b) => a - b)
          const ordered = options.memberIds.map(id => videos[Number(id)])
          const reordered = videos.slice()
          positions.forEach((position, index) => { reordered[position] = ordered[index] })
          await saveVideos(reordered)
          return true
        }
        if (method === 'cleanupPlaylist') {
          if (!['watched', 'duplicates'].includes(options.mode)) throw new Error('Invalid playlist cleanup mode')
          const byId = new Map()
          for (const record of await newestHistory()) {
            if (!byId.has(record.videoId)) byId.set(record.videoId, record)
          }
          const unique = new Set()
          const remaining = videos.filter(video => {
            if (video === null || typeof video !== 'object') return true
            if (options.mode === 'watched') return !isHistoryEntryWatched(byId.get(video.videoId))
            if (!['string', 'number', 'boolean'].includes(typeof video.videoId)) return true
            if (unique.has(video.videoId)) return false
            unique.add(video.videoId)
            return true
          })
          const removed = videos.length - remaining.length
          if (!removed) return 0
          const retained = new Set(remaining)
          const removedVideoIds = [...new Set(videos.filter(video => !retained.has(video) && ['string', 'number', 'boolean'].includes(typeof video.videoId)).map(video => video.videoId))]
          await saveVideos(remaining)
          await history.unsetLastViewedPlaylistForVideos(removedVideoIds, playlist._id, remaining)
          return removed
        }
        let historyRevision = null
        let byId = null
        if (options.sort?.startsWith('video_duration_')) {
          const records = await newestHistory()
          historyRevision = await snapshotRevision(records)
          byId = new Map()
          for (const record of records) if (!byId.has(record.videoId)) byId.set(record.videoId, record)
        }
        if (options.cursor && options.cursor.historyRevision !== historyRevision) return { stale: true }
        const pageEntry = index => {
          const entry = { ...videos[index], _libraryMemberId: String(index) }
          if (byId && !(Number.isFinite(entry.lengthSeconds) && entry.lengthSeconds > 0)) {
            const record = byId.get(entry.videoId)
            if (record) entry.lengthSeconds = record.lengthSeconds
          }
          return entry
        }
        const key = JSON.stringify([revision, view, historyRevision])
        if (playlistOrder?.key !== key) {
          const entries = videos.map((video, index) => pageEntry(index))
          const ordered = getSortedPlaylistItems(entries, options.sort ?? 'custom', options.locale ?? 'en-US', options.reverse)
            .filter(video => !query || (typeof video.title === 'string' && video.title.toLowerCase().includes(query)) || (typeof video.author === 'string' && video.author.toLowerCase().includes(query)))
          // Keep one ordering, never cached documents. Verify the real snapshot
          // each time: legacy imports can preserve lastUpdatedAt while editing.
          playlistOrder = { key, positions: ordered.map(video => Number(video._libraryMemberId)) }
        }
        const offset = options.cursor?.position ?? 0
        const limit = Math.min(250, options.limit ?? 100)
        const records = playlistOrder.positions.slice(offset, offset + limit).map(pageEntry)
        return { records, revision, cursor: offset + limit < playlistOrder.positions.length ? { position: offset + limit, revision, view, historyRevision } : null }
      }
      const records = await newestHistory()
      if (method === 'historySummary') {
        return {
          total: records.length,
          unwatched: records.some(record => record.isWatched !== true && canMarkHistoryEntryAsWatched(record)),
          continued: getContinueWatchingCandidates(records).filter(canMarkHistoryEntryAsWatched).slice(0, 50),
        }
      }
      if (method === 'historyPage') {
        const revision = await snapshotRevision(records)
        const view = JSON.stringify([!!options.oldest, options.query ?? '', !!options.caseSensitive, options.locale ?? 'en-US'])
        if (options.cursor && (options.cursor.revision !== revision || options.cursor.view !== view)) return { stale: true }
        const sorted = options.oldest ? records.toReversed() : records
        const filtered = filterVideosWithQuery(sorted, options.query ?? '', options.caseSensitive, options.locale)
        const offset = options.cursor?.offset ?? 0
        const limit = Math.min(250, options.limit ?? 100)
        return { records: filtered.slice(offset, offset + limit), total: records.length, cursor: offset + limit < filtered.length ? { offset: offset + limit, revision, view } : null }
      }
      if (method === 'videoState') {
        const ids = new Set(options.ids)
        const memberships = []
        for (const playlist of await playlists.find()) {
          const counts = new Map()
          for (const video of Array.isArray(playlist.videos) ? playlist.videos : []) if (video !== null && typeof video === 'object' && ids.has(video.videoId)) counts.set(video.videoId, (counts.get(video.videoId) ?? 0) + 1)
          for (const [videoId, count] of counts) memberships.push({ videoId, playlistId: playlist._id, count })
        }
        // History.find returns newest first; consume each requested ID once.
        return { history: records.filter(record => ids.delete(record.videoId)), memberships }
      }
      throw new Error('Unknown library query')
    },
  }
}
