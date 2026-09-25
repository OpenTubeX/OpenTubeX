/** @typedef {'local' | 'invidious'} VideoProvider */
/** @typedef {{avoidTranslation?: boolean, thumbnailPreference?: string}} LocalWatchOptions */
/** @typedef {{instanceUrl: string, thumbnailPreference?: string}} InvidiousWatchOptions */

/**
 * @template LocalVideo, InvidiousVideo, LocalMetadata, InvidiousMetadata
 * @typedef {{
 *   loadLocal: (videoId: string) => Promise<LocalVideo>,
 *   loadInvidious: (videoId: string) => Promise<InvidiousVideo>,
 *   mapLocal: (video: LocalVideo, options: LocalWatchOptions & {videoId: string}) => LocalMetadata,
 *   mapInvidious: (video: InvidiousVideo, options: InvidiousWatchOptions & {videoId: string}) => InvidiousMetadata,
 * }} VideoProviderAdapters
 */

/**
 * @template LocalVideo, InvidiousVideo, LocalMetadata, InvidiousMetadata
 * @typedef {{
 *   getVideoInformation: <Provider extends VideoProvider>(videoId: string, provider: Provider) =>
 *     Promise<Provider extends 'local' ? LocalVideo : InvidiousVideo>,
 *   getWatchVideoInformation: <Provider extends VideoProvider>(videoId: string, provider: Provider,
 *     options: Provider extends 'local' ? LocalWatchOptions : InvidiousWatchOptions) =>
 *     Promise<{ provider: Provider, metadata: Provider extends 'local' ? LocalMetadata : InvidiousMetadata,
 *       source: Provider extends 'local' ? LocalVideo : InvidiousVideo }>,
 *   loadWatchMetadata: (preference: string, options: {
 *     loadLocal: () => Promise<unknown>, loadInvidious: () => Promise<unknown>,
 *     localAvailable?: boolean, defaultProvider?: VideoProvider | null,
 *     failedProvider?: VideoProvider, error?: unknown, fallbackEnabled?: boolean,
 *     onFallback?: (from: VideoProvider, to: VideoProvider, error: unknown) => void,
 *     onNoProvider?: () => Promise<unknown> | void,
 *   }) => Promise<unknown> | undefined,
 *   resolveProvider: (preference: string, options?: {
 *     localAvailable?: boolean,
 *     defaultProvider?: VideoProvider | null,
 *   }) => VideoProvider | null,
 *   getFallbackProvider: (provider: VideoProvider, options: {
 *     preferredProvider: string,
 *     localAvailable: boolean,
 *     fallbackEnabled: boolean,
 *     error?: unknown,
 *   }) => VideoProvider | null,
 * }} VideoApi
 */

/**
 * @template LocalVideo, InvidiousVideo, LocalMetadata, InvidiousMetadata
 * @param {VideoProviderAdapters<LocalVideo, InvidiousVideo, LocalMetadata, InvidiousMetadata>} providers
 * @returns {VideoApi<LocalVideo, InvidiousVideo, LocalMetadata, InvidiousMetadata>}
 */
export function createVideoApi({ loadLocal, loadInvidious, mapLocal, mapInvidious }) {
  return {
    getVideoInformation(videoId, provider) {
      switch (provider) {
        case 'local': return loadLocal(videoId)
        case 'invidious': return loadInvidious(videoId)
        default: throw new Error(`Unknown video provider: ${provider}`)
      }
    },
    async getWatchVideoInformation(videoId, provider, options = {}) {
      switch (provider) {
        case 'local': {
          const source = await loadLocal(videoId)
          return { provider, metadata: mapLocal(source, { ...options, videoId }), source }
        }
        case 'invidious': {
          if (typeof options.instanceUrl !== 'string' || options.instanceUrl.length === 0) {
            throw new TypeError('Invidious instance URL is required')
          }
          const source = await loadInvidious(videoId)
          return { provider, metadata: mapInvidious(source, { ...options, videoId }), source }
        }
        default: throw new Error(`Unknown video provider: ${provider}`)
      }
    },
    loadWatchMetadata(preference, {
      loadLocal,
      loadInvidious,
      localAvailable = true,
      defaultProvider = null,
      failedProvider,
      error,
      fallbackEnabled = false,
      onFallback,
      onNoProvider,
    }) {
      const provider = failedProvider
        ? this.getFallbackProvider(failedProvider, {
            preferredProvider: preference,
            localAvailable,
            fallbackEnabled,
            error,
          })
        : this.resolveProvider(preference, { localAvailable, defaultProvider })
      if (provider === null) return onNoProvider?.()
      if (failedProvider) onFallback?.(failedProvider, provider, error)
      if (provider === 'local') return loadLocal()
      loadInvidious()
    },
    resolveProvider(preference, { localAvailable = true, defaultProvider = null } = {}) {
      const provider = preference === 'local' || preference === 'invidious'
        ? preference
        : defaultProvider
      return provider === 'local' && !localAvailable ? 'invidious' : provider
    },
    getFallbackProvider(provider, { preferredProvider, localAvailable, fallbackEnabled, error }) {
      if (!fallbackEnabled || provider !== preferredProvider) return null
      if (provider === 'invidious') return localAvailable ? 'local' : null
      const message = String(error)
      return message.includes('private') || message.includes('unavailable') ? null : 'invidious'
    },
  }
}
