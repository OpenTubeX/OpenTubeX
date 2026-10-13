import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from 'fflate'
import model from '@seald-io/nedb/lib/model.js'

export const BACKUP_SECTIONS = ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'watchStats']
const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024
const MAX_ENTRY_SIZE = 256 * 1024 * 1024
const MAX_TOTAL_SIZE = 256 * 1024 * 1024

/**
 * Appends legacy channels while preserving every saved occurrence. Rejects
 * scalar conflicts rather than reinterpret their stored shape.
 * @param {unknown} previous
 * @param {unknown[]} incoming
 * @returns {unknown}
 */
export function mergeLegacySubscriptionChannels(previous, incoming) {
  if (!Array.isArray(incoming)) throw new TypeError('Invalid imported subscriptions')
  if (incoming.length === 0) return previous
  if (previous !== undefined && !Array.isArray(previous)) throw new Error('Cannot merge incompatible profile subscriptions')
  const channels = previous === undefined ? [] : previous.slice()
  const identified = channel => channel !== null && typeof channel === 'object' && !Array.isArray(channel) && typeof channel.id === 'string' && channel.id.length > 0
  const ids = new Set(channels.filter(identified).map(channel => channel.id))
  for (const channel of incoming) {
    if (identified(channel)) {
      if (ids.has(channel.id)) continue
      ids.add(channel.id)
    }
    channels.push(channel)
  }
  return channels
}

export function mergeBackupProfile(current, imported) {
  if (!current) return imported
  if (!Array.isArray(current.subscriptions) || !Array.isArray(imported.subscriptions)) {
    const hasSubscriptions = Object.hasOwn(current, 'subscriptions')
    if (hasSubscriptions !== Object.hasOwn(imported, 'subscriptions') ||
      (hasSubscriptions && !model.areThingsEqual(current.subscriptions, imported.subscriptions))) throw new Error('Cannot merge incompatible profile subscriptions')
    return { ...current, ...imported }
  }
  const subscriptions = [...current.subscriptions]
  const identified = channel => channel !== null && typeof channel === 'object' && !Array.isArray(channel) && typeof channel.id === 'string'
  const key = channel => identified(channel) ? `id:${channel.id}` : `value:${model.serialize(channel)}`
  const positions = new Map()
  for (let index = subscriptions.length - 1; index >= 0; index--) {
    const identity = key(subscriptions[index])
    if (!positions.has(identity)) positions.set(identity, [])
    positions.get(identity).push(index)
  }
  for (const channel of imported.subscriptions) {
    const index = positions.get(key(channel))?.pop()
    if (index === undefined) subscriptions.push(channel)
    else if (identified(channel)) subscriptions[index] = { ...subscriptions[index], ...channel }
  }
  return { ...current, ...imported, subscriptions }
}

export function mergeBackupPlaylist(current, imported) {
  if (!current) return imported
  if (!Array.isArray(current.videos) || !Array.isArray(imported.videos)) {
    // Legacy scalar fields cannot be combined with a different membership
    // shape without discarding data. Identical retained fields remain idempotent.
    const hasVideos = Object.hasOwn(current, 'videos')
    if (hasVideos !== Object.hasOwn(imported, 'videos') ||
      (hasVideos && !model.areThingsEqual(current.videos, imported.videos))) {
      throw new Error('Cannot merge incompatible playlist videos')
    }
    return { ...current, ...imported, protected: current.protected }
  }
  const videos = [...current.videos]
  const itemKey = video => model.serialize({ playlistItemId: video.playlistItemId, videoId: video.videoId })
  const timeKey = video => model.serialize({ videoId: video.videoId, timeAdded: video.timeAdded })
  const structuredMember = video => video !== null && typeof video === 'object' && !Array.isArray(video) && !(video instanceof Date)
  const byItem = new Map()
  const byTime = new Map()
  const byValue = new Map()
  const add = (map, key, index) => {
    const positions = map.get(key)
    if (positions) positions.push(index)
    else map.set(key, [index])
  }
  // Consume each saved occurrence once. Imports without membership IDs,
  // including Takeout CSV, still match saved members by video and timestamp.
  for (let index = current.videos.length - 1; index >= 0; index--) {
    const video = current.videos[index]
    if (!structuredMember(video)) { add(byValue, model.serialize(video), index); continue }
    if (video.playlistItemId != null) add(byItem, itemKey(video), index)
    add(byTime, timeKey(video), index)
  }
  const matched = new Set()
  const consume = positions => {
    while (positions?.length && matched.has(positions.at(-1))) positions.pop()
    if (!positions?.length) return false
    matched.add(positions.pop())
    return true
  }
  const matchedItems = new Set()
  imported.videos.forEach((video, index) => {
    if (structuredMember(video) && video.playlistItemId != null && consume(byItem.get(itemKey(video)))) matchedItems.add(index)
  })
  imported.videos.forEach((video, index) => {
    if (matchedItems.has(index)) return
    if (!structuredMember(video)) {
      if (!consume(byValue.get(model.serialize(video)))) videos.push(video)
      return
    }
    if (video.playlistItemId == null && consume(byTime.get(timeKey(video)))) return
    videos.push(video)
  })
  return { ...current, ...imported, protected: current.protected, videos }
}

export function mergeBackupHistoryRecord(current, imported) {
  if (!current) return imported
  const newer = model.compareThings(imported.timeWatched, current.timeWatched) > 0 ? imported : current
  // Keep the greatest valid progress from either side. If neither is valid,
  // preserve the selected legacy value without coercing it.
  const progress = [current.watchProgress, imported.watchProgress].filter(value => Number.isFinite(value) && value >= 0)
  return {
    ...current,
    ...imported,
    ...newer,
    timeWatched: newer.timeWatched,
    ...(progress.length
      ? { watchProgress: Math.max(...progress) }
      : {}),
    isWatched: current.isWatched === true || imported.isWatched === true,
  }
}

export function mergeBackupHistory(current, imported) {
  const records = new Map(current.map((record, index) => [index, record]))
  const byId = new Map(current.flatMap((record, index) => typeof record._id === 'string' ? [[record._id, index]] : []))
  for (const record of imported) {
    const index = typeof record._id === 'string' ? byId.get(record._id) : undefined
    if (index !== undefined) records.set(index, mergeBackupHistoryRecord(records.get(index), record))
    else {
      const next = records.size
      records.set(next, record)
      if (typeof record._id === 'string') byId.set(record._id, next)
    }
  }
  return records
}

export function mergeBackupWatchStatsRecord(current, imported) {
  return !current || imported.seconds > current.seconds ? imported : current
}

export function mergeBackupWatchStatsAdjustment(currentRecords, currentAdjustment, importedRecords, importedAdjustment) {
  const retained = value => value !== null && (typeof value !== 'object' || Array.isArray(value) || value instanceof Date)
  if (retained(currentAdjustment) || retained(importedAdjustment)) {
    if (currentAdjustment === null) return importedAdjustment
    if (importedAdjustment === null || model.serialize(currentAdjustment) === model.serialize(importedAdjustment)) return currentAdjustment
    throw new Error('Conflicting retained watch-stat adjustments')
  }
  const hasEstimate = records => records.some(record => record.historyEstimateApplied === true)
  if (!hasEstimate(importedRecords)) return currentAdjustment
  if (hasEstimate(currentRecords) && currentAdjustment?.defaultSpeed !== importedAdjustment?.defaultSpeed) return null
  return importedAdjustment
}

export function encodeBackupValue(value) {
  return JSON.stringify(value, function (key, value) {
    if (this[key] instanceof Date) return { $$date: this[key].getTime() }
    if (value && !Array.isArray(value) && (Object.hasOwn(value, '$$date') || Object.hasOwn(value, '$$backupObject'))) return { $$backupObject: Object.entries(value) }
    return value
  })
}

export function decodeBackupValue(value) {
  return JSON.parse(value, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1) {
      if (Object.hasOwn(value, '$$date')) return new Date(value.$$date === null ? NaN : value.$$date)
      if (Object.hasOwn(value, '$$backupObject')) return Object.fromEntries(value.$$backupObject)
    }
    return value
  })
}

export function createUnifiedBackup(data) {
  const sections = BACKUP_SECTIONS.filter(section => Object.hasOwn(data, section))
  if (sections.length === 0) throw new Error('No backup sections selected')
  const files = {
    'manifest.json': strToU8(JSON.stringify({ format: 'opentubex-backup', version: 1, encoding: 'opentubex-json-v1', createdAt: new Date().toISOString(), sections }))
  }
  let totalSize = files['manifest.json'].length
  for (const section of sections) {
    files[`${section}.json`] = strToU8(encodeBackupValue(data[section]))
    if (files[`${section}.json`].length > MAX_ENTRY_SIZE) throw new Error('Backup entry is too large')
    totalSize += files[`${section}.json`].length
    if (totalSize > MAX_TOTAL_SIZE) throw new Error('Backup data is too large')
  }
  const archive = zipSync(files, { level: 6 })
  if (archive.length > MAX_ARCHIVE_SIZE) throw new Error('Backup archive is too large')
  return new Blob([archive], { type: 'application/zip' })
}

export async function readUnifiedBackup(file) {
  if (file.size > MAX_ARCHIVE_SIZE) throw new Error('Backup archive is too large')
  const entries = new Map()
  let failure
  let totalSize = 0
  const unzip = new Unzip(entry => {
    if (entries.has(entry.name) || entry.originalSize > MAX_ENTRY_SIZE || totalSize + entry.originalSize > MAX_TOTAL_SIZE) {
      failure = new Error('Invalid backup archive')
      return
    }
    const chunks = []
    let size = 0
    entry.ondata = (error, chunk, final) => {
      if (error) { failure = error; return }
      size += chunk.length
      if (size > MAX_ENTRY_SIZE) { failure = new Error('Backup entry is too large'); return }
      totalSize += chunk.length
      if (totalSize > MAX_TOTAL_SIZE) { failure = new Error('Backup data is too large'); return }
      chunks.push(chunk)
      if (final) {
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const part of chunks) { bytes.set(part, offset); offset += part.length }
        entries.set(entry.name, bytes)
      }
    }
    entry.start()
  })
  unzip.register(UnzipInflate)
  const reader = file.stream().getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      unzip.push(value)
      if (failure) throw failure
    }
    unzip.push(new Uint8Array(0), true)
    if (failure) throw failure
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  if (!entries.has('manifest.json')) throw new Error('Backup archive has missing or unexpected files')
  const manifest = JSON.parse(strFromU8(entries.get('manifest.json')))
  if (manifest.encoding !== undefined && manifest.encoding !== 'opentubex-json-v1') throw new Error('Unsupported backup encoding')
  const parse = name => (manifest.encoding ? decodeBackupValue : JSON.parse)(strFromU8(entries.get(name)))
  if (manifest?.format !== 'opentubex-backup' || manifest.version !== 1) {
    throw new Error('Unsupported backup version')
  }
  const sections = manifest.sections ?? BACKUP_SECTIONS
  if (!Array.isArray(sections) || sections.length === 0 || new Set(sections).size !== sections.length || sections.some(section => !BACKUP_SECTIONS.includes(section))) {
    throw new Error('Invalid backup sections')
  }
  const expected = new Set(['manifest.json', ...sections.map(section => `${section}.json`)])
  if (entries.size !== expected.size || [...entries.keys()].some(name => !expected.has(name))) {
    throw new Error('Backup archive has missing or unexpected files')
  }
  const data = Object.fromEntries(sections.map(section => [section, parse(`${section}.json`)]))
  validateUnifiedBackup(data)
  return { manifest, data }
}

export function isBackupWatchStatsDay(record) {
  return typeof record?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date) && Number.isFinite(record.seconds) && record.seconds >= 0
}

export function validateBackupWatchStats(backup) {
  const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  if (!plainObject(backup) || !Array.isArray(backup.records) ||
    !backup.records.every(record => plainObject(record) && (isBackupWatchStatsDay(record) || (typeof record._id === 'string' && Object.hasOwn(record, 'date')))) ||
    !Object.hasOwn(backup, 'adjustment')) {
    throw new Error('Invalid backup watchStats')
  }
}

export function validateUnifiedBackup(data) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (Object.hasOwn(data, 'settings') && (!object(data.settings) || Object.keys(data.settings).some(key => key === '__proto__'))) throw new Error('Invalid backup settings')
  const sections = {
    // Migration retains names and membership fields, including missing or opaque values.
    profiles: record => object(record) && typeof record._id === 'string',
    // Migration retains opaque members, scalar videos fields and missing
    // videos fields. Their generated backups must remain restorable unchanged.
    playlists: record => object(record) && typeof record._id === 'string',
    // Migration retains legacy timestamp values. Restoring a generated backup
    // must preserve those values, progress and non-string video identities.
    history: record => object(record) && (typeof record.videoId === 'string' || typeof record._id === 'string') && (typeof record.timeWatched !== 'number' || Number.isFinite(record.timeWatched)) && (typeof record.watchProgress !== 'number' || Number.isFinite(record.watchProgress)),
    // Released search-history readers use _id when query is absent or non-string.
    searchHistory: record => object(record) && typeof record._id === 'string',
  }
  for (const [section, valid] of Object.entries(sections)) {
    if (Object.hasOwn(data, section) && (!Array.isArray(data[section]) || !data[section].every(valid))) throw new Error(`Invalid backup ${section}`)
  }
  if (Object.hasOwn(data, 'watchStats')) validateBackupWatchStats(data.watchStats)
}
