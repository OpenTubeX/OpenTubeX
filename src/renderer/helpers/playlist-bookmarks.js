import { calculatePublishedDate } from './feed-metadata.js'

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
  updatedAt = null,
  savedAt = Date.now(),
}) {
  const bookmark = {
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
  if (Number.isFinite(updatedAt)) bookmark.updatedAt = updatedAt
  return bookmark
}

/**
 * Applies freshly loaded playlist metadata to a saved playlist.
 * `updatedAt` is when the channel last changed the playlist. It stays local,
 * as sync only sends the `playlist` and `uploader` metadata.
 * @param {any} bookmark
 * @param {{ title: string, description: string, thumbnailUrl: string | null, videoCount: number,
 *   uploaderId: string, uploaderName: string, uploaderAvatar: string | null, updatedAt: number | null }} metadata
 * @returns {any} the same bookmark when nothing changed
 */
export function updatePlaylistBookmarkMetadata(bookmark, metadata) {
  const updated = {
    ...bookmark,
    playlist: {
      ...bookmark.playlist,
      title: metadata.title,
      description: metadata.description ?? '',
      thumbnail_url: canonicalPlaylistThumbnailUrl(metadata.thumbnailUrl),
      video_count: Number.isFinite(metadata.videoCount) ? metadata.videoCount : null,
    },
    uploader: {
      ...bookmark.uploader,
      id: metadata.uploaderId,
      name: metadata.uploaderName,
      avatar: canonicalChannelAvatarUrl(metadata.uploaderAvatar),
    },
  }
  if (Number.isFinite(metadata.updatedAt)) updated.updatedAt = metadata.updatedAt
  return JSON.stringify(updated) === JSON.stringify(bookmark) ? bookmark : updated
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const LAST_UPDATED_ON_REGEX = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\b/i

/**
 * Parses the English update text of a YouTube playlist, such as
 * "Last updated on Jun 17, 2014", "Updated today" or "Updated 3 days ago".
 * The text names a day, so this returns the start of that local day, which
 * stays the same however often the playlist is refreshed that day.
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseLocalPlaylistLastUpdated(text) {
  if (typeof text !== 'string') return null

  let date
  if (/\btoday\b/i.test(text)) {
    date = new Date()
  } else if (/\byesterday\b/i.test(text)) {
    date = new Date()
    date.setDate(date.getDate() - 1)
  } else if (/\bago\b/i.test(text)) {
    const published = calculatePublishedDate(text)
    if (published === undefined) return null
    date = new Date(published)
  } else {
    const match = text.match(LAST_UPDATED_ON_REGEX)
    const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1
    if (month === -1) return null
    date = new Date(Number(match[3]), month, Number(match[2]))
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
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
    // Sort saved playlists by the channel's last change once it is known
    lastUpdatedAt: Number.isFinite(bookmark.updatedAt) ? bookmark.updatedAt : savedAt,
    videos: [],
  }
}

export function playlistBookmarkForSync(bookmark) {
  return {
    // Copy the scalar metadata out of Vue proxies for encrypted sync's structuredClone.
    playlist: { ...bookmark.playlist },
    uploader: { ...bookmark.uploader },
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
