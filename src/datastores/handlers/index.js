export {
  settings as DBSettingHandlers,
  history as DBHistoryHandlers,
  watchStats as DBWatchStatsHandlers,
  recommendations as DBRecommendationHandlers,
  profiles as DBProfileHandlers,
  playlists as DBPlaylistHandlers,
  searchHistory as DBSearchHistoryHandlers,
  subscriptionCache as DBSubscriptionCacheHandlers,
  feedCache as DBFeedCacheHandlers,
  compactAllDatastores,
} from 'DB_HANDLERS_ELECTRON_RENDERER_OR_WEB'

export { getDataScope, setDataScope, withDataScope } from './dataScope.js'
