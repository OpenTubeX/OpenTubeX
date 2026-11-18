import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import { fetchRepairMetadata } from './historyRepair'
import { getLocalPlaylist, getLocalPlaylistChannelName } from './api/local'
import { invidiousGetPlaylistInfo } from './api/invidious'
import { getPostTabTitle } from './tabTitles'

const ROUTE_PATTERN = /^\/(watch|playlist|channel|post)\/([^/]+)/

/**
 * Looks up the title the route's page would show. Prefers saved data and only
 * asks the selected backend for the titles of videos and playlists.
 * @param {string} path
 * @param {Record<string, unknown>} query
 * @returns {Promise<string | undefined>}
 */
async function lookUpTitle(path, query) {
  const [, type, id] = ROUTE_PATTERN.exec(path) ?? []
  const subscriptions = store.getters.getSubscribedChannelsById
  const usesInvidious = !process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(store.getters.getBackendPreference)

  switch (type) {
    case 'watch':
      return store.getters.getHistoryCacheById[id]?.title ||
        (await fetchRepairMetadata(id, new AbortController().signal, false)).title
    case 'playlist': {
      if (query.playlistType === 'user') return store.getters.getPlaylist(id)?.playlistName
      // Matches the playlist page's title.
      const [title, channelName] = usesInvidious
        ? await invidiousGetPlaylistInfo(id).then(playlist => [playlist.title, playlist.author])
        : await getLocalPlaylist(id).then(({ info }) => [info.title, getLocalPlaylistChannelName(info)])
      return [title, channelName].filter(Boolean).join(' | ')
    }
    case 'channel':
      return subscriptions.get(id)?.name
    case 'post':
      return getPostTabTitle(subscriptions.get(query.authorId)?.name)
  }
}

/**
 * Gives a tab that was opened unloaded without a title the title its page
 * would show, instead of leaving its route as the title until it loads.
 * @param {string} tabId
 * @param {string} path
 * @param {Record<string, unknown>} [query]
 */
export async function resolveUnloadedTabTitle(tabId, path, query = {}) {
  let title
  try {
    title = await lookUpTitle(path, query)
  } catch (error) {
    console.warn('Failed to look up the title of an unloaded tab', error)
  }
  if (!title) return

  // Leave tabs alone that have loaded and set their own title in the meantime.
  // A tab that the store does not list yet has not loaded either.
  const tab = store.getters.getTabById(tabId)
  if (tab && !(tab.isUnloaded && tab.title === tab.route.fullPath)) return
  window.ftElectron.tabs.updateTitle(title, tabId)
}
