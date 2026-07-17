import store from '../store/index'

/**
 * Resolve the fallback preview image for a tab when no screenshot has been
 * captured yet. Currently this is the channel's profile picture for channel
 * tabs, cached by the Channel view.
 * @param {{ route?: { path?: string } }} tab
 * @returns {string | null}
 */
export function getTabPreviewFallbackUrl(tab) {
  const channelId = tab?.route?.path?.match(/^\/channel\/([^/]+)/)?.[1]
  return channelId ? store.getters.getChannelThumbnail(channelId) : null
}
