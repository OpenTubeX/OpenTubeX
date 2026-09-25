/** @typedef {'local' | 'invidious'} ChannelProvider */
/** @typedef {'shorts' | 'live' | 'playlists' | 'releases' | 'podcasts' | 'courses' | 'community' | 'search'} ChannelSection */
/** @typedef {{type?: string, [key: string]: unknown}} ChannelItem */
/** @typedef {{has_continuation: boolean, videos?: ChannelItem[], playlists?: ChannelItem[],
 *   posts?: ChannelItem[], filters?: string[], sort_filters?: string[], content_type_filters?: string[],
 *   getContinuation?: () => Promise<LocalChannelPage>,
 *   applyFilter?: (filter: string) => Promise<LocalChannelPage>,
 *   applySort?: (filter: string) => Promise<LocalChannelPage>,
 *   applyContentTypeFilter?: (filter: string) => Promise<LocalChannelPage>,
    current_tab?: object, contents?: object}} LocalChannelPage */
/** @typedef {{has_search: boolean, getShorts: () => Promise<LocalChannelPage>,
 *   getLiveStreams: () => Promise<LocalChannelPage>, getPlaylists: () => Promise<LocalChannelPage>,
 *   getReleases: () => Promise<LocalChannelPage>, getPodcasts: () => Promise<LocalChannelPage>,
 *   getCourses: () => Promise<LocalChannelPage>, getCommunity: () => Promise<LocalChannelPage>,
    search: (query: string) => Promise<LocalChannelPage>}} LocalChannelSession */
/**
 * @typedef {{provider: 'local', section: ChannelSection, kind: 'page', data: LocalChannelPage}
 *   | {provider: 'local', section: 'releases', kind: 'artist', data: object}
 *   | {provider: 'invidious', section: ChannelSection, data: string}} ChannelCursor
 */
/** @typedef {{items: ChannelItem[], cursor: ChannelCursor | null, canSort: boolean | null, notSearchable?: boolean}} ChannelPage */
/** @typedef {{videos?: ChannelItem[], playlists?: ChannelItem[], posts?: ChannelItem[], continuation?: string | null}} InvidiousChannelPage */
/**
 * @typedef {{
 *   localAvailable: boolean,
 *   getLocalId: (url: string) => Promise<string | null>,
 *   getInvidiousId: (url: string) => Promise<string | null>,
 *   getLocalChannel: (id: string) => Promise<LocalChannelSession>,
 *   getInvidiousChannel: (id: string) => Promise<object>,
 *   parseShorts: (items: ChannelItem[], id?: string, name?: string) => ChannelItem[],
 *   parseVideos: (items: ChannelItem[], id: string, name?: string) => ChannelItem[],
 *   parsePlaylists: (items: ChannelItem[], id: string, name?: string) => ChannelItem[],
 *   parsePosts: (items: ChannelItem[]) => ChannelItem[],
 *   getInvidiousSection: (section: ChannelSection, id: string, sort: string, continuation: string | null) => Promise<InvidiousChannelPage>,
 *   getArtistReleases: (channel: LocalChannelSession) => Promise<{releases: ChannelItem[], continuationData: object | null}>,
 *   getArtistReleasesMore: (channel: LocalChannelSession, continuation: object) => Promise<{releases: ChannelItem[], continuationData: object | null}>,
 *   parseSearchVideo: (item: ChannelItem) => ChannelItem,
 *   parseSearchPlaylist: (item: ChannelItem, id: string, name?: string) => ChannelItem,
 *   getInvidiousSearch: (id: string, query: string, page: number) => Promise<ChannelItem[]>,
 *   getLocalSearchType: (item: ChannelItem) => string,
 *   getInvidiousSearchType: (item: ChannelItem) => string,
 *   mapImage: (url: string | null, instanceUrl?: string) => string | null,
 * }} ChannelContentAdapters
 */
/**
 * @typedef {{section: ChannelSection, provider: ChannelProvider, id: string,
 *   channel?: LocalChannelSession, channelName?: string, cursor?: ChannelCursor | null,
 *   sort?: string, sortValues?: string[], artistTopic?: boolean,
 *   mayContainOtherChannels?: boolean, query?: string, hidePlaylists?: boolean,
 *   isCurrent?: () => boolean}} ChannelPageOptions
 */
/** @typedef {{preference: string, fallback: boolean, failedProvider?: ChannelProvider,
 *   loadLocal: () => Promise<unknown>, loadInvidious: () => Promise<unknown>,
 *   onFallback?: (from: ChannelProvider, to: ChannelProvider) => void,
    onNoProvider?: () => void}} ChannelOverviewOptions */

/**
 * Keeps provider pagination and parsing out of the Channel view. The view owns
 * loading indicators, cache updates and error messages.
 * @param {ChannelContentAdapters} adapters
 */
export function createChannelContentApi(adapters) {
  const {
    localAvailable, getLocalId, getInvidiousId, getLocalChannel, getInvidiousChannel,
    parseShorts, parseVideos, parsePlaylists, parsePosts,
    getInvidiousSection, getArtistReleases, getArtistReleasesMore,
    parseSearchVideo, parseSearchPlaylist, getInvidiousSearch,
    getLocalSearchType, getInvidiousSearchType, mapImage,
  } = adapters

  const localCursorFor = (section, data) => data ? { provider: 'local', section, kind: 'page', data } : null
  const artistCursorFor = data => data ? { provider: 'local', section: 'releases', kind: 'artist', data } : null
  const invidiousCursorFor = (section, data) => data ? { provider: 'invidious', section, data } : null
  const resolveProvider = preference => localAvailable && preference === 'local' ? 'local' : 'invidious'
  const getFallbackProvider = (provider, preference, enabled) => {
    if (!enabled || provider !== preference) return null
    return provider === 'local' ? 'invidious' : localAvailable ? 'local' : null
  }

  return {
    resolveProvider,
    getFallbackProvider,
    /** @param {ChannelOverviewOptions} options */
    loadOverview({ preference, fallback, failedProvider, loadLocal, loadInvidious, onFallback, onNoProvider }) {
      const provider = failedProvider
        ? getFallbackProvider(failedProvider, preference, fallback)
        : resolveProvider(preference)
      if (provider === null) {
        onNoProvider?.()
        return null
      }
      if (failedProvider) onFallback?.(failedProvider, provider)
      return provider === 'local' ? loadLocal() : loadInvidious()
    },
    getId(url, preference) {
      return resolveProvider(preference) === 'local' ? getLocalId(url) : getInvidiousId(url)
    },
    getInfo(id, provider) {
      return provider === 'local' ? getLocalChannel(id) : getInvidiousChannel(id)
    },
    mapImage,
    /** @param {ChannelPageOptions} options @returns {Promise<ChannelPage | null>} */
    async getPage({
      section, provider, id, channel, channelName, cursor = null, sort = 'newest', sortValues = [],
      artistTopic = false, mayContainOtherChannels = false, query = '', hidePlaylists = false,
      isCurrent = () => true,
    }) {
      if (provider === 'invidious') {
        if (section === 'search') {
          const result = await getInvidiousSearch(id, query, 1)
          if (!isCurrent()) return null
          const items = result
            .filter(item => !hidePlaylists || item.type !== 'playlist')
            .map(item => ({ ...item, channelSearchResultType: getInvidiousSearchType(item) }))
          return { items, cursor: null, canSort: null }
        }
        const response = await getInvidiousSection(section, id, sort, cursor?.data ?? null)
        if (!isCurrent()) return null
        const items = section === 'community'
          ? response.posts
          : ['playlists', 'releases', 'podcasts', 'courses'].includes(section)
              ? response.playlists
              : response.videos
        return { items, cursor: invidiousCursorFor(section, response.continuation), canSort: null }
      }

      if (section === 'search') {
        if (!channel.has_search) return { items: [], cursor: null, canSort: null, notSearchable: true }
        const result = cursor ? await cursor.data.getContinuation() : await channel.search(query)
        if (!isCurrent()) return null
        const contents = cursor ? result.contents.contents : result.current_tab.content.contents
        const items = contents
          .filter(node => node.type === 'ItemSection')
          .flatMap(itemSection => itemSection.contents)
          .filter(item => item.type === 'Video' || (!hidePlaylists && item.type === 'Playlist'))
          .map(item => ({
            ...(item.type === 'Video' ? parseSearchVideo(item) : parseSearchPlaylist(item, id, channelName)),
            channelSearchResultType: getLocalSearchType(item),
          }))
        return { items, cursor: result.has_continuation ? localCursorFor(section, result) : null, canSort: null }
      }

      if (section === 'releases' && artistTopic) {
        const result = cursor
          ? await getArtistReleasesMore(channel, cursor.data)
          : await getArtistReleases(channel)
        if (!isCurrent()) return null
        return { items: result.releases, cursor: artistCursorFor(result.continuationData), canSort: null }
      }

      let tab
      let canSort = null
      if (cursor) {
        tab = await cursor.data.getContinuation()
      } else {
        const method = {
          shorts: 'getShorts',
          live: 'getLiveStreams',
          playlists: 'getPlaylists',
          releases: 'getReleases',
          podcasts: 'getPodcasts',
          courses: 'getCourses',
          community: 'getCommunity',
        }[section]
        if (!method) throw new Error(`Unknown Channel section: ${section}`)
        tab = await channel[method]()
      }
      if (!isCurrent()) return null

      if (!cursor && section === 'playlists') {
        if (tab.content_type_filters.length > 1) {
          const menu = tab.current_tab.content.sub_menu
          const created = menu.content_type_sub_menu_items.find(item => {
            const url = `https://youtube.com/${item.endpoint.metadata.url}`
            return new URL(url).searchParams.get('view') === '1'
          }).title
          tab = await tab.applyContentTypeFilter(created)
          if (!isCurrent()) return null
        }
        canSort = tab.sort_filters.length > 1 && tab.playlists.length > 1
        if (canSort && sort !== 'newest') {
          tab = await tab.applySort(tab.sort_filters[sortValues.indexOf(sort)])
          if (!isCurrent()) return null
        }
      } else if (!cursor && (section === 'shorts' || section === 'live')) {
        canSort = tab.filters.length > 1
        if (canSort && sort !== 'newest') {
          tab = await tab.applyFilter(tab.filters[sortValues.indexOf(sort)])
          if (!isCurrent()) return null
        }
      }

      let rawItems = section === 'community'
        ? tab.posts
        : ['playlists', 'releases', 'podcasts', 'courses'].includes(section)
            ? tab.playlists
            : tab.videos
      // YouTube may return pages that contain only a continuation.
      if ((section === 'live' && !cursor) || section === 'community') {
        while (rawItems.length === 0 && tab.has_continuation) {
          tab = await tab.getContinuation()
          if (!isCurrent()) return null
          rawItems = section === 'community' ? tab.posts : tab.videos
        }
      }

      const items = section === 'shorts'
        ? parseShorts(rawItems, mayContainOtherChannels ? undefined : id, mayContainOtherChannels ? undefined : channelName)
        : section === 'live'
          ? parseVideos(rawItems, id, channelName)
          : section === 'community'
            ? parsePosts(rawItems)
            : parsePlaylists(rawItems, id, channelName)
      return { items, cursor: tab.has_continuation ? localCursorFor(section, tab) : null, canSort }
    },
  }
}
