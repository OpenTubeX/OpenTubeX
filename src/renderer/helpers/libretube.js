import { hasReachedWatchedThreshold } from '../../history.js'

const YOUTUBE_CHANNEL_ID_LENGTH = 24
const YOUTUBE_CHANNEL_ID_REGEX = /^UC[\w-]{22}$/
const YOUTUBE_VIDEO_ID_REGEX = /^[\w-]{11}$/

/**
 * @param {unknown} data
 * @returns {data is Record<string, any>}
 */
function isObject(data) {
  return data != null && typeof data === 'object' && !Array.isArray(data)
}

/**
 * @param {unknown} channelId
 */
function normalizeChannelId(channelId) {
  if (typeof channelId !== 'string') {
    return ''
  }

  const trimmedChannelId = channelId.trim()
  if (YOUTUBE_CHANNEL_ID_REGEX.test(trimmedChannelId)) {
    return trimmedChannelId
  }

  return ''
}

/**
 * @param {unknown} value
 */
function toFiniteNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return value
}

/**
 * @param {unknown} data
 */
function getSubscriptionArrays(data) {
  if (!isObject(data)) {
    return []
  }

  return [
    data.localSubscriptions,
    data.subscriptions,
  ].filter(Array.isArray)
}

/**
 * @param {unknown} uploaderUrl
 */
export function extractChannelIdFromUploaderUrl(uploaderUrl) {
  if (typeof uploaderUrl !== 'string') {
    return ''
  }

  const trimmedUploaderUrl = uploaderUrl.trim()
  const channelPathMatch = trimmedUploaderUrl.match(/(?:^|\/)channel\/(UC[\w-]{22})(?:[/?#]|$)/)
  if (channelPathMatch) {
    return channelPathMatch[1]
  }

  if (trimmedUploaderUrl.length === YOUTUBE_CHANNEL_ID_LENGTH) {
    return normalizeChannelId(trimmedUploaderUrl)
  }

  return ''
}

/**
 * @param {unknown} data
 */
export function isLibreTubeBackup(data) {
  return isObject(data) &&
    (data.format === 'Piped' ||
      Array.isArray(data.watchHistory) ||
      Array.isArray(data.subscriptions) ||
      Array.isArray(data.localSubscriptions))
}

/**
 * @param {object} backupData
 */
export function getLibreTubeSubscriptions(backupData) {
  return getSubscriptionArrays(backupData).flat()
}

/**
 * @param {unknown} data
 */
export function isLibreTubeWatchHistoryBackup(data) {
  return isLibreTubeBackup(data) && Array.isArray(data.watchHistory)
}

/**
 * @param {unknown} subscription
 */
export function convertLibreTubeSubscription(subscription) {
  if (!isObject(subscription)) {
    return null
  }

  const channelId = normalizeChannelId(subscription.channelId) ||
    normalizeChannelId(subscription.id) ||
    extractChannelIdFromUploaderUrl(subscription.url)

  if (!channelId) {
    return null
  }

  return {
    id: channelId,
    name: typeof subscription.name === 'string' ? subscription.name : '',
    thumbnail: typeof subscription.avatar === 'string'
      ? subscription.avatar
      : typeof subscription.thumbnail === 'string'
        ? subscription.thumbnail
        : null,
  }
}

/**
 * @param {unknown[]} subscriptions
 */
export function convertLibreTubeSubscriptions(subscriptions) {
  const convertedSubscriptions = []
  const seenChannelIds = new Set()

  subscriptions.forEach((subscription) => {
    const convertedSubscription = convertLibreTubeSubscription(subscription)

    if (convertedSubscription && !seenChannelIds.has(convertedSubscription.id)) {
      seenChannelIds.add(convertedSubscription.id)
      convertedSubscriptions.push(convertedSubscription)
    }
  })

  return convertedSubscriptions
}

/**
 * @param {unknown} data
 * @returns {'youtube' | 'newpipe' | 'libretube-backup' | 'libretube-freetube' | null}
 */
export function detectSubscriptionJsonFormat(data) {
  if (Array.isArray(data)) {
    return 'youtube'
  }

  if (!isObject(data)) {
    return null
  }

  const subscriptionArrays = getSubscriptionArrays(data)
  if (subscriptionArrays.length === 0) {
    return null
  }

  const subscriptions = subscriptionArrays.flat()

  if ((data.format === 'Piped' || Array.isArray(data.localSubscriptions)) &&
    subscriptions.some(subscription => convertLibreTubeSubscription(subscription) !== null)) {
    return 'libretube-backup'
  }

  if (subscriptions.some(subscription => isObject(subscription) && subscription.channelId != null)) {
    return 'libretube-backup'
  }

  if (data.app_version != null ||
    subscriptions.some(subscription => isObject(subscription) && subscription.service_id != null)) {
    return 'newpipe'
  }

  if (subscriptions.some(subscription => {
    return isObject(subscription) &&
      subscription.id != null &&
      subscription.channelId == null &&
      subscription.service_id == null
  })) {
    return 'libretube-freetube'
  }

  return null
}

/**
 * @param {object} backupData
 * @returns {{ historyItems: Map<string, any>, importedCount: number, skippedCount: number }}
 */
export function convertLibreTubeWatchHistoryToOpenTubeX(backupData) {
  const historyItems = new Map()
  const watchPositionsByVideoId = new Map()

  if (Array.isArray(backupData.watchPositions)) {
    backupData.watchPositions.forEach((position) => {
      if (!isObject(position) || typeof position.videoId !== 'string') {
        return
      }

      const watchPosition = toFiniteNumber(position.position)
      if (watchPosition != null) {
        watchPositionsByVideoId.set(position.videoId, watchPosition)
      }
    })
  }

  const baseTimeWatched = Date.now()
  let importedCount = 0
  let skippedCount = 0

  backupData.watchHistory.forEach((item, index) => {
    if (!isObject(item) || typeof item.videoId !== 'string') {
      skippedCount++
      return
    }

    const duration = toFiniteNumber(item.duration)
    const isLive = duration == null || duration <= 0
    const watchPosition = watchPositionsByVideoId.get(item.videoId)
    let watchProgress = duration != null && duration > 0 ? duration : 0
    let isWatched = true

    if (watchPosition != null && duration != null && duration > 0) {
      // LibreTube stores positions in milliseconds and durations in seconds
      const positionSeconds = watchPosition / 1000
      watchProgress = Math.min(Math.max(positionSeconds, 0), duration)
      isWatched = hasReachedWatchedThreshold(watchProgress, duration)
    }

    // LibreTube backs up its history oldest first and has no watch times,
    // so spaced times keep its newest entry on top
    const timeWatched = baseTimeWatched - (backupData.watchHistory.length - 1 - index)

    historyItems.set(item.videoId, {
      videoId: item.videoId,
      title: item.title ?? '',
      author: item.uploader ?? '',
      authorId: extractChannelIdFromUploaderUrl(item.uploaderUrl),
      // History page displays `published`; LibreTube does not store watch timestamps.
      published: timeWatched,
      timeWatched,
      description: '',
      lengthSeconds: isLive ? null : duration,
      watchProgress,
      isWatched,
      isLive,
      type: 'video',
    })
    importedCount++
  })

  return { historyItems, importedCount, skippedCount }
}

/**
 * The ID of a YouTube video URL, or of a bare video ID, as LibreTube saves them
 * @param {unknown} url
 */
export function getYouTubeVideoId(url) {
  if (typeof url !== 'string') return null
  const trimmedUrl = url.trim()
  if (YOUTUBE_VIDEO_ID_REGEX.test(trimmedUrl)) return trimmedUrl
  try {
    const { hostname, pathname, searchParams } = new URL(trimmedUrl)
    const host = hostname.replace(/^(?:www|m|music)\./, '')
    const videoId = host === 'youtu.be'
      ? pathname.slice(1)
      : host === 'youtube.com'
        ? searchParams.get('v') ?? pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1]
        : null
    return typeof videoId === 'string' && YOUTUBE_VIDEO_ID_REGEX.test(videoId) ? videoId : null
  } catch {
    return null
  }
}

/**
 * LibreTube backups and Piped's and LibreTube's playlist exports
 * @param {unknown} data
 */
export function isLibreTubePlaylistsExport(data) {
  return isObject(data) && (Array.isArray(data.localPlaylists) || (data.format === 'Piped' && Array.isArray(data.playlists)))
}

/**
 * Spaced add times keep the saved order when sorting by date added. They are
 * made up, so a repeated import must match videos by ID.
 * @param {object[]} videos
 * @param {number} now
 */
function withAddTimes(videos, now) {
  return videos.map((video, index) => ({ ...video, timeAdded: now - (videos.length - 1 - index) }))
}

/**
 * LibreTube backups save local playlists twice: with their video details, and
 * as video URLs in Piped's format, which Piped and LibreTube also export.
 * Videos whose details are missing use their ID as the title, which the
 * Playlists page's repair action replaces.
 * @param {Record<string, any>} data
 * @param {number} now
 */
export function convertLibreTubePlaylists(data, now = Date.now()) {
  const playlists = []
  if (Array.isArray(data.localPlaylists) && data.localPlaylists.length > 0) {
    for (const entry of data.localPlaylists) {
      const name = entry?.playlist?.name
      if (typeof name !== 'string' || !name.trim() || !Array.isArray(entry.videos)) {
        console.warn('Skipping invalid LibreTube playlist', entry)
        continue
      }
      const videos = entry.videos.flatMap((item) => {
        const videoId = getYouTubeVideoId(item?.videoId)
        if (videoId === null) return []
        const duration = toFiniteNumber(item.duration)
        return [{
          videoId,
          title: typeof item.title === 'string' && item.title ? item.title : videoId,
          author: typeof item.uploader === 'string' ? item.uploader : '',
          authorId: extractChannelIdFromUploaderUrl(item.uploaderUrl),
          lengthSeconds: duration != null && duration > 0 ? duration : 0,
        }]
      })
      const description = entry.playlist.description
      playlists.push({
        playlistName: name,
        // An empty description must not replace the one of a saved playlist with this name
        ...(typeof description === 'string' && description.trim() ? { description } : {}),
        videos: withAddTimes(videos, now),
      })
    }
  } else if (Array.isArray(data.playlists)) {
    for (const playlist of data.playlists) {
      if (!isObject(playlist) || typeof playlist.name !== 'string' || !playlist.name.trim() || !Array.isArray(playlist.videos)) {
        console.warn('Skipping invalid Piped playlist', playlist)
        continue
      }
      const videos = playlist.videos.map(getYouTubeVideoId)
        .filter(videoId => videoId !== null)
        .map(videoId => ({ videoId, title: videoId, lengthSeconds: 0 }))
      playlists.push({ playlistName: playlist.name, videos: withAddTimes(videos, now) })
    }
  }
  return playlists
}

/**
 * @param {unknown} data
 */
export function isLibreTubeSearchHistoryBackup(data) {
  return isLibreTubeBackup(data) && Array.isArray(data.searchHistory)
}

/**
 * LibreTube backs up its searches oldest first and without their times.
 * @param {{ searchHistory: unknown[] }} backupData
 * @param {number} now
 */
export function convertLibreTubeSearchHistory(backupData, now = Date.now()) {
  const queries = new Map()
  backupData.searchHistory.forEach((item, index) => {
    const query = isObject(item) && typeof item.query === 'string' ? item.query.trim() : ''
    if (!query) return
    queries.delete(query)
    queries.set(query, now - (backupData.searchHistory.length - 1 - index))
  })
  return Array.from(queries, ([query, lastUpdatedAt]) => ({ _id: query, query, lastUpdatedAt }))
}
