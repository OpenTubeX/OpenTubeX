import { WATCHED_THRESHOLD } from '../../constants'

const YOUTUBE_CHANNEL_ID_LENGTH = 24
const YOUTUBE_CHANNEL_ID_REGEX = /^UC[\w-]{22}$/

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
 * @param {Map<string, any>} existingHistoryItems
 * @returns {{ historyItems: Map<string, any>, importedCount: number, skippedCount: number }}
 */
export function convertLibreTubeWatchHistoryToOpenTubeX(backupData, existingHistoryItems) {
  const historyItems = new Map(existingHistoryItems)
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
      const positionSeconds = watchPosition > duration ? watchPosition / 1000 : watchPosition
      watchProgress = Math.min(Math.max(positionSeconds, 0), duration)
      isWatched = watchProgress / duration >= WATCHED_THRESHOLD
    }

    const timeWatched = baseTimeWatched - index

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
