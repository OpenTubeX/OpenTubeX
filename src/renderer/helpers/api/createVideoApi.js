/** @typedef {'local' | 'invidious'} VideoProvider */

/**
 * @template LocalVideo, InvidiousVideo
 * @typedef {{
 *   loadLocal: (videoId: string) => Promise<LocalVideo>,
 *   loadInvidious: (videoId: string) => Promise<InvidiousVideo>,
 * }} VideoProviderAdapters
 */

/**
 * @template LocalVideo, InvidiousVideo
 * @typedef {{
 *   getVideoInformation: <Provider extends VideoProvider>(videoId: string, provider: Provider) =>
 *     Promise<Provider extends 'local' ? LocalVideo : InvidiousVideo>,
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
 * @template LocalVideo, InvidiousVideo
 * @param {VideoProviderAdapters<LocalVideo, InvidiousVideo>} providers
 * @returns {VideoApi<LocalVideo, InvidiousVideo>}
 */
export function createVideoApi({ loadLocal, loadInvidious }) {
  return {
    getVideoInformation(videoId, provider) {
      switch (provider) {
        case 'local': return loadLocal(videoId)
        case 'invidious': return loadInvidious(videoId)
        default: throw new Error(`Unknown video provider: ${provider}`)
      }
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
