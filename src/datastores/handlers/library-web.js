import { filterVideosWithQuery } from '../../renderer/helpers/historySearch.js'
import { canMarkHistoryEntryAsWatched, isHistoryEntryWatched } from '../../history.js'
import { getContinueWatchingCandidates } from '../../renderer/helpers/homeSections.js'
import { getSortedPlaylistItems } from '../../renderer/helpers/playlists.js'

// The same bounded query contract is used by native/browser persistence.
// These adapters retain their shipped storage until their SQLite migration
// has been verified on the corresponding platform.
export function createPortableLibrary({ history, playlists }) {
  return {
    async query(method, options = {}) {
      if (method === 'playlistSummaries') return (await playlists.find()).map(playlist => ({ ...playlist, videoCount: playlist.videos.length, firstVideo: playlist.videos[0] ?? null, videos: [] }))
      if (method === 'playlistSnapshot') return (await playlists.find()).find(playlist => playlist._id === options.id) ?? null
      if (['playlistPage', 'playlistStatistics', 'movePlaylistMember', 'reorderPlaylistMembers', 'cleanupPlaylist'].includes(method)) {
        const playlist = (await playlists.find()).find(playlist => playlist._id === options.id)
        if (!playlist) throw new Error('The playlist no longer exists')
        if (method === 'playlistStatistics') {
          const byId = new Map((await history.find()).map(record => [record.videoId, record]))
          return {
            total: playlist.videos.length,
            uniqueCount: new Set(playlist.videos.map(video => video.videoId)).size,
            duration: playlist.videos.reduce((total, video) => total + (video.lengthSeconds || byId.get(video.videoId)?.lengthSeconds || 0), 0),
            missingDuration: playlist.videos.filter(video => !(video.lengthSeconds || byId.get(video.videoId)?.lengthSeconds)).length,
            watchedCount: playlist.videos.filter(video => isHistoryEntryWatched(byId.get(video.videoId))).length,
          }
        }
        if (method === 'movePlaylistMember') {
          const index = Number(options.memberId)
          let target = options.direction === 'top' ? 0 : options.direction === 'bottom' ? playlist.videos.length - 1 : index + options.direction
          if (options.direction === -1 || options.direction === 1) {
            const excluded = new Set(options.excludedMemberIds ?? [])
            while (target >= 0 && target < playlist.videos.length && excluded.has(String(target))) target += options.direction
          }
          if (target < 0 || target >= playlist.videos.length) return false
          if (options.direction === -1 || options.direction === 1) {
            [playlist.videos[index], playlist.videos[target]] = [playlist.videos[target], playlist.videos[index]]
          } else {
            const [member] = playlist.videos.splice(index, 1)
            playlist.videos.splice(target, 0, member)
          }
          playlist.lastUpdatedAt = Date.now()
          await playlists.upsert(playlist)
          return true
        }
        if (method === 'reorderPlaylistMembers') {
          const positions = options.memberIds.map(Number).toSorted((a, b) => a - b)
          const ordered = options.memberIds.map(id => playlist.videos[Number(id)])
          positions.forEach((position, index) => { playlist.videos[position] = ordered[index] })
          playlist.lastUpdatedAt = Date.now()
          await playlists.upsert(playlist)
          return true
        }
        if (method === 'cleanupPlaylist') {
          const byId = new Map((await history.find()).map(record => [record.videoId, record]))
          const unique = new Set()
          const videos = playlist.videos.filter(video => {
            if (options.mode === 'watched') return !isHistoryEntryWatched(byId.get(video.videoId))
            if (unique.has(video.videoId)) return false
            unique.add(video.videoId)
            return true
          })
          const removed = playlist.videos.length - videos.length
          const retained = new Set(videos)
          const removedVideoIds = [...new Set(playlist.videos.filter(video => !retained.has(video)).map(video => video.videoId))]
          await playlists.upsert({ ...playlist, videos, lastUpdatedAt: Date.now() })
          await history.unsetLastViewedPlaylistForVideos(removedVideoIds, playlist._id, videos)
          return removed
        }
        const query = options.query?.trim().toLowerCase() ?? ''
        const ordered = getSortedPlaylistItems(playlist.videos.map((video, index) => ({ ...video, _libraryMemberId: String(index) })), options.sort ?? 'custom', options.locale ?? 'en-US', options.reverse)
          .filter(video => !query || video.title?.toLowerCase().includes(query) || video.author?.toLowerCase().includes(query))
        const offset = options.cursor?.position ?? 0
        const limit = Math.min(250, options.limit ?? 100)
        const records = ordered.slice(offset, offset + limit)
        return { records, cursor: offset + limit < ordered.length ? { position: offset + limit } : null }
      }
      const records = await history.find()
      if (method === 'historySummary') {
        return {
          total: records.length,
          unwatched: records.some(record => record.isWatched !== true && canMarkHistoryEntryAsWatched(record)),
          continued: getContinueWatchingCandidates(records).filter(canMarkHistoryEntryAsWatched).slice(0, 50),
        }
      }
      if (method === 'historyPage') {
        const sorted = options.oldest ? records.toReversed() : records
        const filtered = filterVideosWithQuery(sorted, options.query ?? '', options.caseSensitive, options.locale)
        const offset = options.cursor?.offset ?? 0
        const limit = Math.min(250, options.limit ?? 100)
        return { records: filtered.slice(offset, offset + limit), total: records.length, cursor: offset + limit < filtered.length ? { offset: offset + limit } : null }
      }
      if (method === 'videoState') {
        const ids = new Set(options.ids)
        const memberships = []
        for (const playlist of await playlists.find()) {
          const counts = new Map()
          for (const video of playlist.videos) if (ids.has(video.videoId)) counts.set(video.videoId, (counts.get(video.videoId) ?? 0) + 1)
          for (const [videoId, count] of counts) memberships.push({ videoId, playlistId: playlist._id, count })
        }
        return { history: records.filter(record => ids.has(record.videoId)), memberships }
      }
      throw new Error('Unknown library query')
    },
  }
}
