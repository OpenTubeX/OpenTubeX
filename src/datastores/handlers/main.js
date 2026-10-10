import { libraryRequest } from '../sqlite/client.js'

function handler(name) {
  return new Proxy({}, {
    get: (_target, method) => (...args) => libraryRequest(`handler:${name}`, method, args)
  })
}

export const settings = handler('settings')
export const history = handler('history')
export const watchStats = handler('watchStats')
export const recommendations = handler('recommendations')
export const profiles = handler('profiles')
export const playlists = handler('playlists')
export const searchHistory = handler('searchHistory')
export const subscriptionCache = handler('subscriptionCache')
export const tabSession = handler('tabSession')
export const loadDatastores = () => libraryRequest('engine', 'initialize')
export const loadDeferredDatastores = loadDatastores
export const compactAllDatastores = () => libraryRequest('engine', 'checkpoint').then(() => [{ status: 'fulfilled' }])
