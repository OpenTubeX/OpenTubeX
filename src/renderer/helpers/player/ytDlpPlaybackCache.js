const DEFAULT_EXPIRY_MARGIN_MS = 2 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 50

/**
 * @param {import('./ytDlpPlayback').YtDlpPlaybackSource} source
 * @param {number} [now]
 * @param {number} [expiryMarginMs]
 */
export function isYtDlpPlaybackSourceCacheable(
  source,
  now = Date.now(),
  expiryMarginMs = DEFAULT_EXPIRY_MARGIN_MS
) {
  const expiryTime = source.expiryDate instanceof Date ? source.expiryDate.getTime() : NaN
  return !source.isLive && Number.isFinite(expiryTime) && now < expiryTime - expiryMarginMs
}

/**
 * @param {{ url: string }[]} formats
 * @returns {Date | null}
 */
export function getEarliestYtDlpFormatExpiry(formats) {
  let earliestExpiry = Infinity

  for (const format of formats) {
    const url = new URL(format.url)
    const queryExpiry = parseInt(url.searchParams.get('expire'))
    const pathExpiry = parseInt(url.pathname.match(/\/expire\/(\d+)(?:\/|$)/)?.[1])
    const expire = Number.isFinite(queryExpiry) ? queryExpiry : pathExpiry

    if (Number.isFinite(expire)) {
      earliestExpiry = Math.min(earliestExpiry, expire)
    }
  }

  return Number.isFinite(earliestExpiry) ? new Date(earliestExpiry * 1000) : null
}

export class YtDlpPlaybackSourceCache {
  /**
   * @param {{ expiryMarginMs?: number, maxEntries?: number, now?: () => number }} [options]
   */
  constructor({
    expiryMarginMs = DEFAULT_EXPIRY_MARGIN_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    now = Date.now
  } = {}) {
    this.expiryMarginMs = expiryMarginMs
    this.maxEntries = maxEntries
    this.now = now
    /** @type {Map<string, { cacheKey: string, source: import('./ytDlpPlayback').YtDlpPlaybackSource }>} */
    this.sources = new Map()
  }

  /**
   * @param {string} videoId
   * @param {string} cacheKey
   * @returns {import('./ytDlpPlayback').YtDlpPlaybackSource | null}
   */
  get(videoId, cacheKey) {
    const entry = this.sources.get(videoId)
    const expiryTime = entry?.source.expiryDate instanceof Date
      ? entry.source.expiryDate.getTime()
      : NaN

    if (
      entry === undefined ||
      entry.cacheKey !== cacheKey ||
      !Number.isFinite(expiryTime) ||
      this.now() >= expiryTime - this.expiryMarginMs
    ) {
      this.sources.delete(videoId)
      return null
    }

    // Refresh insertion order so the size limit evicts the least recently used source.
    this.sources.delete(videoId)
    this.sources.set(videoId, entry)
    return entry.source
  }

  /**
   * @param {string} videoId
   * @param {string} cacheKey
   * @param {import('./ytDlpPlayback').YtDlpPlaybackSource} source
   * @returns {boolean} whether the source was cached
   */
  set(videoId, cacheKey, source) {
    if (!isYtDlpPlaybackSourceCacheable(source, this.now(), this.expiryMarginMs)) {
      return false
    }

    this.sources.delete(videoId)
    while (this.sources.size >= this.maxEntries) {
      this.sources.delete(this.sources.keys().next().value)
    }
    this.sources.set(videoId, { cacheKey, source })
    return true
  }

  /**
   * Returns when a cached source stops being safely reusable without changing
   * its LRU position.
   * @param {string} videoId
   * @param {string} cacheKey
   * @param {boolean} [requireSubtitles]
   * @returns {number | null}
   */
  getUsableUntil(videoId, cacheKey, requireSubtitles = false) {
    const entry = this.sources.get(videoId)
    const expiryTime = entry?.source.expiryDate instanceof Date
      ? entry.source.expiryDate.getTime()
      : NaN

    if (
      entry === undefined ||
      entry.cacheKey !== cacheKey ||
      !Number.isFinite(expiryTime) ||
      this.now() >= expiryTime - this.expiryMarginMs
    ) {
      this.sources.delete(videoId)
      return null
    }

    if (requireSubtitles && !entry.source.subtitlesIncluded) return null

    return expiryTime - this.expiryMarginMs
  }

  /**
   * Expands the session cache for an explicit playlist preload. Automatic
   * preloading remains within the normal entry limit.
   * @param {number} entries
   */
  ensureCapacity(entries) {
    if (Number.isInteger(entries) && entries > this.maxEntries) {
      this.maxEntries = entries
    }
  }

  /**
   * @param {string} videoId
   * @returns {boolean} whether a source was removed
   */
  delete(videoId) {
    return this.sources.delete(videoId)
  }

  /**
   * @returns {boolean} whether any sources were removed
   */
  clear() {
    const changed = this.sources.size > 0
    this.sources.clear()
    return changed
  }
}
