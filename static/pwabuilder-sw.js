/* eslint-disable no-console */
// This is the service worker with the Advanced caching

const CACHE = 'pwabuilder-adv-cache'
// Production builds hash their scripts and styles, so only the page is
// precached. Each asset is cached when the app first loads it.
const offlineFallbackPage = 'index.html'

const networkFirstPaths = [
  /* Add an array of regex of paths that should go network first */
  // Example: /\/api\/.*/
  // The settings of a self-hosted server, which its admin can change
  /\/self-hosted\.js$/
]

const avoidCachingPaths = [
  /* Add an array of regex of paths that shouldn't be cached */
  // Example: /\/api\/.*/
]

function pathComparer(requestUrl, pathRegEx) {
  return requestUrl.match(new RegExp(pathRegEx))
}

function comparePaths(requestUrl, pathsArray) {
  if (requestUrl) {
    for (let index = 0; index < pathsArray.length; index++) {
      const pathRegEx = pathsArray[index]
      if (pathComparer(requestUrl, pathRegEx)) {
        return true
      }
    }
  }

  return false
}

self.addEventListener('install', function (event) {
  console.log('[PWA Builder] Install Event processing')

  console.log('[PWA Builder] Skip waiting on install')
  self.skipWaiting()

  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      console.log('[PWA Builder] Caching pages during install')

      // The page's own scripts and styles loaded before this worker could
      // cache them, so fetch them now for the app to open offline next time.
      // One that fails is cached when the app next loads it.
      return cache.add(offlineFallbackPage)
        .then(function () { return cache.match(offlineFallbackPage) })
        .then(function (response) { return response.text() })
        .then(function (html) {
          const assets = Array.from(html.matchAll(/(?:src|href)="([^":]+\.(?:js|css))"/g), function (match) { return match[1] })
          return Promise.allSettled(assets.map(function (asset) { return cache.add(asset) }))
        })
    })
  )
})

// Allow sw to control of current page
self.addEventListener('activate', function (event) {
  console.log('[PWA Builder] Claiming clients for current page')
  event.waitUntil(self.clients.claim())
})

// If any fetch fails, it will look for the request in the cache and serve it from there first
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return
  // Only the app itself is cached. Cached API responses, such as YouTube's
  // watch pages, would come back with expired stream URLs.
  const { origin, pathname } = new URL(event.request.url)
  if (origin !== self.location.origin) return
  // fetch() calls from the app that must reach the server, such as connectivity checks, skip the cache.
  // Pages and assets the browser revalidates on reload keep it, so the app still opens offline.
  if (event.request.destination === '' && ['no-store', 'no-cache', 'reload'].includes(event.request.cache)) return
  // Self-hosted servers proxy Invidious on the app's origin. Its responses contain
  // expiring stream URLs, and the HTTP cache already handles its images.
  if (/^\/(api|companion|vi|ggpht|sb|videoplayback|latest_version)(\/|$)/.test(pathname)) return

  // The page goes network first, so it always loads the newest build's hashed assets when online.
  if (event.request.mode === 'navigate' || comparePaths(event.request.url, networkFirstPaths)) {
    networkFirstFetch(event)
  } else {
    cacheFirstFetch(event)
  }
})

function cacheFirstFetch(event) {
  event.respondWith(
    fromCache(event.request).then(
      function (response) {
        // The response was found in the cache so we respond with it and update the entry

        // This is where we call the server to get the newest version of the
        // file to use the next time we show view
        event.waitUntil(
          fetch(event.request).then(function (response) {
            return updateCache(event.request, response)
          })
        )

        return response
      },
      function () {
        // The response was not found in the cache so we look for it on the server
        return fetch(event.request)
          .then(function (response) {
            // If request was success, add or update it in the cache
            event.waitUntil(updateCache(event.request, response.clone()))

            return response
          })
      }
    )
  )
}

function networkFirstFetch(event) {
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        // If request was success, add or update it in the cache
        event.waitUntil(updateCache(event.request, response.clone()))
        return response
      })
      .catch(function (error) {
        console.error('[PWA Builder] Network request Failed. Serving content from cache: ' + error)
        return fromCache(event.request).catch(function () {
          if (event.request.mode !== 'navigate') throw error
          return caches.open(CACHE).then(function (cache) {
            return cache.match(offlineFallbackPage)
          })
        })
      })
  )
}

function fromCache(request) {
  // Check to see if you have it in the cache
  // Return response
  // If not in the cache, then return error page
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (matching) {
      if (!matching || matching.status === 404) {
        return Promise.reject(new Error('no-match'))
      }

      return matching
    })
  })
}

function updateCache(request, response) {
  // Keep error responses, such as a 502 during a server restart, out of the cache.
  if (response.ok && !comparePaths(request.url, avoidCachingPaths)) {
    return caches.open(CACHE).then(function (cache) {
      return cache.put(request, response)
    })
  }

  return Promise.resolve()
}
