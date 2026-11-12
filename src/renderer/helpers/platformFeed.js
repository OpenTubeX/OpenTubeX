import { computed, shallowRef } from 'vue'
import { LocalNotifications } from '@capacitor/local-notifications'

import store from '../store/index'
import i18n from '../i18n/index'
import { getPlatformFetch } from './platformFetch'
import { configureAndroidTwitchLive, observeAndroidTwitchLive } from './androidSubscriptionRefresh'
import { isAppHidden } from './appVisibility'
import { capacitorNotificationHistory } from './capacitorNotificationHistory'
import { getTwitchLocalNotificationId } from './capacitorSystemNotifications'
import { notificationThumbnailsAllowed, openNotificationEntry, showInAppNotification } from './notificationHistory'
import { isRssFeedItemSeen, onRssFeedSeenItemsSynced, parseRssFeedSeenItems, toRssFeedSeenMarks } from './rssFeedSeenItems'
import { unmarkExternalMediaWatchedBefore } from './externalMediaPosition'
import { supportsYtDlp } from './ytDlpCapabilities'
import {
  findPlatformChannel,
  getPlatform,
  getPlatformChannelKey,
  getPlatformItemKey,
  PLATFORMS
} from '../../platforms/index'
import {
  fetchTwitchChannels,
  getTwitchLiveNotificationTarget,
  parseTwitchChannelLogin,
  sortNewestFirst,
  takeNewTwitchStreams
} from '../../twitchFollows'

/**
 * @typedef {import('../../platforms/types').Platform} Platform
 * @typedef {import('../../platforms/types').PlatformChannel} PlatformChannel
 * @typedef {import('../../platforms/types').PlatformItem} PlatformItem
 * @typedef {{ platform: string, id: string, name: string, url: string, avatar?: string }} FollowedChannel
 * @typedef {{ live: PlatformItem[], videos: PlatformItem[], clips: PlatformItem[], channelKeys: string[] }} PlatformFeedCache
 * the items, and the channels they were loaded for
 * @typedef {{ enabled: boolean, channels: { id: string, login: string, name: string }[], title: string }} TwitchLiveConfiguration
 */

const FEED_STORAGE_KEY = 'platformFeed'
const LAST_REFRESH_STORAGE_KEY = 'platformFeedLastRefresh'
const NEXT_AUTO_REFRESH_STORAGE_KEY = 'platformFeedNextAutoRefresh'
const FILTER_STORAGE_KEY = 'platformFeedFilter'
/** The items each channel had when it loaded before, so that later ones are new */
const HISTORY_STORAGE_KEY = 'platformFeedHistory'
const MAX_HISTORY_PER_CHANNEL = 300
/** The streams of each channel at the last check, on iOS, where the app checks on its own */
const KNOWN_STREAMS_STORAGE_KEY = 'twitchKnownStreams'
const LIVE_CHECK_INTERVAL_MS = 3 * 60_000
/** Channels of platforms without batch requests that load at once */
const CHANNEL_CONCURRENCY = 4
const isAndroid = process.env.IS_CAPACITOR && !process.env.IS_IOS

/** @returns {PlatformFeedCache} */
function loadFeed() {
  try {
    const feed = JSON.parse(localStorage.getItem(FEED_STORAGE_KEY) ?? 'null')
    if (['live', 'videos', 'clips', 'channelKeys'].every(key => Array.isArray(feed?.[key]))) return feed
  } catch { }
  return { live: [], videos: [], clips: [], channelKeys: [] }
}

/**
 * @param {string} key
 * @returns {number | null}
 */
function loadTimestamp(key) {
  try {
    const timestamp = Number(localStorage.getItem(key))
    return timestamp > 0 ? timestamp : null
  } catch {
    return null
  }
}

/** @returns {number | null} */
function loadLastRefresh() {
  return loadTimestamp(LAST_REFRESH_STORAGE_KEY)
}

/** @returns {number | null} */
export function loadPlatformFeedNextAutoRefresh() {
  return loadTimestamp(NEXT_AUTO_REFRESH_STORAGE_KEY)
}

/** The cached items of the followed channels, so they show right away after a restart */
export const platformFeed = shallowRef(loadFeed())
export const platformFeedLastRefresh = shallowRef(loadLastRefresh())
export const platformFeedRefreshing = shallowRef(false)
/** The channels that failed in the last refresh, by key */
export const platformFeedFailedChannels = shallowRef(/** @type {string[]} */ ([]))
/** When a window refreshes the feed next on its own */
export const platformFeedNextAutoRefresh = shallowRef(loadPlatformFeedNextAutoRefresh())
/** The platform whose items the feed shows, or `all` */
export const platformFeedFilter = shallowRef(localStorage.getItem(FILTER_STORAGE_KEY) ?? 'all')

/** @param {string} platform */
export function setPlatformFeedFilter(platform) {
  platformFeedFilter.value = platform
  localStorage.setItem(FILTER_STORAGE_KEY, platform)
}

/** The platforms of the followed channels, in the usual order */
export const followedPlatforms = computed(() => {
  const ids = new Set(getFollowedChannels().map(channel => channel.platform))
  return PLATFORMS.filter(platform => ids.has(platform.id))
})

/** The filter, or `all` once no followed channel is on its platform */
export const activePlatformFeedFilter = computed(() => {
  return followedPlatforms.value.some(platform => platform.id === platformFeedFilter.value) ? platformFeedFilter.value : 'all'
})

/**
 * The kinds of items that the shown platforms have, which the tabbed view has a
 * tab for each.
 * @type {import('vue').ComputedRef<('videos' | 'live' | 'clips')[]>}
 */
export const platformFeedCategories = computed(() => {
  const platforms = followedPlatforms.value.filter(platform => activePlatformFeedFilter.value === 'all' || platform.id === activePlatformFeedFilter.value)
  return [
    'videos',
    ...(platforms.some(platform => platform.liveStreams) ? /** @type {const} */ (['live']) : []),
    ...(platforms.some(platform => platform.channelTabs.includes('clips')) ? /** @type {const} */ (['clips']) : [])
  ]
})

/**
 * The deadline is shared, so that only one window refreshes the feed.
 * @param {number | null} timestamp
 */
export function setPlatformFeedNextAutoRefresh(timestamp) {
  platformFeedNextAutoRefresh.value = timestamp
  try {
    if (timestamp === null) localStorage.removeItem(NEXT_AUTO_REFRESH_STORAGE_KEY)
    else localStorage.setItem(NEXT_AUTO_REFRESH_STORAGE_KEY, String(timestamp))
  } catch (error) {
    console.error('Failed to save the next platform feed refresh', error)
  }
}

/**
 * The auto refresh interval in milliseconds, 0 while it doesn't apply.
 */
export function getPlatformFeedAutoRefreshInterval() {
  if (getFollowedChannels().length === 0) return 0
  return Math.max(Number.parseInt(store.getters.getPlatformFeedAutoRefreshInterval, 10) || 0, 0)
}

/** @param {PlatformFeedCache} feed */
function setFeed(feed) {
  platformFeed.value = feed
  try {
    localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(feed))
  } catch (error) {
    console.error('Failed to cache the platform feed', error)
  }
}

if (typeof window !== 'undefined') {
  // Other windows refresh the feed too
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === FEED_STORAGE_KEY) platformFeed.value = loadFeed()
    if (event.key === null || event.key === LAST_REFRESH_STORAGE_KEY) platformFeedLastRefresh.value = loadLastRefresh()
    if (event.key === null || event.key === NEXT_AUTO_REFRESH_STORAGE_KEY) platformFeedNextAutoRefresh.value = loadPlatformFeedNextAutoRefresh()
  })
}

/**
 * Items open through yt-dlp, so only builds with it can follow channels.
 */
export const supportsPlatformFollows = supportsYtDlp

/** @returns {FollowedChannel[]} */
export function getFollowedChannels() {
  return supportsPlatformFollows ? store.getters.getFollowedChannels : []
}

/**
 * @param {PlatformItem} item
 */
function itemChannelKey(item) {
  return getPlatformChannelKey({ platform: item.platform, id: item.channelId })
}

/**
 * The followed channel that an ID from a channel's address or an earlier lookup belongs to.
 * @param {string} platformId
 * @param {string} id
 * @returns {FollowedChannel | undefined}
 */
export function findFollowedChannel(platformId, id) {
  const platform = getPlatform(platformId)
  return getFollowedChannels().find(channel => channel.platform === platformId &&
    (channel.id === id || platform?.parseChannelUrl(channel.url) === id))
}

/**
 * @param {PlatformItem} item
 * @param {boolean} isNew
 * @returns {PlatformItem}
 */
function withNew(item, isNew) {
  if (isNew) return item.isNew ? item : { ...item, isNew: true }
  if (!item.isNew) return item
  const copy = { ...item }
  delete copy.isNew
  return copy
}

/** @returns {Record<string, string[]>} */
function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '{}')
    return history && typeof history === 'object' && !Array.isArray(history) ? history : {}
  } catch {
    return {}
  }
}

/** @param {Record<string, string[]>} history */
function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch (error) {
    console.error('Failed to save the platform feed history', error)
  }
}

/**
 * Live streams and uploads that appeared since their channel loaded before are
 * new until they are seen. The first load of a channel has nothing to compare
 * to. The video that records a live stream isn't new again once the stream ends.
 * @param {PlatformItem[]} items loaded live streams and uploads
 * @param {string[]} channelKeys the channels whose items loaded, to remember them
 * @returns {PlatformItem[]}
 */
function reconcileNewItems(items, channelKeys) {
  const history = loadHistory()
  const marks = toRssFeedSeenMarks(store.getters.getRssFeedSeenItems)
  const current = platformFeed.value
  const wasNew = new Set([...current.live, ...current.videos].filter(item => item.isNew).map(getPlatformItemKey))
  const reconciled = items.map((item) => {
    const key = getPlatformItemKey(item)
    const seen = marks.get(key)
    const known = history[itemChannelKey(item)]
    return withNew(item, seen === undefined
      ? Array.isArray(known) && (wasNew.has(key) || !known.includes(item.id))
      : !seen)
  })
  for (const channelKey of channelKeys) {
    const ids = items.filter(item => itemChannelKey(item) === channelKey)
      .flatMap(item => item.archiveId ? [item.id, item.archiveId] : [item.id])
    history[channelKey] = [...new Set([...ids, ...history[channelKey] ?? []])].slice(0, MAX_HISTORY_PER_CHANNEL)
  }
  saveHistory(history)
  return reconciled
}

/**
 * @param {PlatformFeedCache} feed
 * @param {Map<string, boolean>} marks whether each marked item is seen
 * @returns {PlatformFeedCache}
 */
function applySeenMarks(feed, marks) {
  let changed = false
  const apply = (/** @type {PlatformItem[]} */ items) => items.map((item) => {
    const seen = marks.get(getPlatformItemKey(item))
    const next = seen === undefined ? item : withNew(item, !seen)
    if (next !== item) changed = true
    return next
  })
  const next = { ...feed, live: apply(feed.live), videos: apply(feed.videos) }
  return changed ? next : feed
}

/**
 * @param {PlatformItem[]} items
 */
export function markPlatformItemsAsSeen(items) {
  setPlatformItemsSeen(items, true)
}

/**
 * @param {PlatformItem[]} items
 */
export function markPlatformItemsAsUnseen(items) {
  setPlatformItemsSeen(items, false)
}

/**
 * @param {PlatformItem[]} items
 * @param {boolean} seen
 */
function setPlatformItemsSeen(items, seen) {
  const keys = new Set(items.map(getPlatformItemKey))
  const { live, videos } = platformFeed.value
  const changedKeys = [...live, ...videos]
    .filter(item => (!seen || item.isNew === true) && keys.has(getPlatformItemKey(item)))
    .map(getPlatformItemKey)
  if (changedKeys.length === 0) return
  store.dispatch('mergeRssFeedSeenItems', { keys: changedKeys, seen }).catch((error) => {
    console.error('Failed to save the seen platform items', error)
  })
  setFeed(applySeenMarks(platformFeed.value, new Map(changedKeys.map(key => [key, seen]))))
}

/** For the cards of live streams and uploads */
export const platformSeenMarks = { markSeen: markPlatformItemsAsSeen, markUnseen: markPlatformItemsAsUnseen }

// Marks also change in other windows and with syncs
store.watch((_, getters) => getters.getRssFeedSeenItems, (value) => {
  const feed = applySeenMarks(platformFeed.value, toRssFeedSeenMarks(value))
  if (feed !== platformFeed.value) setFeed(feed)
})

/**
 * Devices can watch an upload and mark it as unseen without knowing about each
 * other. As with RSS items, the later change wins, so an unseen mark after the
 * upload was last saved as watched unmarks it as watched, and brings it back to
 * the New feed. Live streams have no watched state.
 * @param {PlatformItem[]} items
 * @param {import('./rssFeedSeenItems').RssFeedSeenItem[]} entries
 */
function unwatchItemsMarkedUnseen(items, entries) {
  const unseenAt = new Map(entries.filter(entry => !isRssFeedItemSeen(entry)).map(entry => [entry.key, entry.unseenAt ?? 0]))
  if (unseenAt.size === 0) return
  for (const item of items) {
    const timestamp = item.isLive ? undefined : unseenAt.get(getPlatformItemKey(item))
    if (timestamp !== undefined) unmarkExternalMediaWatchedBefore(item.url, timestamp)
  }
}

onRssFeedSeenItemsSynced(entries => unwatchItemsMarkedUnseen(platformFeed.value.videos, entries))

/**
 * @param {PlatformItem[]} items
 */
function sortLive(items) {
  return items.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
}

/**
 * Replaces the items of some channels, keeping those of the others.
 * @param {Set<string>} channelKeys
 * @param {{ live: PlatformItem[], videos: PlatformItem[], clips: PlatformItem[] }} items the new items of these channels
 * @param {boolean} [loaded] whether the items loaded, or the channels were removed
 */
function replaceChannelItems(channelKeys, { live, videos, clips }, loaded = true) {
  const current = platformFeed.value
  const others = (/** @type {PlatformItem[]} */ items) => items.filter(item => !channelKeys.has(itemChannelKey(item)))
  setFeed({
    live: sortLive([...others(current.live), ...live]),
    videos: sortNewestFirst([...others(current.videos), ...videos]),
    clips: sortNewestFirst([...others(current.clips), ...clips]),
    channelKeys: [...current.channelKeys.filter(key => !channelKeys.has(key)), ...(loaded ? channelKeys : [])]
  })
}

/**
 * @param {PlatformItem[]} items
 * @param {string[]} channelKeys
 */
function splitLoadedItems(items, channelKeys) {
  const reconciled = reconcileNewItems(items, channelKeys)
  return {
    live: reconciled.filter(item => item.isLive),
    videos: reconciled.filter(item => !item.isLive)
  }
}

/**
 * Updates the live streams of Twitch channels, which the app checks more often
 * than the rest.
 * @param {PlatformItem[]} live the live streams of the followed Twitch channels
 */
export function applyTwitchLiveStreams(live) {
  const keys = new Set(getFollowedChannels().filter(channel => channel.platform === 'twitch').map(getPlatformChannelKey))
  // Channels that never loaded start comparing when their uploads load
  const history = loadHistory()
  const followedLive = live.filter(stream => keys.has(itemChannelKey(stream)))
  const current = platformFeed.value
  setFeed({
    ...current,
    live: sortLive([
      ...current.live.filter(item => item.platform !== 'twitch'),
      ...reconcileNewItems(followedLive, [...keys].filter(key => Array.isArray(history[key])))
    ])
  })
}

/** Whether this window loaded the feed */
let refreshedHere = false

/**
 * The cached items cover the followed channels until the feed loads in a
 * window, unless the feed is fetched on startup. Channels followed on another
 * device need a refresh.
 */
export function platformFeedNeedsRefresh() {
  const followed = getFollowedChannels()
  if (followed.length === 0) return false
  if (!refreshedHere && (store.getters.getFetchSubscriptionsAutomatically || platformFeedLastRefresh.value === null)) return true
  const cached = new Set(platformFeed.value.channelKeys)
  return followed.some(channel => !cached.has(getPlatformChannelKey(channel)))
}

/**
 * Loads the feed when its cached items don't cover the followed channels.
 */
export function refreshPlatformFeedIfNeeded() {
  if (!platformFeedRefreshing.value && platformFeedNeedsRefresh()) refreshPlatformFeed()
}

/**
 * Channels can be renamed and change their avatar. The followed channels are
 * identified by their ID, so they keep their place.
 * @param {PlatformChannel[]} channels
 */
async function updateChannelDetails(channels) {
  const current = new Map(channels.map(channel => [getPlatformChannelKey(channel), channel]))
  const update = (/** @type {FollowedChannel} */ channel) => {
    const next = current.get(getPlatformChannelKey(channel))
    return next ? toFollowedChannel(next) : channel
  }
  const changed = getFollowedChannels().some(channel => JSON.stringify(update(channel)) !== JSON.stringify(channel))
  if (!changed) return
  // The channels may have changed during the refresh
  await store.dispatch('updateFollowedChannels', getFollowedChannels().map(update))
}

/**
 * @param {PlatformChannel} channel
 * @returns {FollowedChannel}
 */
function toFollowedChannel({ platform, id, name, url, avatar }) {
  return { platform, id, name, url, ...(avatar ? { avatar } : {}) }
}

/**
 * Runs the task for every value, a few at a time, until the signal aborts.
 * @template T
 * @param {T[]} values
 * @param {AbortSignal} signal
 * @param {(value: T) => Promise<void>} task
 */
async function forEachConcurrently(values, signal, task) {
  let next = 0
  const worker = async () => {
    while (next < values.length && !signal.aborted) await task(values[next++])
  }
  await Promise.all(Array.from({ length: Math.min(CHANNEL_CONCURRENCY, values.length) }, worker))
}

/**
 * Loads the newest uploads of a channel. They belong to it, whatever channel
 * ID the platform reports for them.
 * @param {import('../../platforms/types').Platform} platform
 * @param {PlatformChannel} channel
 * @param {AbortSignal} [signal]
 */
async function loadChannelItems(platform, channel, signal) {
  const items = await platform.getLatestItems(getPlatformFetch(platform.id), channel, signal)
  return items.map(item => ({ ...item, platform: platform.id, channelId: channel.id }))
}

let activeRefresh = null

/**
 * Loads the live streams, uploads and clips of every followed channel. Channels
 * that fail keep their previous items.
 */
export async function refreshPlatformFeed() {
  activeRefresh?.abort()
  const controller = new AbortController()
  activeRefresh = controller
  platformFeedRefreshing.value = true
  try {
    const followed = getFollowedChannels()
    /** @type {Map<string, FollowedChannel[]>} */
    const byPlatform = new Map()
    for (const channel of followed) {
      if (getPlatform(channel.platform)) byPlatform.set(channel.platform, [...byPlatform.get(channel.platform) ?? [], channel])
    }
    /** @type {PlatformItem[]} */
    const items = []
    /** @type {PlatformItem[]} */
    const clips = []
    /** @type {PlatformChannel[]} */
    const details = []
    const failed = new Set(followed.filter(channel => !getPlatform(channel.platform)).map(getPlatformChannelKey))
    await Promise.all([...byPlatform].map(async ([platformId, channels]) => {
      const platform = /** @type {Platform} */ (getPlatform(platformId))
      if (platform.getFeed) {
        try {
          const result = await platform.getFeed(getPlatformFetch(platform.id), channels, controller.signal)
          items.push(...result.items)
          clips.push(...result.clips)
          details.push(...result.channels)
        } catch (error) {
          if (!controller.signal.aborted) console.error(`Failed to refresh the ${platform.name} channels`, error)
          channels.forEach(channel => failed.add(getPlatformChannelKey(channel)))
        }
        return
      }
      await forEachConcurrently(channels, controller.signal, async (channel) => {
        try {
          items.push(...await loadChannelItems(platform, channel, controller.signal))
        } catch (error) {
          if (!controller.signal.aborted) console.error(`Failed to refresh the ${platform.name} channel ${channel.id}`, error)
          failed.add(getPlatformChannelKey(channel))
        }
      })
    }))
    if (controller.signal.aborted) return

    refreshedHere = true
    const loadedKeys = followed.map(getPlatformChannelKey).filter(key => !failed.has(key))
    const { live, videos } = splitLoadedItems(items, loadedKeys)
    // Uploads can be marked on another device before they load here
    unwatchItemsMarkedUnseen(videos, parseRssFeedSeenItems(store.getters.getRssFeedSeenItems))
    replaceChannelItems(new Set(loadedKeys), { live, videos, clips })
    platformFeedFailedChannels.value = [...failed]
    platformFeedLastRefresh.value = Date.now()
    localStorage.setItem(LAST_REFRESH_STORAGE_KEY, String(platformFeedLastRefresh.value))
    const interval = getPlatformFeedAutoRefreshInterval()
    setPlatformFeedNextAutoRefresh(interval > 0 ? Date.now() + interval : null)
    await updateChannelDetails(details)
  } finally {
    if (activeRefresh === controller) {
      activeRefresh = null
      platformFeedRefreshing.value = false
    }
  }
}

export function cancelPlatformFeedRefresh() {
  activeRefresh?.abort()
}

/** Thrown for input that is no channel address of a supported platform */
export class PlatformChannelInputError extends Error {}

/**
 * Follows a channel.
 * @param {string} platformId
 * @param {string} id the channel's ID, or one from the address of one of its pages
 * @returns {Promise<{ channel: FollowedChannel, followed: boolean } | null>} null for
 * unknown channels, `followed` is false when the channel was followed already
 */
export async function followPlatformChannel(platformId, id) {
  const platform = getPlatform(platformId)
  if (!platform) throw new PlatformChannelInputError('Unknown platform')
  const channel = await platform.getChannel(getPlatformFetch(platform.id), id)
  if (channel === null) return null
  const followedChannel = toFollowedChannel(channel)
  const key = getPlatformChannelKey(channel)
  if (getFollowedChannels().some(followed => getPlatformChannelKey(followed) === key)) {
    return { channel: followedChannel, followed: false }
  }
  // Cached first, so that the tab shows the channel without a refresh. Its
  // current items are where later ones are compared to. Without them, the next
  // refresh loads them.
  try {
    const { live, videos } = splitLoadedItems(await loadChannelItems(platform, channel), [key])
    replaceChannelItems(new Set([key]), { live, videos, clips: [] })
  } catch (error) {
    console.error('Failed to load the items of the followed channel', error)
  }
  if (await store.dispatch('updateFollowedChannels', [...getFollowedChannels(), followedChannel]) === false) {
    throw new Error('The channel could not be saved')
  }
  if (process.env.IS_CAPACITOR && platformId === 'twitch' && store.getters.getTwitchLiveNotifications) {
    requestCapacitorNotificationPermission()
  }
  return { channel: followedChannel, followed: true }
}

/**
 * Follows a channel by the address of one of its pages.
 * @param {string} input
 */
export function followChannelByUrl(input) {
  const found = findPlatformChannel(input.trim())
  if (!found) throw new PlatformChannelInputError('Not the address of a channel')
  return followPlatformChannel(found.platform, found.id)
}

/**
 * @param {{ platform: string, id: string }} channel
 */
export async function unfollowPlatformChannel(channel) {
  const key = getPlatformChannelKey(channel)
  await store.dispatch('updateFollowedChannels', getFollowedChannels().filter(followed => getPlatformChannelKey(followed) !== key))
  replaceChannelItems(new Set([key]), { live: [], videos: [], clips: [] }, false)
  // Following it again starts over
  const history = loadHistory()
  delete history[key]
  saveHistory(history)
}

export function openPlatformChannelManager() {
  store.commit('setSettingsWindowSection', { section: 'subscriptions', subpage: 'platform-channels' })
  store.dispatch('showSettingsWindow')
}

export async function requestCapacitorNotificationPermission() {
  try {
    let status = await LocalNotifications.checkPermissions()
    if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
      status = await LocalNotifications.requestPermissions()
    }
    return status.display === 'granted'
  } catch (error) {
    console.error('Failed to request the notification permission', error)
    return false
  }
}

/**
 * Which channels to check, and how to announce their streams.
 * @returns {TwitchLiveConfiguration & { mode?: string, closedApp?: boolean, thumbnails?: boolean }}
 */
function getLiveConfiguration() {
  const channels = getFollowedChannels().flatMap(({ platform, id, name, url }) => {
    const login = platform === 'twitch' ? parseTwitchChannelLogin(url) : null
    return login ? [{ id, login, name }] : []
  })
  return {
    enabled: store.getters.getTwitchLiveNotifications && store.getters.getNotificationMode !== 'off' && channels.length > 0,
    channels,
    title: i18n.global.t('Subscriptions.{channel} is live', { channel: '{channel}' }),
    // Android checks on its own while the app is hidden or closed
    ...(isAndroid
      ? {
          mode: store.getters.getNotificationMode,
          closedApp: store.getters.getEnableClosedAppSubscriptionRefresh,
          thumbnails: notificationThumbnailsAllowed()
        }
      : {})
  }
}

/**
 * Announces a stream on iOS, where the app checks only while it runs.
 * @param {TwitchLiveConfiguration} configuration
 * @param {PlatformItem} stream
 */
async function announceStream(configuration, stream) {
  const channel = configuration.channels.find(({ id }) => id === stream.channelId)
  const target = channel ? getTwitchLiveNotificationTarget(channel.login, stream.id) : null
  if (!target) return
  const notification = {
    title: configuration.title.replaceAll('{channel}', channel.name),
    body: stream.title,
    ...(stream.thumbnail && notificationThumbnailsAllowed() ? { thumbnail: stream.thumbnail } : {})
  }
  if (store.getters.getNotificationMode === 'off') return
  // Checked first, as the system suspends hidden apps, also during the check,
  // so the app may be visible again once it returns
  const granted = (await LocalNotifications.checkPermissions()).display === 'granted'
  if (store.getters.getNotificationMode === 'both') {
    const [entry] = capacitorNotificationHistory.add([{ ...notification, ...target }])
    // Read on another device already
    if (!entry || entry.read) return
    if (!isAppHidden()) {
      showInAppNotification(entry)
      return
    }
  }
  if (!granted) return
  await LocalNotifications.schedule({
    notifications: [{
      id: getTwitchLocalNotificationId(stream.id),
      title: notification.title,
      body: notification.body,
      // Shown right away, so it needs no exact alarm, which the system would ask the user to allow
      isExactNotification: false,
      extra: { twitchLiveTarget: target }
    }]
  })
}

/**
 * Checks which followed channels are live while the app is in use. Android
 * also checks while the app is hidden or closed, and desktop apps check in the
 * main process.
 * @param {TwitchLiveConfiguration} configuration
 */
async function checkLiveStreams(configuration) {
  const channelIds = configuration.channels.map(channel => channel.id)
  try {
    const { feed } = await fetchTwitchChannels(getPlatformFetch('twitch'), channelIds, { liveOnly: true })
    applyTwitchLiveStreams(feed.live)
    if (isAndroid) {
      // Android keeps the streams it announced, also for its own checks
      await observeAndroidTwitchLive(channelIds, feed.live.map(({ channelId, id, title, thumbnail }) => ({ channelId, id, title, ...(thumbnail ? { thumbnail } : {}) })))
      return
    }
    let known = {}
    try {
      known = JSON.parse(localStorage.getItem(KNOWN_STREAMS_STORAGE_KEY) ?? '{}') ?? {}
    } catch { }
    const fresh = takeNewTwitchStreams(known, channelIds, feed.live)
    localStorage.setItem(KNOWN_STREAMS_STORAGE_KEY, JSON.stringify(known))
    for (const stream of fresh) {
      await announceStream(configuration, stream).catch(error => console.error('Failed to announce a Twitch stream', error))
    }
  } catch (error) {
    console.error('Failed to check the live Twitch channels', error)
  }
}

/**
 * Keeps the live stream checks configured, and checks while the app is in use
 * on mobile.
 * @returns {() => void} stops the checks
 */
export function startTwitchLiveNotifications() {
  if (!supportsPlatformFollows) return () => {}
  let stopped = false
  let timer = null
  let lastCheck = 0

  const check = async () => {
    clearTimeout(timer)
    timer = null
    const configuration = getLiveConfiguration()
    if (configuration.enabled && !isAppHidden()) {
      lastCheck = Date.now()
      await checkLiveStreams(configuration)
    }
    if (!stopped) timer = setTimeout(check, LIVE_CHECK_INTERVAL_MS)
  }
  // The checks pause while the app is hidden, and catch up when it returns
  const checkWhenVisible = () => {
    if (!isAppHidden() && timer !== null && Date.now() - lastCheck >= LIVE_CHECK_INTERVAL_MS) check()
  }

  const stopConfiguring = store.watch(() => JSON.stringify(getLiveConfiguration()), (value) => {
    const configuration = JSON.parse(value)
    if (process.env.IS_ELECTRON) {
      window.ftElectron.configureTwitchLiveNotifications(configuration)
        .catch(error => console.error('Failed to configure the Twitch live checks', error))
    } else if (isAndroid) {
      configureAndroidTwitchLive(configuration).catch(error => console.error('Failed to configure the Twitch live checks', error))
    } else if (!configuration.enabled) {
      // Turning notifications on again starts from the streams that are live then
      localStorage.removeItem(KNOWN_STREAMS_STORAGE_KEY)
    }
    if (process.env.IS_CAPACITOR && configuration.enabled && !stopped) check()
  }, { immediate: true })

  let removeLiveListener = null
  let removeTapListener = null
  if (process.env.IS_ELECTRON) {
    removeLiveListener = window.ftElectron.onTwitchLiveUpdated(applyTwitchLiveStreams)
  } else if (process.env.IS_CAPACITOR) {
    document.addEventListener('visibilitychange', checkWhenVisible)
    // iOS notifications; Android shows them like uploads
    LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
      const target = notification?.extra?.twitchLiveTarget
      const checked = getTwitchLiveNotificationTarget(parseTwitchChannelLogin(target?.query?.url), target?.query?.stream)
      if (!checked) return
      capacitorNotificationHistory.markTargetsRead([checked])
      if (actionId !== 'dismiss') openNotificationEntry({ ...checked, read: true })
    }).then(handle => {
      if (stopped) handle.remove()
      else removeTapListener = () => handle.remove()
    })
  }

  return () => {
    stopped = true
    clearTimeout(timer)
    stopConfiguring()
    removeLiveListener?.()
    removeTapListener?.()
    document.removeEventListener('visibilitychange', checkWhenVisible)
  }
}
