export const SUBSCRIPTION_FEED_TYPES = Object.freeze(['videos', 'shorts', 'live', 'posts'])
export const MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES = 5000
const CHANNEL_SETTING_KEYS = ['feedTypes', 'dailyVideoLimit', 'showMembersOnly']

/**
 * @param {(key: string) => string} t
 */
export function getSubscriptionFeedTypeOptions(t) {
  return [
    { id: 'videos', label: t('Global.Videos'), icon: ['fas', 'video'] },
    { id: 'shorts', label: t('Global.Shorts'), icon: ['fas', 'clapperboard'] },
    { id: 'live', label: t('Global.Live'), icon: ['fas', 'tower-broadcast'] },
    { id: 'posts', label: t('Global.Posts'), icon: ['fas', 'message'] }
  ]
}

/**
 * @param {(key: string) => string} t
 */
export function getSubscriptionDailyVideoLimitOptions(t) {
  return [
    { value: 'global', label: t('Channel.Use global setting') },
    { value: 'unlimited', label: t('Channel.Unlimited') },
    ...Array.from({ length: 30 }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1)
    }))
  ]
}

/**
 * @param {{ feedTypes?: unknown, dailyVideoLimit?: unknown, showMembersOnly?: unknown } | undefined} channel
 */
export function normalizeSubscriptionChannelSettings(channel) {
  const dailyVideoLimit = channel?.dailyVideoLimit

  return {
    feedTypes: Array.isArray(channel?.feedTypes)
      ? SUBSCRIPTION_FEED_TYPES.filter(type => channel.feedTypes.includes(type))
      : [...SUBSCRIPTION_FEED_TYPES],
    dailyVideoLimit: dailyVideoLimit === null ||
      (Number.isInteger(dailyVideoLimit) && dailyVideoLimit > 0)
      ? dailyVideoLimit
      : undefined,
    showMembersOnly: channel?.showMembersOnly === true
  }
}

/**
 * Copies saved preferences without replacing refreshed channel metadata.
 * Missing fields in the saved channel reset their corresponding overrides.
 * @param {object} channel
 * @param {object} savedChannel
 */
export function copySubscriptionChannelSettings(channel, savedChannel) {
  const updated = { ...channel }
  for (const key of [...CHANNEL_SETTING_KEYS, 'subscriptionSettingsUpdatedAt', 'subscriptionSettingsUpdatedAtByField']) {
    if (Object.hasOwn(savedChannel, key)) updated[key] = savedChannel[key]
    else delete updated[key]
  }
  return updated
}

/**
 * Orders an explicit local edit after observed settings even with clock skew.
 * @param {object[]} subscriptions
 * @returns {number}
 */
export function getNextSubscriptionSettingsTimestamp(subscriptions) {
  return subscriptions.reduce((updatedAt, channel) => {
    const timestamps = [channel.subscriptionSettingsUpdatedAt, ...Object.values(channel.subscriptionSettingsUpdatedAtByField ?? {})]
    return Math.max(updatedAt, ...timestamps.filter(Number.isFinite).map(timestamp => timestamp + 1))
  }, Date.now())
}

/**
 * Applies only requested preferences, preserving concurrent edits to other fields.
 * @param {object} subscription
 * @param {{ feedTypes?: string[], dailyVideoLimit?: number | null, showMembersOnly?: boolean }} settings
 * @param {number} updatedAt
 * @param {boolean} [preserveNewerSettings] Keep fields edited after this patch.
 */
export function getChannelWithUpdatedSettings(subscription, settings, updatedAt, preserveNewerSettings = false) {
  const channel = { ...subscription }
  const fieldUpdatedAt = Object.fromEntries(CHANNEL_SETTING_KEYS.map(key => [
    key, subscription.subscriptionSettingsUpdatedAtByField?.[key] ?? subscription.subscriptionSettingsUpdatedAt ?? 0
  ]))
  for (const key of CHANNEL_SETTING_KEYS) {
    if (!Object.hasOwn(settings, key)) continue
    if (key === 'feedTypes' && !Array.isArray(settings[key])) continue
    if (preserveNewerSettings && fieldUpdatedAt[key] > updatedAt) continue
    if (key === 'feedTypes') {
      channel[key] = [...settings[key]]
    } else if (settings[key] === undefined || (key === 'showMembersOnly' && typeof settings[key] !== 'boolean')) {
      delete channel[key]
    } else {
      channel[key] = settings[key]
    }
    fieldUpdatedAt[key] = updatedAt
  }
  channel.subscriptionSettingsUpdatedAtByField = fieldUpdatedAt
  channel.subscriptionSettingsUpdatedAt = preserveNewerSettings
    ? Math.max(updatedAt, subscription.subscriptionSettingsUpdatedAt ?? 0)
    : updatedAt
  return channel
}

/**
 * @param {number | null | undefined} limit
 */
export function formatSubscriptionDailyVideoLimit(limit) {
  return limit === undefined ? 'global' : limit === null ? 'unlimited' : String(limit)
}

/**
 * @param {string} value
 * @returns {number | null | undefined}
 */
export function parseSubscriptionDailyVideoLimit(value) {
  if (value === 'global') return undefined
  if (value === 'unlimited') return null

  const limit = Number(value)
  return Number.isInteger(limit) && limit > 0 ? limit : undefined
}

/**
 * @param {string[]} feedTypes
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {boolean} enabled
 */
export function getUpdatedSubscriptionFeedTypes(feedTypes, feedType, enabled) {
  const updatedFeedTypes = new Set(feedTypes)

  if (enabled) updatedFeedTypes.add(feedType)
  else updatedFeedTypes.delete(feedType)

  return SUBSCRIPTION_FEED_TYPES.filter(type => updatedFeedTypes.has(type))
}

/**
 * @param {unknown} channels
 * @returns {{ id: string, name?: string, feedTypes?: string[], dailyVideoLimit?: number | null, showMembersOnly?: boolean }[]}
 */
export function getValidSubscriptionChannels(channels) {
  if (!Array.isArray(channels)) {
    return []
  }

  return channels.filter(channel => (
    typeof channel?.id === 'string' && channel.id.length > 0
  ))
}

/**
 * Subscriptions saved before feed filtering was added have no feedTypes field.
 * They keep the original behavior, with every feed enabled.
 *
 * @param {{ feedTypes?: unknown }} channel
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 */
export function isSubscriptionFeedTypeEnabled(channel, feedType) {
  return !SUBSCRIPTION_FEED_TYPES.includes(feedType) ||
    !Array.isArray(channel.feedTypes) ||
    channel.feedTypes.includes(feedType)
}

/**
 * @param {unknown} channels
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @returns {{ id: string, name?: string, feedTypes?: string[] }[]}
 */
export function getSubscriptionsForFeed(channels, feedType) {
  return getValidSubscriptionChannels(channels)
    .filter(channel => isSubscriptionFeedTypeEnabled(channel, feedType))
}

/**
 * @param {object} video
 * @param {{ showMembersOnly?: boolean } | undefined} channel
 * @param {boolean} restrictedPlaybackConfigured
 */
export function isMembersOnlySubscriptionVideoVisible(
  video,
  channel,
  restrictedPlaybackConfigured
) {
  return video?.isMembersOnly !== true ||
    (restrictedPlaybackConfigured && channel?.showMembersOnly === true)
}

/**
 * @param {object[]} videos
 * @param {unknown} subscriptions
 * @param {boolean} restrictedPlaybackConfigured
 */
export function filterMembersOnlySubscriptionVideos(
  videos,
  subscriptions,
  restrictedPlaybackConfigured
) {
  if (!videos.some(video => video?.isMembersOnly === true)) return videos

  const subscriptionsById = new Map(
    getValidSubscriptionChannels(subscriptions).map(channel => [channel.id, channel])
  )

  return videos.filter(video => isMembersOnlySubscriptionVideoVisible(
    video,
    subscriptionsById.get(video?.authorId),
    restrictedPlaybackConfigured
  ))
}

/**
 * Applies the existing global total limit unless a subscription provides a
 * daily override. The input must be ordered newest first so the newest videos
 * win each limit. Kept videos that represent hidden entries receive a count
 * on a copy, leaving cached entries untouched.
 *
 * @param {object[]} videos
 * @param {unknown} subscriptions
 * @param {number | null} globalLimit
 * @param {string} currentVideoId
 * @returns {object[]}
 */
export function applySubscriptionVideoLimit(
  videos,
  subscriptions,
  globalLimit,
  currentVideoId = ''
) {
  const validSubscriptions = getValidSubscriptionChannels(subscriptions)
  if (globalLimit === null && !validSubscriptions.some(subscription => (
    Number.isInteger(subscription.dailyVideoLimit) && subscription.dailyVideoLimit > 0
  ))) return videos

  const subscriptionsById = new Map(validSubscriptions.map(channel => [channel.id, channel]))
  const counts = new Map()
  const firstKeptIndexByGroup = new Map()
  const hiddenCountsByKeptIndex = new Map()
  const keptVideos = []

  for (const video of videos) {
    if (!video?.videoId || !video.authorId || video.videoId === currentVideoId) {
      keptVideos.push(video)
      continue
    }

    const subscription = subscriptionsById.get(video.authorId)
    const dailyLimit = subscription?.dailyVideoLimit
    const hasDailyLimit = Number.isInteger(dailyLimit) && dailyLimit > 0
    const limit = hasDailyLimit
      ? dailyLimit
      : dailyLimit === null ? null : globalLimit

    if (limit === null) {
      keptVideos.push(video)
      continue
    }

    const group = hasDailyLimit
      ? `${video.authorId}\0${getLocalPublicationDay(video)}`
      : video.authorId
    const count = counts.get(group) ?? 0

    if (count < limit) {
      const keptIndex = keptVideos.length
      if (count === 0) firstKeptIndexByGroup.set(group, keptIndex)
      counts.set(group, count + 1)
      keptVideos.push(video)
      continue
    }

    const firstKeptIndex = firstKeptIndexByGroup.get(group)
    if (firstKeptIndex !== undefined) {
      hiddenCountsByKeptIndex.set(
        firstKeptIndex,
        (hiddenCountsByKeptIndex.get(firstKeptIndex) ?? 0) + 1
      )
    }
  }

  if (hiddenCountsByKeptIndex.size === 0) return keptVideos

  return keptVideos.map((video, index) => {
    const hiddenCount = hiddenCountsByKeptIndex.get(index)
    return hiddenCount === undefined
      ? video
      : { ...video, subscriptionHiddenVideoCount: hiddenCount }
  })
}

/**
 * @param {object} video
 */
function getLocalPublicationDay(video) {
  const timestamp = video.published ?? video.publishedTime
  const date = new Date(timestamp)

  if (!Number.isFinite(date.getTime())) return 'unknown'

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}
