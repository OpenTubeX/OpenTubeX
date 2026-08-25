const DEFAULT_EXPIRY_MARGIN_MS = 2 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 50

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
   */
  set(videoId, cacheKey, source) {
    const expiryTime = source.expiryDate instanceof Date ? source.expiryDate.getTime() : NaN
    if (
      !Number.isFinite(expiryTime) ||
      this.now() >= expiryTime - this.expiryMarginMs
    ) {
      return
    }

    this.sources.delete(videoId)
    while (this.sources.size >= this.maxEntries) {
      this.sources.delete(this.sources.keys().next().value)
    }
    this.sources.set(videoId, { cacheKey, source })
  }

  /**
   * @param {string} videoId
   */
  delete(videoId) {
    this.sources.delete(videoId)
  }

  clear() {
    this.sources.clear()
  }
}
