import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from 'fflate'

export const BACKUP_SECTIONS = ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'watchStats']
const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024
const MAX_ENTRY_SIZE = 256 * 1024 * 1024
const MAX_TOTAL_SIZE = 256 * 1024 * 1024

export function mergeBackupProfile(current, imported) {
  if (!current) return imported
  const subscriptions = new Map(current.subscriptions.map(channel => [channel.id, channel]))
  for (const channel of imported.subscriptions) subscriptions.set(channel.id, channel)
  return { ...current, ...imported, subscriptions: [...subscriptions.values()] }
}

export function mergeBackupPlaylist(current, imported) {
  if (!current) return imported
  const videos = [...current.videos]
  for (const video of imported.videos) {
    const exists = videos.some(saved => video.playlistItemId != null
      ? saved.playlistItemId === video.playlistItemId
      : saved.videoId === video.videoId && saved.timeAdded === video.timeAdded)
    if (!exists) videos.push(video)
  }
  return { ...current, ...imported, videos }
}

export function mergeBackupHistoryRecord(current, imported) {
  if (!current) return imported
  const newer = imported.timeWatched > current.timeWatched ? imported : current
  return {
    ...newer,
    timeWatched: Math.max(current.timeWatched, imported.timeWatched),
    watchProgress: Math.max(current.watchProgress ?? 0, imported.watchProgress ?? 0),
    isWatched: current.isWatched === true || imported.isWatched === true,
  }
}

export function mergeBackupWatchStatsRecord(current, imported) {
  return !current || imported.seconds > current.seconds ? imported : current
}

export function mergeBackupWatchStatsAdjustment(currentRecords, currentAdjustment, importedRecords, importedAdjustment) {
  const hasEstimate = records => records.some(record => record.historyEstimateApplied === true)
  if (!hasEstimate(importedRecords)) return currentAdjustment
  if (hasEstimate(currentRecords) && currentAdjustment?.defaultSpeed !== importedAdjustment?.defaultSpeed) return null
  return importedAdjustment
}

export function createUnifiedBackup(data) {
  const files = {
    'manifest.json': strToU8(JSON.stringify({ format: 'opentubex-backup', version: 1, createdAt: new Date().toISOString() }))
  }
  let totalSize = files['manifest.json'].length
  for (const section of BACKUP_SECTIONS) {
    files[`${section}.json`] = strToU8(JSON.stringify(data[section]))
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

  const expected = new Set(['manifest.json', ...BACKUP_SECTIONS.map(section => `${section}.json`)])
  if (entries.size !== expected.size || [...entries.keys()].some(name => !expected.has(name))) {
    throw new Error('Backup archive has missing or unexpected files')
  }
  const parse = name => JSON.parse(strFromU8(entries.get(name)))
  const manifest = parse('manifest.json')
  if (manifest?.format !== 'opentubex-backup' || manifest.version !== 1) {
    throw new Error('Unsupported backup version')
  }
  const data = Object.fromEntries(BACKUP_SECTIONS.map(section => [section, parse(`${section}.json`)]))
  validateUnifiedBackup(data)
  return { manifest, data }
}

export function validateUnifiedBackup(data) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!object(data.settings) || Object.keys(data.settings).some(key => key === '__proto__')) throw new Error('Invalid backup settings')
  const sections = {
    profiles: record => object(record) && typeof record._id === 'string' && (typeof record.name === 'string' || record.name === null) && Array.isArray(record.subscriptions) && record.subscriptions.every(channel => object(channel) && typeof channel.id === 'string'),
    playlists: record => object(record) && typeof record._id === 'string' && typeof record.playlistName === 'string' && Array.isArray(record.videos) && record.videos.every(video => object(video) && typeof video.videoId === 'string'),
    history: record => object(record) && typeof record.videoId === 'string' && Number.isFinite(record.timeWatched) && record.timeWatched >= 0 && (record.watchProgress === undefined || (Number.isFinite(record.watchProgress) && record.watchProgress >= 0)),
    searchHistory: record => object(record) && typeof record._id === 'string' && typeof record.query === 'string',
    watchStats: record => object(record) && /^\d{4}-\d{2}-\d{2}$/.test(record.date) && Number.isFinite(record.seconds) && record.seconds >= 0,
  }
  for (const [section, valid] of Object.entries(sections)) {
    if (section === 'watchStats') continue
    if (!Array.isArray(data[section]) || !data[section].every(valid)) throw new Error(`Invalid backup ${section}`)
  }
  if (!object(data.watchStats) || !Array.isArray(data.watchStats.records) ||
    !data.watchStats.records.every(sections.watchStats) ||
    (data.watchStats.adjustment !== null && !object(data.watchStats.adjustment))) {
    throw new Error('Invalid backup watchStats')
  }
}
