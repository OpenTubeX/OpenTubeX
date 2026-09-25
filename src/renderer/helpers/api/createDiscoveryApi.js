/** @typedef {'local' | 'invidious'} DiscoveryProvider */

/**
 * @typedef {{
 *   searchLocal: (query: string, settings: object, safetyMode: boolean) => Promise<{ results: unknown[], continuationData: unknown }>,
 *   continueLocal: (continuation: unknown) => Promise<{ results: unknown[], continuationData: unknown }>,
 *   cacheLocalContinuation: (continuation: unknown) => unknown,
 *   searchInvidious: (query: string, page: number, settings: object) => Promise<unknown[] | null>,
 *   getTrendingLocal: (region: string, category: string) => Promise<unknown[]>,
 *   getPopularInvidious: () => Promise<unknown[]>,
 *   getChannelLocal: (id: string) => Promise<{ thumbnailUrl: string } | null>,
 *   getChannelInvidious: (id: string) => Promise<{ authorThumbnails: { url: string }[] }>,
 *   youtubeImageToInvidious: (url: string, instance: string) => string,
 *   invidiousImageToInvidious: (url: string, instance: string) => string,
 * }} DiscoveryProviders
 */

/**
 * @typedef {{
 *   query: string, searchSettings: object, safetyMode: boolean,
 *   preference: DiscoveryProvider, provider?: DiscoveryProvider,
 *   continuation?: unknown, page?: number, fallbackEnabled?: boolean,
 *   localAvailable?: boolean,
 *   onProviderError?: (provider: DiscoveryProvider, error: unknown) => void,
 *   onFallback?: (from: DiscoveryProvider, to: DiscoveryProvider) => void,
 * }} DiscoverySearchOptions
 */

/**
 * @param {DiscoveryProviders} providers
 */
export function createDiscoveryApi(providers) {
  const {
    searchLocal, continueLocal, cacheLocalContinuation, searchInvidious,
    getTrendingLocal, getPopularInvidious, getChannelLocal, getChannelInvidious,
    youtubeImageToInvidious, invidiousImageToInvidious,
  } = providers

  /**
   * @param {DiscoveryProvider} provider
   * @param {DiscoverySearchOptions} options
   */
  async function searchProvider(provider, options) {
    const { query, searchSettings, safetyMode, continuation, page = 1 } = options
    if (provider === 'local') {
      const { results, continuationData } = continuation == null
        ? await searchLocal(query, searchSettings, safetyMode)
        : await continueLocal(continuation)
      return {
        provider,
        items: results,
        continuation: continuationData,
        cacheableContinuation: continuationData ? cacheLocalContinuation(continuationData) : null,
        nextPage: page,
        hasMore: results.length > 0 && continuationData != null,
      }
    }

    const results = await searchInvidious(query, page, searchSettings)
    if (!results) return null
    return {
      provider,
      items: results,
      continuation: null,
      cacheableContinuation: null,
      nextPage: page + 1,
      hasMore: results.length > 0,
    }
  }

  return {
    /** @param {DiscoverySearchOptions} options */
    async search(options) {
      const provider = options.provider ?? options.preference
      try {
        return await searchProvider(provider, options)
      } catch (error) {
        options.onProviderError?.(provider, error)
        const fallback = options.fallbackEnabled && provider === options.preference
          ? provider === 'local' ? 'invidious' : options.localAvailable !== false ? 'local' : null
          : null
        if (!fallback) throw error
        options.onFallback?.(provider, fallback)
        try {
          return await searchProvider(fallback, { ...options, continuation: null })
        } catch (fallbackError) {
          options.onProviderError?.(fallback, fallbackError)
          throw fallbackError
        }
      }
    },

    getTrending: getTrendingLocal,
    getPopular: getPopularInvidious,

    supportsTrending(localAvailable, preference, fallbackEnabled) {
      return localAvailable && (fallbackEnabled || preference === 'local')
    },

    formatSubscriptionThumbnail(originalUrl, preference, instanceUrl) {
      if (typeof originalUrl !== 'string' || originalUrl === '') return null
      let url = originalUrl.startsWith('//') ? `https:${originalUrl}` : originalUrl
      let hostname
      try {
        hostname = new URL(url).hostname
      } catch {
        return null
      }
      if (hostname === 'yt3.ggpht.com' || hostname === 'yt3.googleusercontent.com') {
        if (preference === 'invidious') url = youtubeImageToInvidious(url, instanceUrl)
      } else if (preference === 'local') {
        url = url.replace(/^.+ggpht\/(.+)/, 'https://yt3.ggpht.com/$1')
      } else {
        url = invidiousImageToInvidious(url, instanceUrl)
      }
      return url.replace(/(.+=\w)\d+(.+)/, '$1176$2')
    },

    /**
     * @param {string} channelId
     * @param {DiscoveryProvider} provider
     */
    async getSubscriptionChannelThumbnail(channelId, provider) {
      if (provider === 'local') {
        const channel = await getChannelLocal(channelId)
        return channel === null ? null : channel.thumbnailUrl
      }
      const channel = await getChannelInvidious(channelId)
      return channel.authorThumbnails[0].url
    },
  }
}
