import store from '../store/index'

export { getTabPageIcon } from './tabPageIcon'

/**
 * Resolve the fallback preview image for a tab when no screenshot has been
 * captured yet. Currently this is the channel's profile picture for channel
 * tabs, cached by the Channel view.
 * @param {{ route?: { path?: string } }} tab
 * @returns {string | null}
 */
export function getTabPreviewFallbackUrl(tab) {
  return getTabAvatarUrl(tab)
}

export function getTabAvatarUrl(tab) {
  const path = tab?.route?.path ?? ''
  const channelId = path.match(/^\/channel\/([^/]+)/)?.[1]
  if (channelId) return store.getters.getChannelThumbnail(channelId)

  const videoId = path.match(/^\/watch\/([^/]+)/)?.[1]
  return videoId ? store.getters.getVideoAvatar(videoId) : null
}
