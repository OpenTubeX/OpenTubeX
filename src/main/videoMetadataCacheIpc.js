import { IpcChannels } from '../constants.js'
import { isNonPublicNetworkAddress, isValidVideoId } from './utils.js'

/**
 * @typedef {{ videoId: string, thumbnailUrl?: string }} VideoMetadataCachePayload
 * @typedef {{ senderFrame: { url: string } }} TrustedFrameEvent
 */

/**
 * Register the main-process metadata cache boundary. Network and cache dependencies
 * are injected so thumbnail trust checks and cache invalidation can be tested.
 *
 * @param {object} dependencies
 * @param {{ handle: (channel: string, handler: (...args: unknown[]) => unknown) => void }} dependencies.ipcMain
 * @param {(url: string) => boolean} dependencies.isTrustedUrl
 * @param {(hostname: string, options: object) => Promise<{endpoints: Array<{address: string}>}>} dependencies.resolveHost
 * @param {(url: string, options: object) => Promise<Response>} dependencies.fetch
 * @param {() => Promise<string | null | undefined>} dependencies.getDefaultInvidiousInstance
 * @param {(metadata: object) => Promise<unknown>} dependencies.updateCache
 * @param {() => Promise<unknown>} dependencies.clearCache
 * @param {() => Promise<number>} dependencies.getCacheSize
 * @param {() => Array<{webContents: {isDestroyed: () => boolean, getURL: () => string, send: (channel: string) => void}}>} dependencies.getWindows
 */
export function registerVideoMetadataCacheIpc({
  ipcMain,
  isTrustedUrl,
  resolveHost,
  fetch,
  getDefaultInvidiousInstance,
  updateCache,
  clearCache,
  getCacheSize,
  getWindows
}) {
  const MAX_VIDEO_METADATA_THUMBNAIL_BYTES = 5 * 1024 * 1024
  const MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS = 3
  const VIDEO_METADATA_THUMBNAIL_MIME_TYPES = new Set([
    'image/avif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ])
  let videoMetadataCacheGeneration = 0

  async function isAllowedVideoMetadataThumbnailUrl(parsedUrl, allowedPrivateOrigin) {
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return false
    if (parsedUrl.origin === allowedPrivateOrigin) return true

    const hostname = parsedUrl.hostname.startsWith('[') && parsedUrl.hostname.endsWith(']')
      ? parsedUrl.hostname.slice(1, -1)
      : parsedUrl.hostname

    try {
      const { endpoints } = await resolveHost(hostname, {
        cacheUsage: 'disallowed'
      })
      return endpoints.length > 0 && endpoints.every(({ address }) => !isNonPublicNetworkAddress(address))
    } catch {
      return false
    }
  }

  async function fetchVideoMetadataThumbnail(url) {
    if (typeof url !== 'string' || url.length > 20_000) return null

    let parsedUrl
    try {
      parsedUrl = new URL(url)
    } catch {
      return null
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null

    let allowedPrivateOrigin = null
    try {
      const configuredInstance = await getDefaultInvidiousInstance()
      if (typeof configuredInstance === 'string' && configuredInstance !== '') {
        allowedPrivateOrigin = new URL(configuredInstance).origin
      }
    } catch { }

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 15_000)

    try {
      let response

      for (let redirectCount = 0; redirectCount <= MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS; redirectCount += 1) {
        if (!await isAllowedVideoMetadataThumbnailUrl(parsedUrl, allowedPrivateOrigin)) return null

        response = await fetch(parsedUrl.href, {
          // Thumbnail replacements often keep the same URL. Comparing a cached
          // response would hide the change until its HTTP cache entry expires.
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'manual',
          signal: abortController.signal
        })

        if (response.status < 300 || response.status >= 400) break
        if (redirectCount === MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS) return null

        const location = response.headers.get('location')
        if (location === null) return null

        await response.body?.cancel()
        parsedUrl = new URL(location, parsedUrl)
        if (parsedUrl.href.length > 20_000) return null
      }

      if (!response) return null
      const mimeType = response.headers.get('content-type')?.split(';', 1)[0].toLowerCase()
      const contentLength = Number(response.headers.get('content-length'))

      if (
        !response.ok ||
        !VIDEO_METADATA_THUMBNAIL_MIME_TYPES.has(mimeType) ||
        (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_METADATA_THUMBNAIL_BYTES) ||
        !response.body
      ) {
        return null
      }

      const chunks = []
      let byteLength = 0
      const reader = response.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        byteLength += value.byteLength
        if (byteLength > MAX_VIDEO_METADATA_THUMBNAIL_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(Buffer.from(value))
      }

      return `data:${mimeType};base64,${Buffer.concat(chunks).toString('base64')}`
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Could not cache the video thumbnail', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_UPDATE, async (/** @type {TrustedFrameEvent} */ event, /** @type {VideoMetadataCachePayload} */ metadata) => {
    if (!isTrustedUrl(event.senderFrame.url) || !isValidVideoId(metadata?.videoId)) {
      return null
    }

    const generation = videoMetadataCacheGeneration
    const thumbnail = await fetchVideoMetadataThumbnail(metadata.thumbnailUrl)
    if (generation !== videoMetadataCacheGeneration) return null

    return updateCache({ ...metadata, thumbnail })
  })

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_CLEAR, async (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return false

    videoMetadataCacheGeneration += 1
    await clearCache()
    for (const window of getWindows()) {
      if (!window.webContents.isDestroyed() && isTrustedUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.VIDEO_METADATA_CACHE_CLEARED)
      }
    }
    return true
  })

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_GET_SIZE, async (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return 0
    return getCacheSize()
  })
}
