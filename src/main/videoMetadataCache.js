import { app, BrowserWindow, ipcMain, net, session } from 'electron'
import { stat } from 'node:fs/promises'

import { IpcChannels } from '../constants'
import { videoMetadataCache } from '../datastores'
import { desktopDatastorePaths } from '../datastores/sqliteNode'
import { isNonPublicNetworkAddress, isOpenTubeXUrl } from './utils'
const MAX_TITLE_LENGTH = 10_000
const MAX_DESCRIPTION_LENGTH = 1_000_000
const MAX_THUMBNAIL_DATA_URL_LENGTH = 8_000_000

let pendingOperation = Promise.resolve()

function enqueue(operation) {
  const result = pendingOperation.then(operation, operation)
  pendingOperation = result.catch(() => {})
  return result
}

function normalizeText(value, maximumLength) {
  return typeof value === 'string' ? value.slice(0, maximumLength) : ''
}

function normalizeThumbnailDataUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_THUMBNAIL_DATA_URL_LENGTH ||
    !/^data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/i.test(value)
  ) {
    return null
  }

  return value
}

function thumbnailChanged(previous, current) {
  if (previous.thumbnail && current.thumbnail) {
    return previous.thumbnail !== current.thumbnail
  }

  return previous.thumbnailUrl !== current.thumbnailUrl
}

function compareRevisions(previous, current) {
  const changedFields = []

  if (previous.title !== current.title) changedFields.push('title')
  if (thumbnailChanged(previous, current)) changedFields.push('thumbnail')
  if (previous.description !== current.description) changedFields.push('description')

  return changedFields
}

function findThumbnailRevisionIndex(revisions, index) {
  for (let revisionIndex = index; revisionIndex >= 0; revisionIndex -= 1) {
    if (revisions[revisionIndex].hasThumbnailChange) return revisionIndex
  }

  return -1
}

function materializeRevision(revisions, index) {
  const revision = revisions[index]
  const thumbnailRevisionIndex = findThumbnailRevisionIndex(revisions, index)
  const thumbnail = thumbnailRevisionIndex === -1
    ? null
    : revisions[thumbnailRevisionIndex].thumbnail

  return { ...revision, thumbnail }
}

function createMetadataHistory(revisions) {
  if (revisions.length < 2) return null

  const previous = materializeRevision(revisions, revisions.length - 2)
  const current = materializeRevision(revisions, revisions.length - 1)
  const changedFields = compareRevisions(previous, current)

  return changedFields.length === 0 ? null : { revisions }
}

/**
 * Keeps every distinct metadata revision for a video. The current thumbnail
 * bytes are supplied by the main process so a replacement is detected even when
 * YouTube reuses the same thumbnail URL.
 *
 * @param {{ videoId: string, title: string, description: string, thumbnailUrl: string, thumbnail: string | null, observedAt?: number }} input
 */
export function updateVideoMetadataCache(input) {
  return enqueue(async () => {
    if (typeof input?.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId)) {
      throw new TypeError('Invalid video ID')
    }

    const revisions = await videoMetadataCache
      .findAsync({ videoId: input.videoId, cachedAt: { $exists: true } })
      .sort({ cachedAt: 1 })
    const previous = revisions.length > 0
      ? materializeRevision(revisions, revisions.length - 1)
      : null
    const thumbnailUrl = normalizeText(input.thumbnailUrl, 20_000)
    let thumbnail = normalizeThumbnailDataUrl(input.thumbnail)

    // A temporary thumbnail request failure must not look like a thumbnail edit.
    if (!thumbnail && previous && (!thumbnailUrl || thumbnailUrl === previous.thumbnailUrl)) {
      thumbnail = previous.thumbnail
    }

    const current = {
      title: normalizeText(input.title, MAX_TITLE_LENGTH),
      description: normalizeText(input.description, MAX_DESCRIPTION_LENGTH),
      thumbnailUrl,
      thumbnail,
      cachedAt: Number.isSafeInteger(input.observedAt) && input.observedAt > 0
        ? Math.min(input.observedAt, Date.now())
        : Date.now()
    }

    if (!current.title) return null

    // If an earlier request detected a new thumbnail URL but could not download
    // its bytes, fill that gap later without inventing another metadata revision.
    if (previous && !previous.thumbnail && thumbnail && previous.thumbnailUrl === thumbnailUrl) {
      const thumbnailRevisionIndex = findThumbnailRevisionIndex(revisions, revisions.length - 1)
      if (thumbnailRevisionIndex !== -1) {
        const thumbnailRevision = revisions[thumbnailRevisionIndex]
        await videoMetadataCache.updateAsync(
          { _id: thumbnailRevision._id },
          { $set: { thumbnail } }
        )
        thumbnailRevision.thumbnail = thumbnail
        previous.thumbnail = thumbnail
      }
    }

    // Concurrent tabs may finish fetching the thumbnail out of order. Do not
    // let an older observation replace a newer revision that already won.
    if (previous?.cachedAt > current.cachedAt) {
      return createMetadataHistory(revisions)
    }

    if (!previous) {
      await videoMetadataCache.insertAsync({
        videoId: input.videoId,
        ...current,
        hasThumbnailChange: true
      })
      return null
    }

    const changedFields = compareRevisions(previous, current)
    if (changedFields.length > 0) {
      const storedRevision = await videoMetadataCache.insertAsync({
        videoId: input.videoId,
        ...current,
        // Thumbnail bytes are by far the largest part of the cache. A title- or
        // description-only revision inherits the preceding image instead of
        // storing an identical base64 copy.
        thumbnail: changedFields.includes('thumbnail') ? current.thumbnail : null,
        hasThumbnailChange: changedFields.includes('thumbnail')
      })
      revisions.push(storedRevision)
    }

    return createMetadataHistory(revisions)
  })
}

export async function getVideoMetadataCacheSize() {
  // A linked legacy file keeps the cache beside its target. The legacy file
  // itself stays until the cache is cleared.
  const { filename, legacy } = desktopDatastorePaths(app.getPath('userData'), 'video-metadata-cache')
  const sizes = await Promise.all([filename, `${filename}-wal`, `${filename}-shm`, legacy].map(async path => {
    try {
      return (await stat(path)).size
    } catch (error) {
      if (error?.code === 'ENOENT') return 0
      throw error
    }
  }))
  return sizes.reduce((total, size) => total + size, 0)
}

export function clearVideoMetadataCache() {
  return enqueue(async () => {
    await videoMetadataCache.dropDatabaseAsync()
  })
}

const MAX_VIDEO_METADATA_THUMBNAIL_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS = 3
const VIDEO_METADATA_THUMBNAIL_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])

async function isAllowedNetworkMediaUrl(parsedUrl, allowedPrivateOrigin) {
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return false
  if (parsedUrl.origin === allowedPrivateOrigin) return true

  const hostname = parsedUrl.hostname.startsWith('[') && parsedUrl.hostname.endsWith(']')
    ? parsedUrl.hostname.slice(1, -1)
    : parsedUrl.hostname

  try {
    const { endpoints } = await session.defaultSession.resolveHost(hostname, {
      cacheUsage: 'disallowed'
    })
    return endpoints.length > 0 && endpoints.every(({ address }) => !isNonPublicNetworkAddress(address))
  } catch {
    return false
  }
}

/**
 * The main process downloads the thumbnails for the cache, so that private
 * addresses other than the configured API server stay out of reach.
 * @param {object} options
 * @param {() => Promise<string | undefined>} options.getConfiguredApiServerUrl
 */
export function setupVideoMetadataCacheIpc({ getConfiguredApiServerUrl }) {
  const isValidVideoId = videoId => typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId)
  let videoMetadataCacheGeneration = 0

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
      const configuredInstance = await getConfiguredApiServerUrl()
      if (typeof configuredInstance === 'string' && configuredInstance !== '') {
        allowedPrivateOrigin = new URL(configuredInstance).origin
      }
    } catch { }

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 15_000)

    try {
      let response

      for (let redirectCount = 0; redirectCount <= MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS; redirectCount += 1) {
        if (!await isAllowedNetworkMediaUrl(parsedUrl, allowedPrivateOrigin)) return null

        response = await net.fetch(parsedUrl.href, {
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

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_UPDATE, async (event, metadata) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !isValidVideoId(metadata?.videoId)) {
      return null
    }

    const generation = videoMetadataCacheGeneration
    const thumbnail = await fetchVideoMetadataThumbnail(metadata.thumbnailUrl)
    if (generation !== videoMetadataCacheGeneration) return null

    return updateVideoMetadataCache({ ...metadata, thumbnail })
  })

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_CLEAR, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return false

    videoMetadataCacheGeneration += 1
    await clearVideoMetadataCache()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.VIDEO_METADATA_CACHE_CLEARED)
      }
    }
    return true
  })

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_GET_SIZE, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return 0
    return getVideoMetadataCacheSize()
  })
}
