import { watch } from 'vue'
import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import { getPlatform } from '../../platforms/index'
import { getPostTabTitle } from './tabTitles'

const ROUTE_PATTERN = /^\/(watch|playlist|channel|post)\/([^/]+)/

/** Tabs whose title is being looked up since they opened, which also asks the backend. */
const pendingTabIds = new Set()

/**
 * @param {string} value
 */
function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * @param {string} videoId
 * @returns {string | undefined}
 */
function findSavedVideoTitle(videoId) {
  const watchedTitle = store.getters.getHistoryCacheById[videoId]?.title
  if (watchedTitle) return watchedTitle

  for (const cache of [store.getters.getVideoCache, store.getters.getShortsCache, store.getters.getLiveCache]) {
    for (const entry of Object.values(cache)) {
      const title = entry?.videos?.find(video => video.videoId === videoId)?.title
      if (title) return title
    }
  }

  for (const playlist of store.getters.getAllPlaylists) {
    const title = playlist.videos?.find(video => video.videoId === videoId)?.title
    if (title) return title
  }
}

/**
 * @param {string | undefined} channelId
 * @returns {string | undefined}
 */
function findSavedChannelName(channelId) {
  if (!channelId) return
  const subscribedName = store.getters.getSubscribedChannelsById.get(channelId)?.name
  if (subscribedName) return subscribedName
  // Links to handles keep them in the route until the channel page resolves them.
  if (channelId.startsWith('@')) return channelId
  return store.getters.getHistoryCacheSorted.find(entry => entry.authorId === channelId && entry.author)?.author
}

/**
 * @param {string} channelId
 * @param {boolean} usesInvidious
 * @returns {Promise<string | undefined>}
 */
async function fetchChannelName(channelId, usesInvidious) {
  // Other IDs, such as custom URL names, only resolve through the channel page.
  if (!/^UC[\w-]{22}$/.test(channelId)) return
  if (usesInvidious) {
    return (await (await import('./api/invidious')).invidiousGetChannelInfo(channelId)).author
  }
  const { getLocalChannel, parseLocalChannelHeader } = await import('./api/local')
  const channel = await getLocalChannel(channelId)
  return channel.alert ? undefined : parseLocalChannelHeader(channel).name
}

/**
 * Finds the title the route's page would show in saved data, without
 * contacting a backend.
 * @param {string} path
 * @param {Record<string, unknown>} query
 * @returns {string | undefined}
 */
function findSavedTitle(path, query) {
  if (path === '/external-media') {
    // Like the page before its media loads
    return URL.parse(String(query.url ?? ''))?.hostname || undefined
  }
  if (/^\/external-(?:channel|playlist|category)$/.test(path)) {
    return getPlatform(query.platform)?.name
  }

  const [, type, encodedId] = ROUTE_PATTERN.exec(path) ?? []
  const id = encodedId && decode(encodedId)
  switch (type) {
    case 'watch':
      return findSavedVideoTitle(id)
    case 'playlist':
      return query.playlistType === 'user' ? store.getters.getPlaylist(id)?.playlistName : undefined
    case 'channel':
      return findSavedChannelName(id)
    case 'post': {
      const author = findSavedChannelName(typeof query.authorId === 'string' ? query.authorId : undefined)
      return author ? getPostTabTitle(author) : undefined
    }
  }
}

/**
 * Looks up the title the route's page would show. Prefers saved data and only
 * then asks the selected backend.
 * @param {string} path
 * @param {Record<string, unknown>} query
 * @returns {Promise<string | undefined>}
 */
async function lookUpTitle(path, query) {
  const savedTitle = findSavedTitle(path, query)
  if (savedTitle) return savedTitle

  const [, type, encodedId] = ROUTE_PATTERN.exec(path) ?? []
  const id = encodedId && decode(encodedId)
  const usesInvidious = !process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(store.getters.getBackendPreference)

  switch (type) {
    case 'watch': {
      const { fetchRepairMetadata } = await import('./historyRepair')
      return (await fetchRepairMetadata(id, new AbortController().signal, false)).title
    }
    case 'playlist': {
      if (query.playlistType === 'user') return
      // Matches the playlist page's title.
      const [title, channelName] = usesInvidious
        ? await (await import('./api/invidious')).invidiousGetPlaylistInfo(id).then(playlist => [playlist.title, playlist.author])
        : await import('./api/local').then(({ getLocalPlaylist, getLocalPlaylistChannelName }) =>
            getLocalPlaylist(id).then(({ info }) => [info.title, getLocalPlaylistChannelName(info)])
          )
      return [title, channelName].filter(Boolean).join(' | ')
    }
    case 'channel':
      return await fetchChannelName(id, usesInvidious)
    case 'post': {
      // Like the post page, which leaves out an author it cannot find
      const author = typeof query.authorId === 'string'
        ? await fetchChannelName(query.authorId, usesInvidious).catch(error => {
            console.warn('Failed to look up the author of an unloaded post tab', error)
          })
        : undefined
      return getPostTabTitle(author)
    }
  }
}

/**
 * The title of a page that the route alone gives, short of the one it shows
 * once loaded
 * @param {string} path
 */
function getFallbackTitle(path) {
  // Without its author, like the post page
  return path.startsWith('/post/') ? getPostTabTitle() : undefined
}

/**
 * Whether an unloaded tab shows its route or the fallback title, which a
 * lookup can still replace.
 * @param {{ isUnloaded?: boolean, title?: string, route?: { path: string, fullPath: string } } | null} tab
 */
function showsPlaceholder(tab) {
  return tab?.isUnloaded === true &&
    (tab.title === tab.route.fullPath || tab.title === getFallbackTitle(tab.route.path))
}

/**
 * Gives a tab that was opened unloaded without a title the title its page
 * would show, instead of leaving its route as the title until it loads.
 * @param {string} tabId
 * @param {string} path
 * @param {Record<string, unknown>} [query]
 */
export async function resolveUnloadedTabTitle(tabId, path, query = {}) {
  pendingTabIds.add(tabId)
  let title
  try {
    title = await lookUpTitle(path, query)
  } catch (error) {
    console.warn('Failed to look up the title of an unloaded tab', error)
  } finally {
    pendingTabIds.delete(tabId)
  }
  if (!title) return

  // Leave tabs alone that have loaded and set their own title in the meantime.
  // A tab that the store does not list yet has not loaded either. Saved data
  // can have given it a fallback before this lookup started.
  const tab = store.getters.getTabById(tabId)
  if (tab && !showsPlaceholder(tab)) return
  window.ftElectron.tabs.updateTitle(title, tabId)
}

/**
 * Titles unloaded tabs that still show their route or fallback title, such as
 * restored tabs whose title lookup failed or that came from another device,
 * from saved data as it loads. Never contacts a backend, so restoring many tabs
 * sends no requests.
 * @returns {() => void} stops watching
 */
export function titleUnloadedTabsFromSavedData() {
  return watch(
    () => [
      store.getters.getTabs.filter(showsPlaceholder).map(tab => tab.id).join('\n'),
      // Saved data that loads after the tabs
      store.getters.getHistoryCacheSorted.length,
      store.getters.getPlaylistsReady,
      store.getters.getSubscriptionCacheReady,
      store.getters.getSubscribedChannelsById
    ],
    ([tabIds]) => {
      if (!tabIds) return
      for (const tabId of tabIds.split('\n')) {
        const tab = store.getters.getTabById(tabId)
        if (pendingTabIds.has(tabId) || !showsPlaceholder(tab)) continue
        const title = findSavedTitle(tab.route.path, tab.route.query ?? {}) ?? getFallbackTitle(tab.route.path)
        if (title && title !== tab.title) window.ftElectron.tabs.updateTitle(title, tabId)
      }
    },
    { immediate: true }
  )
}
