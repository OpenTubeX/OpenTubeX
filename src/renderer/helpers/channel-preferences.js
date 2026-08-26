import { checkYoutubeChannelId, findChannelTagInfo } from './channels'

/**
 * The settings that can be remembered per channel.
 * The values are the keys of the settings that store them.
 * @type {readonly {
 *   type: 'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume',
 *   valuesKey: string,
 *   rememberKey: string,
 *   autoUpdateKey: string
 * }[]}
 */
export const CHANNEL_PREFERENCE_TYPES = Object.freeze([
  {
    type: 'playbackSpeed',
    valuesKey: 'channelPlaybackSpeeds',
    rememberKey: 'rememberPlaybackSpeedPerChannel',
    autoUpdateKey: 'autoUpdateChannelPlaybackSpeeds'
  },
  {
    type: 'videoQuality',
    valuesKey: 'channelVideoQualities',
    rememberKey: 'rememberVideoQualityPerChannel',
    autoUpdateKey: 'autoUpdateChannelVideoQualities'
  },
  {
    type: 'subtitlesState',
    valuesKey: 'channelSubtitlesStates',
    rememberKey: 'rememberSubtitlesStatePerChannel',
    autoUpdateKey: 'autoUpdateChannelSubtitlesStates'
  },
  {
    type: 'volume',
    valuesKey: 'channelVolumes',
    rememberKey: 'rememberVolumePerChannel',
    autoUpdateKey: 'autoUpdateChannelVolumes'
  }
])

/**
 * Parses one of the JSON string settings that map channel ids to a remembered value.
 * @param {string} value
 * @param {string} settingKey used to identify the setting in the error message
 * @returns {Record<string, unknown>}
 */
export function parseChannelPreferences(value, settingKey) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    console.error(`Failed to parse ${settingKey}:`, error)
    return {}
  }
}

/**
 * @typedef {{ name: string, thumbnail: string }} ChannelInfo
 */

/**
 * Resolved channels are shared between the components that show them and
 * kept for the lifetime of the session, so that reopening the manager doesn't refetch them.
 * @type {Map<string, ChannelInfo>}
 */
const resolvedChannels = new Map()
/** @type {Map<string, Promise<ChannelInfo | null>>} */
const pendingChannels = new Map()

/**
 * Resolves a channel id to a name and avatar without a network request, if possible.
 * @param {string} channelId
 * @param {Map<string, ChannelInfo>} subscriptionsById the `getSubscribedChannelsById` getter
 * @returns {ChannelInfo | null}
 */
export function getCachedChannelInfo(channelId, subscriptionsById) {
  const subscription = subscriptionsById.get(channelId)

  if (subscription?.name) {
    return { name: subscription.name, thumbnail: subscription.thumbnail ?? '' }
  }

  return resolvedChannels.get(channelId) ?? null
}

/**
 * Fetches the name and avatar of a channel that isn't known locally and caches them for the session.
 * @param {string} channelId
 * @param {{ preference: string, fallback: boolean }} backendOptions
 * @returns {Promise<ChannelInfo | null>} `null` when the channel couldn't be resolved
 */
export async function fetchChannelInfo(channelId, backendOptions) {
  if (resolvedChannels.has(channelId)) {
    return resolvedChannels.get(channelId)
  }

  if (pendingChannels.has(channelId)) {
    return await pendingChannels.get(channelId)
  }

  if (!checkYoutubeChannelId(channelId)) {
    return null
  }

  const request = resolveChannelInfo(channelId, backendOptions)
  pendingChannels.set(channelId, request)

  try {
    return await request
  } finally {
    pendingChannels.delete(channelId)
  }
}

async function resolveChannelInfo(channelId, backendOptions) {
  try {
    const { preferredName, icon, invalidId } = await findChannelTagInfo(channelId, backendOptions)

    if (invalidId || !preferredName) {
      return null
    }

    const info = { name: preferredName, thumbnail: icon ?? '' }
    resolvedChannels.set(channelId, info)
    return info
  } catch (error) {
    console.error(`Failed to fetch the channel info for ${channelId}:`, error)
    return null
  }
}
