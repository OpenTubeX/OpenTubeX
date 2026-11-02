export const FULLSCREEN_ACTION_DEFINITIONS = Object.freeze([
  { id: 'queue', labelKey: 'Video.Queue', icon: ['fas', 'queue'] },
  { id: 'playlist', labelKey: 'Playlist.Playlist', icon: ['fas', 'list'] },
  { id: 'liveChat', labelKey: 'Video.Live Chat', icon: ['fas', 'message'] },
  { id: 'comments', labelKey: 'Comments.Comments', icon: ['fas', 'comment'] },
  { id: 'sponsorBlock', labelKey: 'Settings.SponsorBlock Settings.SponsorBlock Settings', icon: ['fas', 'shield-halved'] },
  { id: 'transcript', labelKey: 'Video.Transcript.Title', icon: ['fas', 'file-lines'] },
  { id: 'share', labelKey: 'Share.Share Video', icon: ['fas', 'share-alt'] },
  { id: 'addToPlaylist', labelKey: 'User Playlists.Add to Playlist', icon: ['fac', 'playlist-add'] },
  { id: 'quickBookmark', labelKey: 'Settings.Fullscreen Actions.Quick Bookmark', icon: ['fas', 'bookmark'] },
  { id: 'download', labelKey: 'Downloads.Download Video', icon: ['fas', 'download'], defaultEnabled: false },
  { id: 'recommendations', labelKey: 'Settings.Fullscreen Actions.Recommended Videos', icon: ['fas', 'circle-play'], defaultEnabled: false },
])

export const DEFAULT_FULLSCREEN_ACTIONS = Object.freeze(FULLSCREEN_ACTION_DEFINITIONS.filter(action => action.defaultEnabled !== false).map(({ id }) => id))
const ACTION_IDS = new Set(FULLSCREEN_ACTION_DEFINITIONS.map(({ id }) => id))

/** Removes unknown and duplicate actions while preserving the selected order. */
export function normalizeFullscreenActions(value) {
  if (!Array.isArray(value)) return [...DEFAULT_FULLSCREEN_ACTIONS]
  return [...new Set(value.filter(id => ACTION_IDS.has(id)))]
}

/** Keep unavailable actions in preferences so they return on videos that support them. */
export function getAvailableFullscreenActions(value, availability) {
  return normalizeFullscreenActions(value).filter(id => availability[id])
}

/**
 * The actions that settings turn off on every video, which the player never shows.
 * @param {Record<string, unknown>} getters The store's getters.
 * @param {boolean} downloadsSupported Whether this build can download videos.
 */
export function getDisabledFullscreenActions(getters, downloadsSupported) {
  const disabled = {
    liveChat: getters.getHideLiveChat && getters.getHideLiveChatReplay,
    comments: getters.getHideComments,
    sponsorBlock: !getters.getUseSponsorBlock,
    share: getters.getHideSharingActions,
    addToPlaylist: getters.getHidePlaylists,
    quickBookmark: getters.getQuickBookmarkPlaylist == null,
    download: !downloadsSupported || !getters.getEnableDownloads,
    recommendations: getters.getHideRecommendedVideos,
  }
  return new Set(FULLSCREEN_ACTION_DEFINITIONS.map(({ id }) => id).filter(id => disabled[id]))
}
