// cleanup expired images once every 5 mins
const CLEANUP_INTERVAL = 300_000

// images expire after 2 hours if no expiry information is found in the http headers
const FALLBACK_MAX_AGE = 7200

// Thumbnails are mostly 10-40 KB, so this keeps several thousand of the most
// recently used ones while bounding the memory of long sessions.
const MAX_CACHE_BYTES = 64 * 1024 * 1024

export class ImageCache {
  constructor(maxBytes = MAX_CACHE_BYTES) {
    // Iterates in insertion order, and reading an entry reinserts it, so the
    // least recently used images come first.
    this._cache = new Map()
    this._maxBytes = maxBytes
    this._bytes = 0

    setInterval(this._cleanup.bind(this), CLEANUP_INTERVAL).unref()
  }

  add(url, mimeType, data, expiry) {
    this._delete(url)
    // An image the origin already marked stale is not worth keeping, and one
    // larger than the whole budget would only evict everything else.
    if (!(expiry > Math.trunc(Date.now() / 1000)) || data.byteLength > this._maxBytes) return
    this._cache.set(url, { mimeType, data, expiry })
    this._bytes += data.byteLength

    for (const key of this._cache.keys()) {
      if (this._bytes <= this._maxBytes) break
      this._delete(key)
    }
  }

  has(url) {
    const entry = this._cache.get(url)
    if (entry && !(entry.expiry > Math.trunc(Date.now() / 1000))) {
      this._delete(url)
      return false
    }
    return entry !== undefined
  }

  get(url) {
    const entry = this._cache.get(url)

    if (!entry) {
      // this should never happen as the `has` method should be used to check for the existence first
      throw new Error(`No image cache entry for ${url}`)
    }

    this._cache.delete(url)
    this._cache.set(url, entry)

    return {
      data: entry.data,
      mimeType: entry.mimeType
    }
  }

  _delete(url) {
    const entry = this._cache.get(url)
    if (entry) {
      this._bytes -= entry.data.byteLength
      this._cache.delete(url)
    }
  }

  _cleanup() {
    // seconds since 1970-01-01 00:00:00
    const now = Math.trunc(Date.now() / 1000)

    for (const [key, entry] of this._cache.entries()) {
      if (!(entry.expiry > now)) {
        this._delete(key)
      }
    }
  }
}

/**
 * Extracts the cache expiry timestamp of image from HTTP headers
 * @param {Record<string, string>} headers
 * @returns a timestamp in seconds
 */
export function extractExpiryTimestamp(headers) {
  const maxAgeRegex = /max-age=(\d+)/

  const cacheControl = headers['cache-control']
  // The cache cannot revalidate, so a no-cache image is as unreusable as a
  // no-store one; an expiry in the past keeps both out of it.
  if (cacheControl && /(?:^|,)\s*no-(?:store|cache)\s*(?:[,=]|$)/i.test(cacheControl)) {
    return 0
  }

  if (cacheControl && maxAgeRegex.test(cacheControl)) {
    let maxAge = parseInt(cacheControl.match(maxAgeRegex)[1])

    if (headers.age) {
      maxAge -= parseInt(headers.age)
    }

    // we don't need millisecond precision, so we can store it as seconds to use less memory
    return Math.trunc(Date.now() / 1000) + maxAge
  }

  if (headers.expires) {
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Expires
    // Unparsable dates must not produce a NaN that never expires. A date in
    // the past (including "-1" and "0", which V8 parses as years 2001 and
    // 2000) is returned as is so the cache skips the already stale image.
    const expires = Date.parse(headers.expires)
    if (Number.isFinite(expires)) {
      return Math.trunc(expires / 1000)
    }
  }

  return Math.trunc(Date.now() / 1000) + FALLBACK_MAX_AGE
}

/**
 * Creates the `imagecache://` protocol handler, which serves images from the
 * in-memory cache and otherwise fetches them with `request`.
 * @param {ImageCache} imageCache
 * @param {(url: string, webContentsId: number) => Record<string, string> | undefined} getAuthorizationHeaders
 * @param {typeof import('electron').net.request} request
 * @param {number} [maxBytes] larger responses are aborted, so a huge or endless one cannot exhaust the main process's memory
 * @returns {(request: Request) => Promise<Response>}
 */
export function createImageCacheHandler(imageCache, getAuthorizationHeaders, request, maxBytes = 50 * 1024 * 1024) {
  return (protocolRequest) => {
    const [requestUrl, rawWebContentsId] = protocolRequest.url.split('#')

    return new Promise((resolve, reject) => {
      const url = decodeURIComponent(requestUrl.substring(13))
      const headers = rawWebContentsId
        ? getAuthorizationHeaders(url, parseInt(rawWebContentsId))
        : undefined
      // The cache is keyed by URL alone, so images fetched with an account's
      // credentials must neither come from it nor go into it.
      const cacheable = headers === undefined

      if (cacheable && imageCache.has(url)) {
        const cached = imageCache.get(url)

        resolve(new Response(cached.data, {
          headers: { 'content-type': cached.mimeType }
        }))
        return
      }

      const newRequest = request({
        method: protocolRequest.method,
        url,
        headers
      })

      newRequest.on('response', (response) => {
        const chunks = []
        let receivedBytes = 0
        let tooLarge = false
        response.on('data', (chunk) => {
          if (tooLarge) return
          receivedBytes += chunk.length
          if (receivedBytes > maxBytes) {
            tooLarge = true
            chunks.length = 0
            newRequest.abort()
            reject(new Error(`Image is too large: ${url}`))
            return
          }
          chunks.push(chunk)
        })

        response.on('end', () => {
          if (tooLarge) return
          const data = Buffer.concat(chunks)
          const mimeType = response.headers['content-type']

          // Only a complete 200 response is an image worth keeping; an error
          // page or a partial 206 answer would be served to every later
          // request for the URL as if it were the whole image.
          if (cacheable && response.statusCode === 200) {
            imageCache.add(url, mimeType, data, extractExpiryTimestamp(response.headers))
          }

          // Response() only accepts 200-599 and throws when a body accompanies
          // a status that forbids one.
          const status = response.statusCode >= 200 && response.statusCode <= 599
            ? response.statusCode
            : 502
          const bodyAllowed = ![204, 205, 304].includes(status)
          resolve(new Response(bodyAllowed ? data : null, {
            status,
            headers: { 'content-type': mimeType }
          }))
        })

        response.on('error', (error) => {
          console.error('image cache error', error)
          reject(error)
        })
      })

      newRequest.on('error', (err) => {
        // Settle the request so the <img> fires its error event and the
        // renderer can show a placeholder instead of waiting forever.
        console.error(err)
        reject(err)
      })

      newRequest.end()
    })
  }
}
