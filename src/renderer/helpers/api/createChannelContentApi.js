/** @typedef {'local' | 'invidious'} ChannelProvider */
/** @typedef {'shorts' | 'live' | 'playlists' | 'releases' | 'podcasts' | 'courses' | 'community' | 'search'} ChannelSection */
/** @typedef {{type?: string, contents?: ChannelItem[], endpoint?: {metadata: {url: string}}, title?: string,
    [key: string]: unknown}} ChannelItem */
/** @typedef {{has_continuation: boolean, videos: ChannelItem[], playlists: ChannelItem[],
 *   posts: ChannelItem[], filters: string[], sort_filters: string[], content_type_filters: string[],
 *   getContinuation: () => Promise<LocalChannelPage>,
 *   applyFilter: (filter: string) => Promise<LocalChannelPage>,
 *   applySort: (filter: string) => Promise<LocalChannelPage>,
 *   applyContentTypeFilter: (filter: string) => Promise<LocalChannelPage>,
 *   current_tab: {content: {contents: ChannelItem[], sub_menu: {content_type_sub_menu_items: ChannelItem[]}}},
    contents: {contents: ChannelItem[]}}} LocalChannelPage */
/** @typedef {{alert?: string, metadata: {is_family_safe?: boolean, music_artist_name?: string,
 *   tags?: string[]}, tabs: string[], has_about?: boolean, has_home?: boolean,
 *   has_videos?: boolean, has_shorts?: boolean, has_live_streams?: boolean,
 *   has_podcasts?: boolean, has_releases?: boolean, has_courses?: boolean,
 *   has_playlists?: boolean, has_community?: boolean,
 *   has_search: boolean, getShorts: () => Promise<LocalChannelPage>,
 *   getLiveStreams: () => Promise<LocalChannelPage>, getPlaylists: () => Promise<LocalChannelPage>,
 *   getReleases: () => Promise<LocalChannelPage>, getPodcasts: () => Promise<LocalChannelPage>,
 *   getCourses: () => Promise<LocalChannelPage>, getCommunity: () => Promise<LocalChannelPage>,
    search: (query: string) => Promise<LocalChannelPage>}} LocalChannelSession */
/** @typedef {{author: string, authorId: string, isFamilyFriendly: boolean,
 *   subCount: number, authorThumbnails: {url: string}[], description: string,
 *   totalViews: number, joined: number, relatedChannels: {
 *     author: string, authorId: string, authorThumbnails: {url: string}[]
    }[], authorBanners?: {url: string}[], tabs: string[]}} InvidiousOverviewResponse */
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
 *   getInvidiousChannel: (id: string) => Promise<InvidiousOverviewResponse>,
 *   parseLocalHeader: (channel: LocalChannelSession) => {id?: string, name?: string, thumbnailUrl?: string,
 *     bannerUrl?: string, tags: string[], subscriberText?: string},
 *   parseSubscriberCount: (text: string) => number,
 *   getAgeGate: (channel: LocalChannelSession) => {name: string, thumbnail: string} | null,
 *   mayContainOtherChannels: (channel: LocalChannelSession) => boolean,
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
 *   getVideosPage: (options: {id: string, channelName?: string, provider: ChannelProvider,
 *     channel?: LocalChannelSession | null, artistTopic: boolean, sort: string,
 *     sortValues: string[], cursor: ChannelVideoCursor | null,
 *     isCurrent: () => boolean}) => Promise<{videos: ChannelItem[], cursor: ChannelVideoCursor | null,
 *       canSort: boolean | null} | null>,
 * }} ChannelContentAdapters
 */
/**
 * @typedef {{section: ChannelSection, provider: ChannelProvider, id: string,
 *   channel?: LocalChannelSession, channelName?: string, cursor?: ChannelCursor | null,
 *   sort?: string, sortValues?: string[], artistTopic?: boolean,
 *   mayContainOtherChannels?: boolean, query?: string, hidePlaylists?: boolean,
 *   isCurrent?: () => boolean}} ChannelPageOptions
 */
/** @typedef {Omit<ChannelPageOptions, 'provider'> & {preference: string, provider?: ChannelProvider,
 *   fallback?: boolean, more?: boolean, onError?: (provider: ChannelProvider, error: unknown) => void,
 *   onFallback?: (from: ChannelProvider, to: ChannelProvider) => void,
 *   onOverviewFallback?: (from: ChannelProvider) => void}} ChannelLoadPageOptions
 */
/** @typedef {{provider: ChannelProvider, [key: string]: unknown}} ChannelVideoCursor */
/** @typedef {{id: string, preference: string, provider?: ChannelProvider, fallback?: boolean,
 *   more?: boolean, channel?: LocalChannelSession | null, channelName?: string,
 *   artistTopic?: boolean, sort: string, sortValues?: string[], cursor?: ChannelVideoCursor | null,
 *   isCurrent?: () => boolean, onError?: (provider: ChannelProvider, error: unknown) => void,
 *   onOverviewFallback?: (from: ChannelProvider) => void}} ChannelVideosLoadOptions
 */
/** @typedef {{id: string, provider: ChannelProvider, subscriptionName?: string,
    subscriptionThumbnail?: string, instanceUrl?: string,
    existingChannel?: LocalChannelSession | null}} ChannelOverviewRequest */
/** @typedef {{id: string, preference: string, fallback: boolean,
 *   failedProvider?: ChannelProvider, subscriptionName?: string, subscriptionThumbnail?: string,
 *   instanceUrl?: string, isCurrent?: () => boolean,
 *   existingChannel?: LocalChannelSession | null,
 *   onSelected?: (provider: ChannelProvider) => void,
 *   onError?: (provider: ChannelProvider, error: unknown) => void,
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
    parseLocalHeader, parseSubscriberCount, getAgeGate, mayContainOtherChannels,
    parseShorts, parseVideos, parsePlaylists, parsePosts,
    getInvidiousSection, getArtistReleases, getArtistReleasesMore,
    parseSearchVideo, parseSearchPlaylist, getInvidiousSearch,
    getLocalSearchType, getInvidiousSearchType, mapImage, getVideosPage,
  } = adapters

  /** @param {ChannelSection} section @param {LocalChannelPage | null | undefined} data @returns {ChannelCursor | null} */
  const localCursorFor = (section, data) => data ? { provider: 'local', section, kind: 'page', data } : null
  /** @param {object | null | undefined} data @returns {ChannelCursor | null} */
  const artistCursorFor = data => data ? { provider: 'local', section: 'releases', kind: 'artist', data } : null
  /** @param {ChannelSection} section @param {string | null | undefined} data @returns {ChannelCursor | null} */
  const invidiousCursorFor = (section, data) => data ? { provider: 'invidious', section, data } : null
  /** @param {string} preference @returns {ChannelProvider} */
  const resolveProvider = preference => localAvailable && preference === 'local' ? 'local' : 'invidious'
  /** @param {ChannelProvider} provider @param {string} preference @param {boolean} enabled @returns {ChannelProvider | null} */
  const getFallbackProvider = (provider, preference, enabled) => {
    if (!enabled || provider !== preference) return null
    return provider === 'local' ? 'invidious' : localAvailable ? 'local' : null
  }

  const api = {
    resolveProvider,
    getFallbackProvider,
    /** @param {ChannelOverviewRequest} options */
    async getOverview({ id, provider, subscriptionName, subscriptionThumbnail, instanceUrl, existingChannel }) {
      if (provider === 'local') {
        const channel = existingChannel ?? await getLocalChannel(id)
        if (channel.alert) return { provider, kind: 'alert', message: channel.alert, channel }
        const ageGate = getAgeGate(channel)
        if (ageGate) return { provider, kind: 'age-gate', ...ageGate, channel }

        const header = parseLocalHeader(channel)
        const name = header.name ?? subscriptionName
        let thumbnail = header.thumbnailUrl ?? subscriptionThumbnail
        if (thumbnail?.startsWith('//')) thumbnail = `https:${thumbnail}`
        const artistTopic = /** @type {string} */ (name).endsWith('- Topic') && !!channel.metadata.music_artist_name
        const subscriberCount = header.subscriberText ? parseSubscriberCount(header.subscriberText) : NaN
        const availableTabs = ['about']
        if (channel.has_home || channel.tabs[0] !== 'Videos') availableTabs.push('home')
        if (channel.has_videos || artistTopic) availableTabs.push('videos')
        if (channel.has_shorts) availableTabs.push('shorts')
        if (channel.has_live_streams) availableTabs.push('live')
        if (channel.has_podcasts) availableTabs.push('podcasts')
        if (channel.has_releases || artistTopic) availableTabs.push('releases')
        if (channel.has_courses) availableTabs.push('courses')
        if (channel.has_playlists) availableTabs.push('playlists')
        if (channel.has_community) availableTabs.push('community')
        return {
          provider,
          kind: 'ready',
          channel,
          routeId: null,
          id: header.id ?? id,
          name,
          thumbnail,
          subscriptionThumbnail: thumbnail,
          banner: header.bannerUrl ?? null,
          familyFriendly: !!channel.metadata.is_family_safe,
          artistTopic,
          mayContainOtherChannels: artistTopic || mayContainOtherChannels(channel),
          tags: [...new Set([...header.tags, ...(channel.metadata.tags ?? [])])],
          subscriberCount: Number.isNaN(subscriberCount) ? null : subscriberCount,
          description: null,
          viewCount: null,
          videoCount: null,
          joined: 0,
          location: null,
          relatedChannels: null,
          availableTabs,
          aboutPending: !!channel.has_about,
          homePending: availableTabs.includes('home'),
          showSearchBar: !!channel.has_search,
        }
      }

      const response = await getInvidiousChannel(id)
      const subscriptionImage = response.authorThumbnails.at(-1)?.url ?? null
      return {
        provider,
        kind: 'ready',
        channel: null,
        routeId: response.authorId,
        id: response.authorId,
        name: response.author,
        thumbnail: mapImage(subscriptionImage, instanceUrl),
        subscriptionThumbnail: subscriptionImage,
        banner: Array.isArray(response.authorBanners) && response.authorBanners.length > 0
          ? mapImage(response.authorBanners[0].url, instanceUrl)
          : null,
        familyFriendly: response.isFamilyFriendly,
        artistTopic: false,
        mayContainOtherChannels: false,
        tags: null,
        subscriberCount: response.subCount,
        description: response.description,
        viewCount: response.totalViews,
        videoCount: null,
        joined: response.joined * 1000,
        location: null,
        relatedChannels: response.relatedChannels.map(channel => ({
          name: channel.author,
          id: channel.authorId,
          thumbnailUrl: mapImage(channel.authorThumbnails.at(-1)?.url ?? null, instanceUrl),
        })),
        availableTabs: response.tabs.filter(tab => tab !== 'home'),
        aboutPending: false,
        homePending: false,
        showSearchBar: null,
      }
    },
    /** @param {ChannelOverviewOptions} options */
    async loadOverview({
      id, preference, fallback, failedProvider, subscriptionName, subscriptionThumbnail,
      instanceUrl, existingChannel, isCurrent = () => true, onSelected, onError, onFallback, onNoProvider,
    }) {
      const provider = failedProvider
        ? getFallbackProvider(failedProvider, preference, fallback)
        : resolveProvider(preference)
      if (provider === null) {
        onNoProvider?.()
        return null
      }
      if (failedProvider) onFallback?.(failedProvider, provider)
      onSelected?.(provider)
      /** @param {ChannelProvider} next */
      const request = next => api.getOverview({
        id,
        provider: next,
        subscriptionName,
        subscriptionThumbnail,
        instanceUrl,
        existingChannel: next === 'local' && provider === 'local' && !failedProvider ? existingChannel : null,
      })
      try {
        const overview = await request(provider)
        return isCurrent() ? overview : null
      } catch (error) {
        if (!isCurrent()) return null
        onError?.(provider, error)
        const alternate = failedProvider ? null : getFallbackProvider(provider, preference, fallback)
        if (alternate === null) throw error
        onFallback?.(provider, alternate)
        onSelected?.(alternate)
        try {
          const overview = await request(alternate)
          return isCurrent() ? overview : null
        } catch (fallbackError) {
          if (!isCurrent()) return null
          onError?.(alternate, fallbackError)
          throw fallbackError
        }
      }
    },
    /** @param {string} url @param {string} preference */
    getId(url, preference) {
      return resolveProvider(preference) === 'local' ? getLocalId(url) : getInvidiousId(url)
    },
    /** @param {string} id @param {ChannelProvider} provider */
    getInfo(id, provider) {
      return provider === 'local' ? getLocalChannel(id) : getInvidiousChannel(id)
    },
    mapImage,
    /** @param {ChannelVideosLoadOptions} options */
    async loadVideosPage({
      id, preference, provider: currentProvider, more = false,
      channel, channelName, artistTopic = false, sort, sortValues = [], cursor = null,
      isCurrent = () => true, onError, onOverviewFallback,
    }) {
      const provider = cursor?.provider ?? currentProvider ?? resolveProvider(preference)
      try {
        const session = provider === 'local' && !artistTopic ? channel ?? await getLocalChannel(id) : channel
        if (!isCurrent()) return null
        const page = await getVideosPage({
          id, channelName, provider, channel: session, artistTopic, sort, sortValues, cursor, isCurrent,
        })
        return page && isCurrent() ? { ...page, provider, channel: session ?? null } : null
      } catch (error) {
        if (!isCurrent()) return null
        if (!more && provider === 'local' && artistTopic && error instanceof Error && error.message === 'The playlist does not exist.') {
          return null
        }
        onError?.(provider, error)
        if (!more && provider === 'local' && onOverviewFallback) {
          onOverviewFallback(provider)
          return null
        }
        throw error
      }
    },
    /** @param {ChannelLoadPageOptions} options */
    async loadPage({
      section, id, preference, provider: currentProvider, fallback = false, more = false,
      channel, cursor = null, isCurrent = () => true, onError, onFallback, onOverviewFallback,
      ...pageOptions
    }) {
      const provider = cursor?.provider ?? currentProvider ?? resolveProvider(preference)
      /** @param {ChannelProvider} selected */
      const request = async selected => {
        const session = selected === 'local' ? channel ?? await getLocalChannel(id) : undefined
        if (!isCurrent()) return null
        const page = await api.getPage({
          ...pageOptions,
          section,
          id,
          provider: selected,
          channel: session,
          cursor: selected === provider ? cursor : null,
          isCurrent,
        })
        return page && isCurrent() ? { ...page, provider: selected, channel: session ?? null } : null
      }
      try {
        return await request(provider)
      } catch (error) {
        if (!isCurrent()) return null
        onError?.(provider, error)
        if (!more && provider === 'local' && onOverviewFallback) {
          onOverviewFallback(provider)
          return null
        }
        const alternate = !more ? getFallbackProvider(provider, preference, fallback) : null
        if (alternate === null) throw error
        if (onOverviewFallback) throw error
        onFallback?.(provider, alternate)
        try {
          return await request(alternate)
        } catch (fallbackError) {
          if (!isCurrent()) return null
          onError?.(alternate, fallbackError)
          throw fallbackError
        }
      }
    },
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
        const response = await getInvidiousSection(section, id, sort, cursor?.provider === 'invidious' ? cursor.data : null)
        if (!isCurrent()) return null
        const items = section === 'community'
          ? response.posts
          : ['playlists', 'releases', 'podcasts', 'courses'].includes(section)
              ? response.playlists
              : response.videos
        return {
          items: /** @type {ChannelItem[]} */ (items),
          cursor: invidiousCursorFor(section, response.continuation),
          canSort: null,
        }
      }

      if (!channel) throw new Error('Missing Local Channel session')

      if (section === 'search') {
        if (!channel.has_search) return { items: [], cursor: null, canSort: null, notSearchable: true }
        if (cursor && (cursor.provider !== 'local' || cursor.kind !== 'page' || !cursor.data.getContinuation)) {
          throw new Error('Invalid Local Channel continuation')
        }
        const result = cursor ? await cursor.data.getContinuation() : await channel.search(query)
        if (!isCurrent()) return null
        const contents = cursor ? result.contents.contents : result.current_tab.content.contents
        const items = contents
          .filter(node => node.type === 'ItemSection')
          .flatMap(itemSection => /** @type {ChannelItem[]} */ (itemSection.contents))
          .filter(item => item.type === 'Video' || (!hidePlaylists && item.type === 'Playlist'))
          .map(item => ({
            ...(item.type === 'Video' ? parseSearchVideo(item) : parseSearchPlaylist(item, id, channelName)),
            channelSearchResultType: getLocalSearchType(item),
          }))
        return { items, cursor: result.has_continuation ? localCursorFor(section, result) : null, canSort: null }
      }

      if (section === 'releases' && artistTopic) {
        if (cursor && (cursor.provider !== 'local' || cursor.kind !== 'artist')) {
          throw new Error('Invalid artist releases continuation')
        }
        const result = cursor
          ? await getArtistReleasesMore(channel, cursor.data)
          : await getArtistReleases(channel)
        if (!isCurrent()) return null
        return { items: result.releases, cursor: artistCursorFor(result.continuationData), canSort: null }
      }

      let tab
      let canSort = null
      if (cursor) {
        if (cursor.provider !== 'local' || cursor.kind !== 'page' || !cursor.data.getContinuation) {
          throw new Error('Invalid Local Channel continuation')
        }
        tab = await cursor.data.getContinuation()
      } else {
        const methods = {
          shorts: () => channel.getShorts(),
          live: () => channel.getLiveStreams(),
          playlists: () => channel.getPlaylists(),
          releases: () => channel.getReleases(),
          podcasts: () => channel.getPodcasts(),
          courses: () => channel.getCourses(),
          community: () => channel.getCommunity(),
        }
        const getTab = section in methods ? methods[/** @type {keyof typeof methods} */ (section)] : null
        if (!getTab) throw new Error(`Unknown Channel section: ${section}`)
        tab = await getTab()
      }
      if (!isCurrent()) return null

      if (!cursor && section === 'playlists') {
        if (tab.content_type_filters.length > 1) {
          const menu = tab.current_tab.content.sub_menu
          const created = /** @type {{title: string}} */ (menu.content_type_sub_menu_items.find(item => {
            const url = `https://youtube.com/${/** @type {{metadata: {url: string}}} */ (item.endpoint).metadata.url}`
            return new URL(url).searchParams.get('view') === '1'
          })).title
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
  return api
}
