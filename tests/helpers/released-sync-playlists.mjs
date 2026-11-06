// Frozen playlist conversion and merge from released v0.36.0-beta (7bf2e2d23).
// Test-only reference for mixed-version encrypted sync; keep the functions unchanged.
import { randomUUID as generateRandomUniqueId } from 'node:crypto'
import { SyncServerDataLossError } from '../../src/renderer/helpers/sync-server-errors.js'

const DEFAULT_CHANNEL_AVATAR = 'https://yt3.googleusercontent.com/ytc/default'
const YOUTUBE_VIDEO_THUMBNAIL_REGEX = /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\//
const deepCopy = value => JSON.parse(JSON.stringify(value))

function mapBy(items, getId) {
  return new Map(items.map(item => [getId(item), item]))
}

export function mergeIds(
  localIds,
  remoteIds,
  previousIds = [],
  { allowDataLoss = false, collection = 'data', getItemName = () => null } = {}
) {
  const local = new Set(localIds)
  const remote = new Set(remoteIds)
  const previous = new Set(previousIds)
  const allIds = new Set([...local, ...remote, ...previous])

  const merged = new Set(Array.from(allIds).filter(id => {
    if (!previous.has(id)) {
      return local.has(id) || remote.has(id)
    }

    // Once both sides have seen an item, a deletion on either side wins.
    return local.has(id) && remote.has(id)
  }))
  const deletedIds = Array.from(previous).filter(id => !merged.has(id))
  const deleted = deletedIds.length
  const oneSideWasEmptied = previous.size > 0 && (
    (local.size === 0 && remote.size > 0) ||
    (remote.size === 0 && local.size > 0)
  )
  const isMassDeletion = deleted >= 10 && deleted / previous.size >= 0.5

  if (!allowDataLoss && deleted > 0 && (oneSideWasEmptied || isMassDeletion)) {
    throw new SyncServerDataLossError(collection, deleted, previous.size, deletedIds.map(id => ({
      id,
      name: getItemName(id) || id,
    })))
  }

  return merged
}

function normalizeChannelAvatar(avatar) {
  if (!avatar || avatar === DEFAULT_CHANNEL_AVATAR || YOUTUBE_VIDEO_THUMBNAIL_REGEX.test(avatar)) {
    return null
  }

  return avatar
}

function videoToRemote(video) {
  const videoId = video.videoId
  const uploaderId = video.authorId

  if (!videoId || !uploaderId) {
    return null
  }

  return {
    id: videoId,
    title: video.title || videoId,
    upload_date: Number.isFinite(video.published) ? video.published : 0,
    uploader: {
      id: uploaderId,
      name: video.author || uploaderId,
      avatar: normalizeChannelAvatar(video.authorThumbnail) || DEFAULT_CHANNEL_AVATAR,
      verified: false,
    },
    thumbnail_url: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: Number.isFinite(video.lengthSeconds) ? Math.round(video.lengthSeconds) : 0,
  }
}

function videoToLocal(video, timeAdded = Date.now()) {
  return {
    videoId: video.id,
    title: video.title,
    author: video.uploader.name,
    authorId: video.uploader.id,
    lengthSeconds: video.duration,
    published: video.upload_date,
    timeAdded,
    playlistItemId: generateRandomUniqueId(),
    type: 'video',
  }
}

function playlistMetadataFromLocal(playlist) {
  return {
    id: playlist._id,
    title: playlist.playlistName,
    description: playlist.description || '',
    thumbnail_url: null,
  }
}

function playlistMetadataFromRemote(playlist) {
  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description || '',
    thumbnail_url: playlist.thumbnail_url ?? null,
  }
}

function metadataEquals(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function selectPlaylistMetadata(local, remote, previous) {
  if (!local) return playlistMetadataFromRemote(remote)
  if (!remote) return playlistMetadataFromLocal(local)

  const localMetadata = playlistMetadataFromLocal(local)
  const remoteMetadata = playlistMetadataFromRemote(remote)
  if (!previous) return localMetadata

  const localChanged = !metadataEquals(localMetadata, previous)
  const remoteChanged = !metadataEquals(remoteMetadata, previous)
  return remoteChanged && !localChanged ? remoteMetadata : localMetadata
}

function isSameLocalPlaylist(playlist, metadata, videos) {
  return playlist.playlistName === metadata.title &&
    (playlist.description || '') === metadata.description &&
    playlist.videos.length === videos.length &&
    playlist.videos.every((video, index) => video.videoId === videos[index].videoId)
}

export async function syncPlaylists(client, store, previous = {}, options = {}) {
  const localPlaylists = store.state.playlists.playlists
  const localById = mapBy(localPlaylists, playlist => playlist._id)
  const remotePlaylistHeaders = await client.getPlaylists()
  const remotePlaylists = await Promise.all(
    remotePlaylistHeaders.map(playlist => client.getPlaylist(playlist.id))
  )
  const localIdByRemoteId = new Map(Object.entries(previous).map(([localId, snapshot]) => {
    return [snapshot.remoteId ?? localId, localId]
  }))
  const remoteById = new Map(remotePlaylists.map(entry => {
    const remoteId = entry.playlist.id
    const localId = localIdByRemoteId.get(remoteId) ?? remoteId
    return [localId, { ...entry, remoteId }]
  }))
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), Object.keys(previous), {
    ...options,
    collection: 'playlists',
    getItemName: id => localById.get(id)?.playlistName || remoteById.get(id)?.playlist.title || previous[id]?.metadata?.title,
  })
  const nextSnapshot = {}

  for (const [id, remote] of remoteById) {
    if (!mergedIds.has(id)) {
      await client.deletePlaylist(remote.remoteId)
    }
  }

  for (const id of localById.keys()) {
    if (!mergedIds.has(id)) {
      await store.dispatch('removePlaylist', id)
    }
  }

  for (const id of mergedIds) {
    let local = localById.get(id)
    let remote = remoteById.get(id)
    const remoteMetadata = remote ? { ...remote.playlist, id } : null
    const metadata = selectPlaylistMetadata(local, remoteMetadata, previous[id]?.metadata)
    let remoteId = remote?.remoteId ?? id

    if (!remote) {
      const createdPlaylist = await client.createPlaylist(metadata)
      remoteId = createdPlaylist?.id ?? id
      remote = { playlist: { ...metadata, id: remoteId }, videos: [], remoteId }
    } else if (!metadataEquals(metadata, playlistMetadataFromRemote(remoteMetadata))) {
      await client.updatePlaylist(remoteId, metadata)
    }

    const localVideos = local?.videos ?? []
    const localVideosById = mapBy(
      localVideos.filter(video => videoToRemote(video) !== null),
      video => video.videoId
    )
    const unsyncableLocalVideos = localVideos.filter(video => videoToRemote(video) === null)
    const remoteVideosById = mapBy(remote.videos, video => video.id)
    const mergedVideoIds = mergeIds(
      localVideosById.keys(),
      remoteVideosById.keys(),
      previous[id]?.videos,
      {
        ...options,
        collection: `videos in playlist ${metadata.title}`,
        getItemName: videoId => localVideosById.get(videoId)?.title || remoteVideosById.get(videoId)?.title,
      }
    )
    const remoteVideosToAdd = Array.from(mergedVideoIds)
      .filter(videoId => !remoteVideosById.has(videoId))
      .map(videoId => videoToRemote(localVideosById.get(videoId)))
      .filter(Boolean)

    if (remoteVideosToAdd.length > 0) {
      await client.addPlaylistVideos(remoteId, remoteVideosToAdd)
    }
    for (const videoId of remoteVideosById.keys()) {
      if (!mergedVideoIds.has(videoId)) {
        await client.removePlaylistVideo(remoteId, videoId)
      }
    }

    const mergedVideos = Array.from(mergedVideoIds).map(videoId => {
      return localVideosById.get(videoId) ?? videoToLocal(remoteVideosById.get(videoId))
    }).concat(unsyncableLocalVideos)

    if (!local) {
      local = {
        _id: id,
        playlistName: metadata.title,
        description: metadata.description,
        protected: false,
        videos: mergedVideos,
      }
      await store.dispatch('addPlaylist', local)
    } else if (!isSameLocalPlaylist(local, metadata, mergedVideos)) {
      await store.dispatch('updatePlaylist', {
        ...deepCopy(local),
        playlistName: metadata.title,
        description: metadata.description,
        videos: mergedVideos,
      })
    }

    nextSnapshot[id] = {
      remoteId,
      metadata,
      videos: Array.from(mergedVideoIds),
    }
  }

  return nextSnapshot
}

export function historyToRemote(record) {
  const video = videoToRemote(record)
  if (!video) return null

  const watchProgress = Number.isFinite(record.watchProgress) ? record.watchProgress : 0
  return {
    video,
    metadata: {
      added_date: Number.isFinite(record.timeWatched) ? record.timeWatched : Date.now(),
      watched_state: record.isWatched ? 'completed' : watchProgress > 0 ? 'watching' : 'planned',
      position_millis: Math.max(0, Math.round(watchProgress * 1000)),
    },
  }
}
