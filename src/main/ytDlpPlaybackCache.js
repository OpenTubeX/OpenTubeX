import { app } from 'electron'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { TabManager } from './tabs/TabManager'
import { isOpenTubeXUrl } from './utils'

const CACHE_FILENAME = 'yt-dlp-playback-cache.json'
const MAX_ENTRIES = 50
const EXPIRY_MARGIN_MS = 2 * 60 * 1000
const MAX_ENTRY_LENGTH = 2_000_000
const MAX_CACHE_KEY_LENGTH = 20_000
const VIDEO_ID_REGEX = /^[\w-]{11}$/
const CACHE_KEY_HASH_REGEX = /^[a-f\d]{64}$/

/** @type {Map<string, YtDlpPlaybackCacheEntry>} */
const entries = new Map()
let loadPromise = null
let writeQueue = Promise.resolve()

/**
 * @typedef {object} YtDlpPlaybackCacheEntry
 * @property {string} videoId
 * @property {string} cacheKeyHash
 * @property {number} expiryTime
 * @property {object} source
 */

function cachePath() {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

function hashCacheKey(cacheKey) {
  return createHash('sha256').update(cacheKey).digest('hex')
}

function isValidCacheKey(cacheKey) {
  return typeof cacheKey === 'string' && cacheKey.length <= MAX_CACHE_KEY_LENGTH
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false

  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isValidEntry(entry) {
  if (entry === null || typeof entry !== 'object') return false

  let serializedEntry
  try {
    serializedEntry = JSON.stringify(entry)
  } catch {
    return false
  }

  const source = entry.source
  const legacyFormats = source?.legacyFormats
  const hasDashManifest = source?.manifestMimeType === 'application/dash+xml' &&
    typeof source.manifestSrc === 'string' &&
    source.manifestSrc.startsWith('data:application/dash+xml;')
  const hasHlsManifest = source?.manifestMimeType === 'application/x-mpegurl' &&
    isHttpsUrl(source.manifestSrc)
  const hasLegacyFormatsOnly = source?.manifestMimeType === 'application/dash+xml' &&
    source.manifestSrc === null &&
    Array.isArray(legacyFormats) &&
    legacyFormats.length > 0 &&
    legacyFormats.every(format => isHttpsUrl(format?.url))

  return Buffer.byteLength(serializedEntry, 'utf8') <= MAX_ENTRY_LENGTH &&
    VIDEO_ID_REGEX.test(entry.videoId) &&
    CACHE_KEY_HASH_REGEX.test(entry.cacheKeyHash) &&
    Number.isFinite(entry.expiryTime) &&
    source !== null &&
    typeof source === 'object' &&
    source.isLive === false &&
    (hasDashManifest || hasHlsManifest || hasLegacyFormatsOnly) &&
    Array.isArray(legacyFormats) &&
    (source.title === null || typeof source.title === 'string')
}

async function loadEntries() {
  if (loadPromise === null) {
    loadPromise = (async () => {
      try {
        const storedEntries = JSON.parse(await readFile(cachePath(), 'utf8'))
        if (!Array.isArray(storedEntries)) return

        for (const entry of storedEntries.slice(-MAX_ENTRIES)) {
          if (isValidEntry(entry) && Date.now() < entry.expiryTime - EXPIRY_MARGIN_MS) {
            entries.set(entry.videoId, entry)
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('Could not load the yt-dlp playback cache', error)
        }
      }
    })()
  }
  await loadPromise
}

function saveEntries() {
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const path = cachePath()
      const temporaryPath = `${path}.tmp`
      await writeFile(temporaryPath, JSON.stringify([...entries.values()]), 'utf8')
      await rename(temporaryPath, path)
    })
  return writeQueue
}

export async function handleYtDlpPlaybackCacheGet(event, videoId, cacheKey) {
  if (
    !isOpenTubeXUrl(event.senderFrame.url) ||
    !VIDEO_ID_REGEX.test(videoId) ||
    !isValidCacheKey(cacheKey)
  ) return null

  await loadEntries()
  const entry = entries.get(videoId)
  if (entry === undefined) return null

  if (
    entry.cacheKeyHash !== hashCacheKey(cacheKey) ||
    Date.now() >= entry.expiryTime - EXPIRY_MARGIN_MS
  ) {
    entries.delete(videoId)
    await saveEntries()
    return null
  }

  return { expiryTime: entry.expiryTime, source: entry.source }
}

export async function handleYtDlpPlaybackCacheSet(event, videoId, cacheKey, expiryTime, source) {
  if (
    !isOpenTubeXUrl(event.senderFrame.url) ||
    !VIDEO_ID_REGEX.test(videoId) ||
    !isValidCacheKey(cacheKey)
  ) return false

  const entry = {
    videoId,
    cacheKeyHash: hashCacheKey(cacheKey),
    expiryTime,
    source: source === null || typeof source !== 'object'
      ? source
      : {
          manifestSrc: source.manifestSrc,
          manifestMimeType: source.manifestMimeType,
          legacyFormats: source.legacyFormats,
          title: source.title,
          isLive: source.isLive,
          version: source.version
        }
  }

  if (!isValidEntry(entry)) return false
  if (Date.now() >= entry.expiryTime - EXPIRY_MARGIN_MS) return false

  await loadEntries()
  entries.delete(entry.videoId)
  const openVideoIds = TabManager.getOpenVideoIds()
  while (entries.size >= MAX_ENTRIES) {
    const videoId = Array.from(entries.keys()).find(videoId => !openVideoIds.has(videoId)) ?? entries.keys().next().value
    entries.delete(videoId)
  }
  entries.set(entry.videoId, entry)
  await saveEntries()
  return true
}

export async function handleYtDlpPlaybackCacheDelete(event, videoId) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !VIDEO_ID_REGEX.test(videoId)) return false

  await loadEntries()
  if (entries.delete(videoId)) await saveEntries()
  return true
}

export async function handleYtDlpPlaybackCacheClear(event) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) return false

  await clearYtDlpPlaybackCache()
  return true
}

export async function clearYtDlpPlaybackCache() {
  await loadEntries()
  entries.clear()
  writeQueue = writeQueue
    .catch(() => {})
    .then(() => Promise.all([
      rm(cachePath(), { force: true }),
      rm(`${cachePath()}.tmp`, { force: true })
    ]))
  await writeQueue
}
