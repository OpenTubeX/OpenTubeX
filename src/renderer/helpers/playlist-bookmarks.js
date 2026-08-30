const YOUTUBE_THUMBNAIL_ORIGIN = 'https://i.ytimg.com'
const YOUTUBE_AVATAR_ORIGIN = 'https://yt3.googleusercontent.com'

function canonicalYouTubeImageUrl(url, proxiedPath, youtubeOrigin) {
  if (typeof url !== 'string' || url === '') return null

  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.pathname.startsWith(proxiedPath)) {
      return `${youtubeOrigin}${parsedUrl.pathname.slice(proxiedPath.length)}${parsedUrl.search}`
    }
  } catch {
    return url
  }

  return url
}

export function canonicalPlaylistThumbnailUrl(url) {
  return canonicalYouTubeImageUrl(url, '/vi/', `${YOUTUBE_THUMBNAIL_ORIGIN}/vi/`)
}

export function canonicalChannelAvatarUrl(url) {
  return canonicalYouTubeImageUrl(url, '/ggpht/', `${YOUTUBE_AVATAR_ORIGIN}/`)
}

export function createPlaylistBookmark({
  id,
  title,
  description = '',
  thumbnailUrl = null,
  videoCount = null,
  uploaderId,
  uploaderName,
  uploaderAvatar = null,
  uploaderVerified = false,
  savedAt = Date.now(),
}) {
  return {
    playlist: {
      id,
      title,
      description,
      thumbnail_url: canonicalPlaylistThumbnailUrl(thumbnailUrl),
      video_count: Number.isFinite(videoCount) ? videoCount : null,
    },
    uploader: {
      id: uploaderId,
      name: uploaderName,
      avatar: canonicalChannelAvatarUrl(uploaderAvatar),
      verified: uploaderVerified,
    },
    savedAt,
  }
}

export function isValidPlaylistBookmark(bookmark) {
  return typeof bookmark?.playlist?.id === 'string' && bookmark.playlist.id !== '' &&
    typeof bookmark.playlist.title === 'string' &&
    typeof bookmark?.uploader?.id === 'string' && bookmark.uploader.id !== '' &&
    typeof bookmark.uploader.name === 'string'
}

export function playlistBookmarkToListData(bookmark) {
  const { playlist, uploader } = bookmark
  const savedAt = Number.isFinite(bookmark.savedAt) ? bookmark.savedAt : 0

  return {
    type: 'playlist',
    isPlaylistBookmark: true,
    title: playlist.title,
    playlistName: playlist.title,
    description: playlist.description ?? '',
    playlistId: playlist.id,
    playlistThumbnail: playlist.thumbnail_url ?? '',
    author: uploader.name,
    authorId: uploader.id,
    authorVerified: uploader.verified === true,
    authorThumbnails: uploader.avatar ? [{ url: uploader.avatar }] : [],
    videoCount: Number.isFinite(playlist.video_count) ? playlist.video_count : 0,
    createdAt: savedAt,
    lastUpdatedAt: savedAt,
    videos: [],
  }
}

export function playlistBookmarkForSync(bookmark) {
  return {
    playlist: bookmark.playlist,
    uploader: bookmark.uploader,
  }
}

export function mergePlaylistBookmarkConflict({ original, local, remote }) {
  const originalById = new Map(original.map(entry => [entry.playlist.id, entry]))
  const localById = new Map(local.map(entry => [entry.playlist.id, entry]))
  const remoteById = new Map(remote.map(entry => [entry.playlist.id, entry]))
  const ids = new Set([...remoteById.keys(), ...localById.keys(), ...originalById.keys()])

  return Array.from(ids).flatMap(id => {
    const originalEntry = originalById.get(id)
    const localEntry = localById.get(id)
    const remoteEntry = remoteById.get(id)

    if (originalEntry && (!localEntry || !remoteEntry)) return []
    if (!localEntry) return remoteEntry ? [remoteEntry] : []
    if (!remoteEntry || !originalEntry) return [localEntry]

    const localChanged = JSON.stringify(localEntry) !== JSON.stringify(originalEntry)
    const remoteChanged = JSON.stringify(remoteEntry) !== JSON.stringify(originalEntry)
    return [remoteChanged && !localChanged ? remoteEntry : localEntry]
  })
}
