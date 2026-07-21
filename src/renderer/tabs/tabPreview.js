import store from '../store/index'

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

const PAGE_ICONS = [
  [/^\/$|^\/subscriptions(?:\/|$)/, ['fas', 'rss']],
  [/^\/subscribedchannels(?:\/|$)/, ['fas', 'user-check']],
  [/^\/trending(?:\/|$)/, ['fas', 'fire']],
  [/^\/popular(?:\/|$)/, ['fas', 'users']],
  [/^\/(?:userplaylists|playlist)(?:\/|$)/, ['fas', 'bookmark']],
  [/^\/history(?:\/|$)/, ['fas', 'history']],
  [/^\/stats(?:\/|$)/, ['fas', 'chart-line']],
  [/^\/settings(?:\/|$)/, ['fas', 'sliders-h']],
  [/^\/about(?:\/|$)/, ['fas', 'info-circle']],
  [/^\/search(?:\/|$)/, ['fas', 'search']],
  [/^\/channel(?:\/|$)/, ['fas', 'circle-user']],
  [/^\/hashtag(?:\/|$)/, ['fas', 'hashtag']],
  [/^\/post(?:\/|$)/, ['fas', 'comment']],
  [/^\/watch(?:\/|$)/, ['fas', 'play']],
]

export function getTabPageIcon(tab) {
  const path = tab?.route?.path ?? ''
  return PAGE_ICONS.find(([pattern]) => pattern.test(path))?.[1] ?? null
}
