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

// Tabs share a store. Read each collection only after earlier removals finish.
const pendingChannelPreferenceRemovals = new WeakMap()

/**
 * Remove one saved override without changing the current player state.
 * @param {import('vuex').Store} store
 * @param {string} channelId
 * @param {string} type
 * @returns {Promise<unknown>}
 */
export async function removeChannelPreference(store, channelId, type) {
  const preference = CHANNEL_PREFERENCE_TYPES.find(preference => preference.type === type)
  if (!channelId || !preference) return

  const previous = pendingChannelPreferenceRemovals.get(store) ?? Promise.resolve()
  const removal = previous.catch(() => {}).then(() => {
    const { valuesKey } = preference
    const suffix = valuesKey[0].toUpperCase() + valuesKey.slice(1)
    const values = parseChannelPreferences(store.getters[`get${suffix}`], valuesKey)
    if (!Object.hasOwn(values, channelId)) return

    delete values[channelId]
    return store.dispatch(`update${suffix}`, JSON.stringify(values))
  })
  pendingChannelPreferenceRemovals.set(store, removal)
  try {
    return await removal
  } finally {
    if (pendingChannelPreferenceRemovals.get(store) === removal) {
      pendingChannelPreferenceRemovals.delete(store)
    }
  }
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
// Result lists ask for every unknown author they show. Keep those requests from
// competing with the page's own requests. Other callers ask for one channel and
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

  if (!checkYoutubeChannelId(channelId)) {
    return null
  }

  const wanted = [isWanted]
  const request = throttle
    ? runChannelRequest(() => resolveChannelInfo(channelId, backendOptions), () => wanted.some(check => check()))
    : resolveChannelInfo(channelId, backendOptions)
  pendingChannels.set(channelId, { request, wanted })

  try {
    return await request
  } finally {
    pendingChannels.delete(channelId)
  }
}

/**
 * @template T
 * @param {() => Promise<T>} task
 * @param {() => boolean} isWanted checked before a queued task starts
 * @returns {Promise<T | null>}
 */
async function runChannelRequest(task, isWanted) {
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
