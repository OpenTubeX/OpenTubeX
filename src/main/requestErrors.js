// A failed renderer fetch only reports "TypeError: Failed to fetch". Electron
// reports the network error to webRequest before the renderer sees the failure,
// so keep it briefly for the renderer to tell a lost connection from a failure
// that retrying cannot fix.
const ERROR_LIFETIME_MS = 10_000

export class RequestErrors {
  /** @type {Map<number, string>} request ID to the URL the renderer requested */
  urls = new Map()
  /** @type {Map<string, {error: string, expiresAt: number}>} */
  errors = new Map()

  /**
   * Redirects keep the request ID, but the renderer only knows the first URL.
   * @param {{id: number, url: string}} details
   */
  rememberRequest({ id, url }) {
    if (!this.urls.has(id)) this.urls.set(id, url)
  }

  /** @param {{id: number}} details */
  forgetRequest({ id }) {
    this.urls.delete(id)
  }

  /** @param {{id: number, error: string, webContentsId?: number}} details */
  recordError({ id, error, webContentsId }, now = Date.now()) {
    const url = this.urls.get(id)
    this.urls.delete(id)
    if (url === undefined || webContentsId === undefined) return
    for (const [key, entry] of this.errors) {
      if (entry.expiresAt <= now) this.errors.delete(key)
    }
    this.errors.set(`${webContentsId} ${url}`, { error, expiresAt: now + ERROR_LIFETIME_MS })
  }

  /**
   * @param {number} webContentsId
   * @param {string} url
   * @returns {string | null}
   */
  getError(webContentsId, url, now = Date.now()) {
    const entry = this.errors.get(`${webContentsId} ${url}`)
    return entry && entry.expiresAt > now ? entry.error : null
  }
}
