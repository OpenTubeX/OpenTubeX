import { app } from 'electron'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { videoMetadataCache } from '../datastores'

const CACHE_FILE_NAME = 'video-metadata-cache.db'
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
  try {
    return (await stat(join(app.getPath('userData'), CACHE_FILE_NAME))).size
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

export function clearVideoMetadataCache() {
  return enqueue(async () => {
    await videoMetadataCache.removeAsync({}, { multi: true })
    await videoMetadataCache.compactDatafileAsync()
  })
}
