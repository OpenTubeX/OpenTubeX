/** @typedef {'local' | 'invidious'} ContentProvider */
/** @typedef {{videoId: string, [key: string]: unknown}} ContentVideo */
/** @typedef {{postId: string, authorId?: string, [key: string]: unknown}} ContentPost */
/** @typedef {{videos: object[], has_continuation: boolean, getContinuation?: () => Promise<LocalHashtagPage>}} LocalHashtagPage */
/** @typedef {{provider: 'local', data: LocalHashtagPage} | {provider: 'invidious', page: number}} HashtagCursor */
/** @typedef {{provider: 'local', data: LocalPlaylistPage} | {provider: 'invidious', page: number}} PlaylistCursor */
/** @typedef {{provider: 'local', kind: 'artist', data: LocalPlaylistPage} |
 *   {provider: 'local', kind: 'channel', data: LocalChannelVideosPage} |
    {provider: 'invidious', data: string}} ChannelVideosCursor */
/** @typedef {{items: object[], has_continuation: boolean, info: {
 *   title: string, description?: string, thumbnails: {url: string}[], views: string,
 *   total_items: string, last_updated?: string, subtitle?: {toString: () => string},
 *   author?: {name: string, id: string, best_thumbnail?: {url: string}},
  }, menu?: {items?: {text: string}[]}}} LocalPlaylistPage */
/** @typedef {{title: string, description: string, videos: ContentVideo[], viewCount: number,
 *   videoCount: number, author: string, authorId: string, authorThumbnails: {url: string}[],
    updated?: number | null, pageVideoCount: number}} InvidiousPlaylistPage */
/** @typedef {{videos: ContentVideo[], has_continuation: boolean, filters: string[],
 *   applyFilter: (filter: string) => Promise<LocalChannelVideosPage>,
    getContinuation: () => Promise<LocalChannelVideosPage>}} LocalChannelVideosPage */
/** @typedef {{getVideos: () => Promise<LocalChannelVideosPage>}} LocalChannelVideos */
/** @typedef {{videos: ContentVideo[], continuation: string | null}} InvidiousChannelVideosPage */
/** @typedef {(provider: ContentProvider, error: unknown) => void} ContentErrorHandler */
/** @typedef {(from: ContentProvider, to: ContentProvider) => void} ContentFallbackHandler */
/** @typedef {{preference: string, fallback?: boolean,
    onError?: ContentErrorHandler, onFallback?: ContentFallbackHandler}} ContentLoadOptions */
/** @typedef {ContentLoadOptions & {id: string, authorId?: string}} PostLoadOptions */
/** @typedef {ContentLoadOptions & {hashtag: string, cursor?: HashtagCursor | null}} HashtagLoadOptions */
/** @typedef {ContentLoadOptions & {id: string, isCurrent?: () => boolean}} PlaylistLoadOptions */
/** @typedef {{id: string, cursor: PlaylistCursor, videos: ContentVideo[], videoCount: number}} PlaylistPageOptions */
/** @typedef {{id: string, channelName?: string, provider: ContentProvider,
 *   channel?: LocalChannelVideos, artistTopic?: boolean, sort: string, sortValues?: string[],
    cursor?: ChannelVideosCursor | null, isCurrent?: () => boolean}} ChannelVideosPageOptions */

/**
 * @typedef {{
 *   localAvailable: boolean,
 *   getLocalPost: (id: string, authorId?: string) => Promise<ContentPost>,
 *   getInvidiousPost: (id: string, authorId?: string) => Promise<ContentPost>,
 *   getLocalHashtag: (hashtag: string) => Promise<LocalHashtagPage>,
 *   getInvidiousHashtag: (hashtag: string, page: number) => Promise<ContentVideo[]>,
 *   parseLocalVideo: (video: object) => ContentVideo | null,
 *   getLocalPlaylist: (id: string) => Promise<LocalPlaylistPage>,
 *   getLocalPlaylistContinuation: (page: LocalPlaylistPage) => Promise<LocalPlaylistPage | null>,
 *   getCacheableLocalPlaylistContinuation: (page: LocalPlaylistPage) => object,
 *   parseLocalPlaylistVideos: (videos: object[]) => ContentVideo[],
 *   getInvidiousPlaylist: (id: string, page?: number) => Promise<InvidiousPlaylistPage>,
 *   parseCount: (text: string) => number,
 *   mapInvidiousImage: (url: string | null) => string | null,
 *   hasMoreInvidiousPages: (count: number, page: number, loaded: number, pageCount: number) => boolean,
 *   mergeInvidiousVideos: (current: ContentVideo[], next: ContentVideo[]) => ContentVideo[],
 *   getInvidiousChannelVideos: (id: string, sort: string, continuation: string | null) => Promise<InvidiousChannelVideosPage>,
 *   parseLocalChannelVideos: (videos: object[], id: string, name?: string) => ContentVideo[],
 *   makeChannelPlaylistId: (id: string, section: string, sort: string) => string,
 * }} ContentApiAdapters
 */

/**
 * The two content backends share view-facing models for posts and video lists.
 * Cursors keep backend pagination state behind this boundary.
 * @param {ContentApiAdapters} adapters
 */
export function createContentApi(adapters) {
  const {
    localAvailable, getLocalPost, getInvidiousPost, getLocalHashtag, getInvidiousHashtag, parseLocalVideo,
    getLocalPlaylist, getLocalPlaylistContinuation, parseLocalPlaylistVideos, getInvidiousPlaylist,
    getCacheableLocalPlaylistContinuation,
    parseCount, mapInvidiousImage, hasMoreInvidiousPages, mergeInvidiousVideos,
    getInvidiousChannelVideos, parseLocalChannelVideos, makeChannelPlaylistId,
  } = adapters

  /** @param {string} preference */
  function resolveProvider(preference) {
    return localAvailable && preference === 'local' ? 'local' : 'invidious'
  }

  /** @param {ContentProvider} provider */
  function otherProvider(provider) {
    return provider === 'local' ? 'invidious' : localAvailable ? 'local' : null
  }

  /**
   * @template T
   * @param {string} preference
   * @param {boolean} fallback
   * @param {(provider: ContentProvider, reset: boolean) => Promise<T>} operation
   * @param {ContentErrorHandler | undefined} onError
   * @param {ContentFallbackHandler | undefined} onFallback
   * @param {() => boolean} isCurrent
   * @returns {Promise<T | null>}
   */
  async function runWithFallback(preference, fallback, operation, onError, onFallback, isCurrent = () => true) {
    const provider = resolveProvider(preference)
    try {
      return await operation(provider, false)
    } catch (error) {
      if (!isCurrent()) return null
      onError?.(provider, error)
      const next = fallback && provider === preference ? otherProvider(provider) : null
      if (next == null) throw error
      onFallback?.(provider, next)
      try {
        return await operation(next, true)
      } catch (fallbackError) {
        onError?.(next, fallbackError)
        throw fallbackError
      }
    }
  }

  return {
    resolveProvider,
    otherProvider,
    /** @param {PlaylistCursor | null} cursor @returns {object | null} */
    getCacheablePlaylistContinuation(cursor) {
      return cursor?.provider === 'local'
        ? getCacheableLocalPlaylistContinuation(cursor.data)
        : null
    },
    /** @param {PostLoadOptions} options */
    getPost({ id, authorId, preference, fallback = false, onError, onFallback }) {
      return runWithFallback(preference, fallback, async provider => ({
        provider,
        data: await (provider === 'local' ? getLocalPost(id, authorId) : getInvidiousPost(id, authorId)),
      }), onError, onFallback)
    },
    /** @param {HashtagLoadOptions} options */
    getHashtagPage({ hashtag, preference, fallback = false, cursor = null, onError, onFallback }) {
      const selectedProvider = cursor?.provider ?? resolveProvider(preference)
      return runWithFallback(selectedProvider, fallback && selectedProvider === preference, async (provider, reset) => {
        if (provider === 'local') {
          const data = !reset && cursor?.provider === 'local'
            ? await cursor.data.getContinuation()
            : await getLocalHashtag(hashtag)
          return {
            provider,
            videos: data.videos.map(parseLocalVideo).filter(Boolean),
            hasMore: !!data.has_continuation,
            cursor: data.has_continuation ? { provider, data } : null,
            reset,
          }
        }
        const page = !reset && cursor?.provider === 'invidious' ? cursor.page : 1
        const videos = await getInvidiousHashtag(hashtag, page)
        return {
          provider,
          videos,
          hasMore: videos.length > 0,
          cursor: { provider, page: page + 1 },
          reset,
        }
      }, onError, onFallback)
    },
    /** @param {PlaylistLoadOptions} options */
    getPlaylist({ id, preference, fallback = false, onError, onFallback, isCurrent }) {
      return runWithFallback(preference, fallback, async provider => {
        if (provider === 'local') {
          const data = await getLocalPlaylist(id)
          const author = data.info.author
          let channelName = author?.name
          if (!channelName) {
            const subtitle = data.info.subtitle?.toString()
            channelName = subtitle ? subtitle.substring(0, subtitle.lastIndexOf('•')).trim() : ''
          }
          const videos = parseLocalPlaylistVideos(data.items)
          return {
            provider,
            title: data.info.title,
            description: data.info.description ?? '',
            thumbnail: data.info.thumbnails[0].url,
            firstVideoId: videos[0]?.videoId ?? '',
            viewCount: data.info.views.toLowerCase() === 'no views' ? 0 : parseCount(data.info.views),
            videoCount: parseCount(data.info.total_items),
            lastUpdated: data.info.last_updated ?? '',
            lastUpdatedDate: null,
            channelName,
            channelThumbnail: author?.best_thumbnail?.url ?? '',
            subscriptionThumbnail: author?.best_thumbnail?.url ?? '',
            channelId: author?.id,
            showUnavailableVideosAlert: data.menu?.items?.some(item => item.text === 'Show unavailable videos') ?? false,
            videos,
            fetchedCount: data.items.length,
            cursor: data.has_continuation ? { provider, data } : null,
          }
        }
        const data = await getInvidiousPlaylist(id)
        const thumbnail = data.authorThumbnails.at(-1)?.url ?? null
        return {
          provider,
          title: data.title,
          description: data.description,
          thumbnail: '',
          firstVideoId: data.videos[0]?.videoId ?? '',
          viewCount: data.viewCount,
          videoCount: data.videoCount,
          lastUpdated: '',
          lastUpdatedDate: data.updated == null ? null : new Date(data.updated * 1000),
          channelName: data.author,
          channelThumbnail: mapInvidiousImage(thumbnail),
          subscriptionThumbnail: thumbnail,
          channelId: data.authorId,
          showUnavailableVideosAlert: false,
          videos: data.videos,
          fetchedCount: 0,
          cursor: hasMoreInvidiousPages(data.videoCount, 1, data.videos.length, data.pageVideoCount)
            ? { provider, page: 2 }
            : null,
        }
      }, onError, onFallback, isCurrent)
    },
    /** @param {PlaylistPageOptions} options */
    async getPlaylistPage({ id, cursor, videos, videoCount }) {
      if (cursor.provider === 'local') {
        const data = await getLocalPlaylistContinuation(cursor.data)
        return {
          provider: 'local',
          videos: data ? parseLocalPlaylistVideos(data.items) : [],
          replace: false,
          fetchedCount: data?.items.length ?? 0,
          cursor: data?.has_continuation ? { provider: 'local', data } : null,
        }
      }
      const data = await getInvidiousPlaylist(id, cursor.page)
      const merged = mergeInvidiousVideos(videos, data.videos)
      return {
        provider: 'invidious',
        videos: merged,
        replace: true,
        fetchedCount: 0,
        cursor: hasMoreInvidiousPages(videoCount, cursor.page, merged.length, data.pageVideoCount)
          ? { provider: 'invidious', page: cursor.page + 1 }
          : null,
      }
    },
    /** @param {ChannelVideosPageOptions} options */
    async getChannelVideosPage({ id, channelName, provider, channel, artistTopic = false, sort, sortValues = [], cursor = null, isCurrent = () => true }) {
      if (provider === 'invidious') {
        const result = await getInvidiousChannelVideos(id, sort, cursor?.data ?? null)
        if (!isCurrent()) return null
        return {
          videos: result.videos,
          cursor: result.continuation ? { provider, data: result.continuation } : null,
          canSort: null,
        }
      }
      if (artistTopic) {
        const playlist = cursor
          ? await getLocalPlaylistContinuation(cursor.data)
          : await getLocalPlaylist(makeChannelPlaylistId(id, 'videos', sort))
        if (!isCurrent()) return null
        return {
          videos: playlist ? parseLocalPlaylistVideos(playlist.items) : [],
          cursor: playlist?.has_continuation ? { provider, kind: 'artist', data: playlist } : null,
          canSort: null,
        }
      }
      if (cursor) {
        const continuation = await cursor.data.getContinuation()
        if (!isCurrent()) return null
        return {
          videos: parseLocalChannelVideos(continuation.videos, id, channelName),
          cursor: continuation.has_continuation ? { provider, kind: 'channel', data: continuation } : null,
          canSort: null,
        }
      }
      let tab = await channel.getVideos()
      if (!isCurrent()) return null
      const canSort = tab.filters.length > 1
      if (canSort && sort !== 'newest') {
        tab = await tab.applyFilter(tab.filters[sortValues.indexOf(sort)])
        if (!isCurrent()) return null
      }
      return {
        videos: parseLocalChannelVideos(tab.videos, id, channelName),
        cursor: tab.has_continuation ? { provider, kind: 'channel', data: tab } : null,
        canSort,
      }
    },
  }
}
