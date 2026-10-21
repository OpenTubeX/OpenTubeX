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
