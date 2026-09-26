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
 *   getVideoInformation: ((videoId: string, provider: 'local') => Promise<LocalVideo>) &
 *     ((videoId: string, provider: 'invidious') => Promise<InvidiousVideo>),
 *   getWatchVideoInformation: ((videoId: string, provider: 'local', options?: LocalWatchOptions) =>
 *     Promise<{provider: 'local', metadata: LocalMetadata, source: LocalVideo}>) &
 *     ((videoId: string, provider: 'invidious', options: InvidiousWatchOptions) =>
 *     Promise<{provider: 'invidious', metadata: InvidiousMetadata, source: InvidiousVideo}>),
 *   loadWatchMetadata: (preference: string, options: {
 *     loadLocal: () => Promise<unknown>, loadInvidious: () => Promise<unknown>,
 *     localAvailable?: boolean, defaultProvider?: VideoProvider | null,
 *     failedProvider?: VideoProvider, error?: unknown, fallbackEnabled?: boolean,
 *     onFallback?: (from: VideoProvider, to: VideoProvider, error: unknown) => void,
 *     onNoProvider?: () => Promise<unknown> | void,
 *   }) => Promise<unknown> | void,
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
  /**
   * @overload
   * @param {string} videoId
   * @param {'local'} provider
   * @returns {Promise<LocalVideo>}
   */
  /**
   * @overload
   * @param {string} videoId
   * @param {'invidious'} provider
   * @returns {Promise<InvidiousVideo>}
   */
  /** @param {string} videoId @param {VideoProvider} provider */
  function getVideoInformation(videoId, provider) {
    switch (provider) {
      case 'local': return loadLocal(videoId)
      case 'invidious': return loadInvidious(videoId)
      default: throw new Error(`Unknown video provider: ${provider}`)
    }
  }

  /**
   * @overload
   * @param {string} videoId
   * @param {'local'} provider
   * @param {LocalWatchOptions} [options]
   * @returns {Promise<{provider: 'local', metadata: LocalMetadata, source: LocalVideo}>}
   */
  /**
   * @overload
   * @param {string} videoId
   * @param {'invidious'} provider
   * @param {InvidiousWatchOptions} options
   * @returns {Promise<{provider: 'invidious', metadata: InvidiousMetadata, source: InvidiousVideo}>}
   */
  /** @param {string} videoId @param {VideoProvider} provider @param {LocalWatchOptions | InvidiousWatchOptions} [options] */
  async function getWatchVideoInformation(videoId, provider, options = {}) {
    switch (provider) {
      case 'local': {
        const source = await loadLocal(videoId)
        return { provider, metadata: mapLocal(source, { ...options, videoId }), source }
      }
      case 'invidious': {
        if (!('instanceUrl' in options) || typeof options.instanceUrl !== 'string' || options.instanceUrl.length === 0) {
          throw new TypeError('Invidious instance URL is required')
        }
        const source = await loadInvidious(videoId)
        return { provider, metadata: mapInvidious(source, { ...options, videoId }), source }
      }
      default: throw new Error(`Unknown video provider: ${provider}`)
    }
  }

  return {
    getVideoInformation,
    getWatchVideoInformation,
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
