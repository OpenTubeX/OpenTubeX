const DEFAULT_EXPIRY_MARGIN_MS = 2 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 50

/**
 * @param {{ url: string }[]} formats
 * @returns {Date | null}
 */
export function getEarliestYtDlpFormatExpiry(formats) {
  let earliestExpiry = Infinity

  for (const format of formats) {
    const expire = parseInt(new URL(format.url).searchParams.get('expire'))

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
    /** @type {Map<string, import('./ytDlpPlayback').YtDlpPlaybackSource>} */
    this.sources = new Map()
  }

  /**
   * @param {string} videoId
   * @returns {import('./ytDlpPlayback').YtDlpPlaybackSource | null}
   */
  get(videoId) {
    const source = this.sources.get(videoId)

    if (
      source === undefined ||
      source.expiryDate === null ||
      this.now() >= source.expiryDate.getTime() - this.expiryMarginMs
    ) {
      this.sources.delete(videoId)
      return null
    }

    // Refresh insertion order so the size limit evicts the least recently used source.
    this.sources.delete(videoId)
    this.sources.set(videoId, source)
    return source
  }

  /**
   * @param {string} videoId
   * @param {import('./ytDlpPlayback').YtDlpPlaybackSource} source
   */
  set(videoId, source) {
    if (
      source.expiryDate === null ||
      this.now() >= source.expiryDate.getTime() - this.expiryMarginMs
    ) {
      return
    }

    this.sources.delete(videoId)
    while (this.sources.size >= this.maxEntries) {
      this.sources.delete(this.sources.keys().next().value)
    }
    this.sources.set(videoId, source)
  }

  /**
   * @param {string} videoId
   */
  delete(videoId) {
    this.sources.delete(videoId)
  }
}
