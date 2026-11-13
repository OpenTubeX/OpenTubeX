import { checkYoutubeChannelId, findChannelTagInfo } from './channels'
import { getPlatformFetch } from './platformFetch'
import { showToast } from './utils'
import { supportsYtDlp } from './ytDlpCapabilities'
import { getPlatform, getPlatformChannelKey } from '../../platforms/index'

/**
 * The settings that can be remembered per channel. They are keyed by YouTube
 * channel ID, or for channels of other platforms by `platform:id`, see
 * `getPlatformChannelPreferenceKey`.
 * The values are the keys of the settings that store them.
 * @type {readonly {
 *   type: 'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume',
 *   valuesKey: string,
 *   autoUpdateKey: string
 * }[]}
 */
export const CHANNEL_PREFERENCE_TYPES = Object.freeze([
  {
    type: 'playbackSpeed',
    valuesKey: 'channelPlaybackSpeeds',
    autoUpdateKey: 'autoUpdateChannelPlaybackSpeeds'
  },
  {
    type: 'videoQuality',
    valuesKey: 'channelVideoQualities',
    autoUpdateKey: 'autoUpdateChannelVideoQualities'
  },
  {
    type: 'subtitlesState',
    valuesKey: 'channelSubtitlesStates',
    autoUpdateKey: 'autoUpdateChannelSubtitlesStates'
  },
  {
    type: 'volume',
    valuesKey: 'channelVolumes',
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
 * The key that remembers the settings of a channel on another platform. Its
 * ID comes from the channel's address, which is all that media pages know
 * about their creator without another request.
 * @param {{ platform: string, id: string, url?: string }} channel
 * @returns {string}
 */
export function getPlatformChannelPreferenceKey(channel) {
  const id = (channel.url && getPlatform(channel.platform)?.parseChannelUrl(channel.url)) || channel.id
  return getPlatformChannelKey({ platform: channel.platform, id })
}

/**
 * YouTube channel IDs never contain a colon, so only platform keys split.
 * @param {string} key
 * @returns {{ platform: string, id: string } | null}
 */
export function parsePlatformChannelPreferenceKey(key) {
  const separator = key.indexOf(':')
  if (separator === -1) return null
  const platform = key.slice(0, separator)
  const id = key.slice(separator + 1)
  return getPlatform(platform) && id ? { platform, id } : null
}

/**
 * @param {string} type
 * @param {unknown} value
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function formatChannelPreferenceValue(type, value, t) {
  switch (type) {
    case 'playbackSpeed':
      return `${value}×`
    case 'videoQuality':
      return String(value) === 'auto' ? t('Settings.Player Settings.Default Quality.Auto') : `${value}p`
    case 'subtitlesState':
      return value ? '✓' : '✕'
    default:
      return `${Math.round(Number(value) * 100)}%`
  }
}

/** @type {Readonly<Record<string, { message: (t: (key: string) => string) => string, icon: string[] }>>} */
const SAVED_TOASTS = Object.freeze({
  playbackSpeed: { message: t => t('Video.Channel Playback Speed Saved'), icon: ['fas', 'gauge'] },
  videoQuality: { message: t => t('Video.Channel Video Quality Saved'), icon: ['fas', 'film'] },
  subtitlesState: { message: t => t('Video.Channel Subtitles State Saved'), icon: ['fas', 'closed-captioning'] },
  volume: { message: t => t('Video.Channel Volume Saved'), icon: ['fas', 'volume-high'] }
})

/**
 * Saves a setting that the user chose to remember for a channel, and confirms it.
 * @param {import('vuex').Store} store
 * @param {string} channelId
 * @param {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} type
 * @param {unknown} value
 * @param {(key: string) => string} t
 */
export async function saveChannelPreferenceWithToast(store, channelId, type, value, t) {
  if (!channelId || value === null) return

  if (await saveChannelPreference(store, channelId, type, value)) {
    const { message, icon } = SAVED_TOASTS[type]
    showToast({ message: `${message(t)}: ${formatChannelPreferenceValue(type, value, t)}`, icon })
  } else {
    showToast({ message: t('Channel.Failed to save subscription settings'), icon: ['fas', 'circle-exclamation'] })
  }
}

/**
 * Edits the saved values of one setting for any number of channels. The store
 * applies the edit again to the saved values, so it keeps the changes that
 * other tabs and windows save meanwhile. `change` can therefore run more than once.
 * @param {import('vuex').Store} store
 * @param {string} type
 * @param {(values: Record<string, unknown>) => boolean} change edits the values, returns whether they changed
 * @returns {Promise<boolean>} whether the values were saved, `true` when nothing changed
 */
export async function updateChannelPreferences(store, type, change) {
  const preference = CHANNEL_PREFERENCE_TYPES.find(preference => preference.type === type)
  if (!preference) return false

  const { valuesKey } = preference
  const suffix = valuesKey[0].toUpperCase() + valuesKey.slice(1)
  if (!change(parseChannelPreferences(store.getters[`get${suffix}`], valuesKey))) return true

  return store.dispatch(`update${suffix}`, (saved) => {
    const values = parseChannelPreferences(saved, valuesKey)
    return change(values) ? JSON.stringify(values) : saved
  })
}

/**
 * @param {import('vuex').Store} store
 * @param {string} channelId
 * @param {string} type
 * @param {unknown} value
 * @returns {Promise<boolean>} whether the value was saved
 */
export function saveChannelPreference(store, channelId, type, value) {
  if (!channelId) return Promise.resolve(false)
  return updateChannelPreferences(store, type, values => {
    values[channelId] = value
    return true
  })
}

/**
 * Remove one saved override without changing the current player state.
 * @param {import('vuex').Store} store
 * @param {string} channelId
 * @param {string} type
 * @param {(value: unknown) => boolean} [shouldRemove] checked against the latest saved value
 * @returns {Promise<boolean>} whether the removal was saved, `true` when nothing was removed
 */
export function removeChannelPreference(store, channelId, type, shouldRemove = () => true) {
  if (!channelId) return Promise.resolve(true)
  return updateChannelPreferences(store, type, values => {
    if (!Object.hasOwn(values, channelId) || !shouldRemove(values[channelId])) return false
    delete values[channelId]
    return true
  })
}

/**
 * @typedef {{ name: string, thumbnail: string }} ChannelInfo
 */

/**
 * Resolved channels are shared between the components that show them and
 * kept for the lifetime of the session, so that reopening the manager doesn't refetch them.
 * Channels that don't exist are kept as `null`, so their results don't retry.
 * @type {Map<string, ChannelInfo | null>}
 */
const resolvedChannels = new Map()
/** @type {Map<string, { request: Promise<ChannelInfo | null>, wanted: (() => boolean)[] }>} */
const pendingChannels = new Map()
// Result lists ask for every unknown author and collaborator list they show.
// Keep those requests from competing with the page's own requests. Other callers ask for one channel and
// skip the queue, so slow result lookups cannot hold them up.
const MAX_CONCURRENT_CHANNEL_REQUESTS = 4
let activeChannelRequests = 0
/** @type {{ start: (started: boolean) => void, isWanted: () => boolean }[]} */
const queuedChannelRequests = []

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
 * @param {{ throttle?: boolean, isWanted?: () => boolean }} [options] `throttle` queues result list
 *   lookups behind each other. A queued lookup that no caller wants anymore is dropped and resolves `null`.
 * @returns {Promise<ChannelInfo | null>} `null` when the channel couldn't be resolved
 */
export async function fetchChannelInfo(channelId, backendOptions, { throttle = false, isWanted = () => true } = {}) {
  if (resolvedChannels.has(channelId)) {
    return resolvedChannels.get(channelId)
  }

  const pending = pendingChannels.get(channelId)
  if (pending) {
    pending.wanted.push(isWanted)
    return await pending.request
  }

  const platformChannel = parsePlatformChannelPreferenceKey(channelId)
  // Only builds with yt-dlp open the channels of other platforms, and can request them
  if (platformChannel ? !supportsYtDlp : !checkYoutubeChannelId(channelId)) {
    return null
  }

  const resolve = platformChannel
    ? () => resolvePlatformChannelInfo(channelId, platformChannel)
    : () => resolveChannelInfo(channelId, backendOptions)
  const wanted = [isWanted]
  const request = throttle
    ? runChannelRequest(resolve, () => wanted.some(check => check()))
    : resolve()
  pendingChannels.set(channelId, { request, wanted })

  try {
    return await request
  } finally {
    pendingChannels.delete(channelId)
  }
}

/**
 * Runs a result list lookup in the shared queue of channel requests.
 * @template T
 * @param {() => Promise<T>} task
 * @param {() => boolean} isWanted checked before a queued task starts
 * @returns {Promise<T | null>} `null` when the task was dropped
 */
export async function runChannelRequest(task, isWanted) {
  if (activeChannelRequests < MAX_CONCURRENT_CHANNEL_REQUESTS) {
    activeChannelRequests++
  } else if (!await new Promise(resolve => queuedChannelRequests.push({ start: resolve, isWanted }))) {
    return null
  }
  try {
    return await task()
  } finally {
    releaseChannelRequestSlot()
  }
}

function releaseChannelRequestSlot() {
  // Hand the slot to the next wanted request, so no new request can take it
  // first. Lookups for results that are gone are dropped without a request.
  let next
  while ((next = queuedChannelRequests.shift())) {
    if (next.isWanted()) {
      next.start(true)
      return
    }
    next.start(false)
  }
  activeChannelRequests--
}

async function resolveChannelInfo(channelId, backendOptions) {
  try {
    const { preferredName, icon, invalidId } = await findChannelTagInfo(channelId, backendOptions)

    if (invalidId) {
      resolvedChannels.set(channelId, null)
    }
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

/**
 * @param {string} key
 * @param {{ platform: string, id: string }} channel
 * @returns {Promise<ChannelInfo | null>}
 */
async function resolvePlatformChannelInfo(key, { platform, id }) {
  try {
    const channel = await getPlatform(platform).getChannel(getPlatformFetch(platform), id)

    if (channel === null) {
      resolvedChannels.set(key, null)
      return null
    }

    const info = { name: channel.name, thumbnail: channel.avatar ?? '' }
    resolvedChannels.set(key, info)
    return info
  } catch (error) {
    console.error(`Failed to fetch the channel info for ${key}:`, error)
    return null
  }
}
