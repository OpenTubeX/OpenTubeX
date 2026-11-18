import * as baseHandlers from './base'
import { loadLegacySubscriptionCache, removeLegacySubscriptionCache } from '../index'
import { createBrowserSubscriptionCache } from '../browserSubscriptionCache'
import { getDataScope } from './dataScope.js'

export const subscriptionCache = createBrowserSubscriptionCache(
  loadLegacySubscriptionCache,
  'opentubex-subscription-cache',
  removeLegacySubscriptionCache
)

// TODO: Syncing
// Syncing on the web would involve a different implementation
// to the electron one (obviously)
// One idea would be to use a watcher-like mechanism on
// localStorage or IndexedDB to inform other tabs on the changes
// that have occurred in other tabs
//
// NOTE: NeDB uses `localForage` on the browser
// https://www.npmjs.com/package/localforage

class Settings {
  static mergeSeenPosts(update) {
    return baseHandlers.settings.mergeSeenPosts(update)
  }

  static mergeSeenVideos(update) {
    return baseHandlers.settings.mergeSeenVideos(update)
  }

  static mergeSeenRssItems(update) {
    return baseHandlers.settings.mergeSeenRssItems(update)
  }

  static find() {
    return baseHandlers.settings.find()
  }

  static async findValue(_id) {
    return (await baseHandlers.settings._findOne(_id))?.value
  }

  static upsert(_id, value) {
    return baseHandlers.settings.upsert(_id, value)
  }

  static delete(_id) {
    return baseHandlers.settings.delete(_id)
  }
}

// For the settings we use the wrapper class to hide some methods only needed in the Electron main process
export { Settings as settings }

/**
 * Forwards each call to the handlers of the data scope active at that moment.
 * @param {'history' | 'watchStats' | 'recommendations' | 'playlists' | 'searchHistory'} key
 */
function scoped(key) {
  return new Proxy({}, {
    get(_, property) {
      const handlers = baseHandlers.scopedHandlers(getDataScope())[key]
      const value = handlers[property]
      return typeof value === 'function' ? value.bind(handlers) : value
    },
  })
}

export const history = scoped('history')
export const watchStats = scoped('watchStats')
export const recommendations = scoped('recommendations')
export const playlists = scoped('playlists')
export const searchHistory = scoped('searchHistory')

// These classes don't require any changes from the base classes, so can be exported as-is.
export {
  profiles,
  compactAllDatastores,
} from './base'
