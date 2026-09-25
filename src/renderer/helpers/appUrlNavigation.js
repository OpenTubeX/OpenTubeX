/**
 * Route a parsed YouTube URL through the application's tab navigation boundary.
 * The parser and navigation operations are supplied by the root component.
 *
 * @param {{
 *   getUrlInfo: (href: string) => Promise<import('./youtubeUrlInfo.js').YoutubeUrlInfo>,
 *   openInternalPath: (options: Record<string, unknown>) => unknown,
 *   navigateTab: (tabId: string, location: {path: string, query?: Record<string, unknown>}) => unknown,
 *   showUnknownUrl: (info: import('./youtubeUrlInfo.js').YoutubeUrlInfo) => void,
 *   isElectron: boolean,
 * }} dependencies
 */
export function createAppUrlNavigation({
  getUrlInfo, openInternalPath, navigateTab, showUnknownUrl, isElectron,
}) {
  /**
   * @param {string} href
   * @param {{doCreateNewWindow?: boolean, doCreateNewTab?: boolean, isMiddleClick?: boolean, tabId?: string | null}} [disposition]
   */
  async function openYoutubeLink(href, {
    doCreateNewWindow = false,
    doCreateNewTab = false,
    isMiddleClick = false,
    tabId = null,
  } = {}) {
    const result = await getUrlInfo(href)
    const makeActive = !isMiddleClick
    const openPath = (options) => {
      if (isElectron && tabId && !options.doCreateNewWindow && !options.doCreateNewTab) {
        return navigateTab(tabId, { path: options.path, query: options.query })
      }
      return openInternalPath(options)
    }

    switch (result.urlType) {
      case 'video': {
        const { videoId, timestamp, playlistId, commentId, isShort } = result
        const query = {}
        if (isShort) query.short = 'true'
        if (timestamp) query.timestamp = timestamp
        if (playlistId && playlistId.length > 0) query.playlistId = playlistId
        if (commentId) query.commentId = commentId
        openPath({ path: `/watch/${videoId}`, query, doCreateNewWindow, doCreateNewTab, makeActive })
        break
      }
      case 'playlist':
        openPath({ path: `/playlist/${result.playlistId}`, query: result.query, doCreateNewWindow, doCreateNewTab, makeActive })
        break
      case 'search':
        openPath({
          path: `/search/${encodeURIComponent(result.searchQuery)}`,
          query: result.query,
          doCreateNewWindow,
          doCreateNewTab,
          makeActive,
          searchQueryText: result.searchQuery,
        })
        break
      case 'hashtag':
        openPath({ path: `/hashtag/${encodeURIComponent(result.hashtag)}`, doCreateNewWindow, doCreateNewTab, makeActive })
        break
      case 'post':
        openPath({ path: `/post/${result.postId}`, query: result.query, doCreateNewWindow, doCreateNewTab, makeActive })
        break
      case 'channel':
        openPath({
          path: `/channel/${result.channelId}/${result.subPath}`,
          doCreateNewWindow,
          doCreateNewTab,
          makeActive,
          query: { url: result.url },
        })
        break
      case 'trending':
      case 'subscriptions':
      case 'history':
      case 'userplaylists':
        openPath({ path: `/${result.urlType}`, doCreateNewWindow, doCreateNewTab, makeActive })
        break
      case 'invalid_url':
        break
      default:
        showUnknownUrl(result)
    }
  }

  return { openYoutubeLink }
}
