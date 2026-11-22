import { MAIN_PROFILE_ID } from '../../constants.js'
import { PLAYLIST_PREFERENCE_TIMESTAMP_KEYS, stampPlaylistPreferenceEdits } from './playlist-preferences-sync.js'
import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from 'fflate'
import { isValidSeparateProfileId } from '../../datastores/profileDatastoreNames.js'

export const BACKUP_SECTIONS = ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'watchStats']
/** The sections a separate profile keeps for itself */
export const PROFILE_DATA_SECTIONS = ['playlists', 'history', 'searchHistory', 'watchStats']
const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024
const MAX_ENTRY_SIZE = 256 * 1024 * 1024
const MAX_TOTAL_SIZE = 256 * 1024 * 1024

/**
 * Subscription imports add the channels a profile lacks and may set its icon.
 * The saved name, colors, and channels with their settings stay as they are.
 */
export function mergeImportedProfile(current, imported) {
  if (!current) return withProfileSeparation(imported)
  const subscribedIds = new Set(current.subscriptions.map(channel => channel.id))
  const added = imported.subscriptions.filter(channel => !subscribedIds.has(channel.id) && subscribedIds.add(channel.id))
  return {
    ...current,
    ...(Object.hasOwn(imported, 'icon') ? { icon: imported.icon } : {}),
    subscriptions: [...current.subscriptions, ...added],
  }
}

/**
 * Whether a profile keeps its own data is chosen when it is created. A saved
 * profile keeps that choice, and the main profile never keeps its data apart.
 * @template {{ _id?: string, separate?: boolean }} T
 * @param {T} profile
 * @param {{ separate?: boolean } | null} [current] the saved profile
 * @returns {T}
 */
export function withProfileSeparation(profile, current = null) {
  // Other IDs can't name its datastores, see `isValidSeparateProfileId`.
  // A new profile without an ID gets a short one.
  const separate = profile._id !== MAIN_PROFILE_ID && (profile._id === undefined || isValidSeparateProfileId(profile._id)) &&
    (current ? current.separate === true : profile.separate === true)
  const { separate: _separate, ...rest } = profile
  return /** @type {T} */ (separate ? { ...rest, separate: true } : rest)
}

export function mergeBackupProfile(current, imported) {
  if (!current) return withProfileSeparation(imported)
  const subscriptions = new Map(current.subscriptions.map(channel => [channel.id, channel]))
  for (const channel of imported.subscriptions) subscriptions.set(channel.id, channel)
  return withProfileSeparation({ ...current, ...imported, subscriptions: [...subscriptions.values()] }, current)
}

/**
 * Restored options are a new local edit, so sync keeps them over the server's
 * copy. The backup's own edit time would be older than that copy.
 * @param {object} playlist the merged playlist
 * @param {object} [current]
 */
function withRestoredPreferencesTime(playlist, current) {
  const restored = { ...playlist }
  for (const key of PLAYLIST_PREFERENCE_TIMESTAMP_KEYS) {
    if (current?.[key] !== undefined) restored[key] = current[key]
    else delete restored[key]
  }
  stampPlaylistPreferenceEdits(restored, current)
  return restored
}

export function mergeBackupPlaylist(current, imported) {
  if (!current) return withRestoredPreferencesTime(imported)
  const videos = [...current.videos]
  // Indexed, as comparing every imported video with every saved one takes
  // minutes for playlists with tens of thousands of videos.
  const playlistItemIds = new Set()
  const timesAddedByVideoId = new Map()
  const add = (video) => {
    if (video.playlistItemId != null) playlistItemIds.add(video.playlistItemId)
    const timesAdded = timesAddedByVideoId.get(video.videoId)
    if (timesAdded) timesAdded.add(video.timeAdded)
    else timesAddedByVideoId.set(video.videoId, new Set([video.timeAdded]))
  }
  videos.forEach(add)
  for (const video of imported.videos) {
    const exists = video.playlistItemId != null
      ? playlistItemIds.has(video.playlistItemId)
      : timesAddedByVideoId.get(video.videoId)?.has(video.timeAdded) === true
    if (!exists) {
      videos.push(video)
      add(video)
    }
  }
  return withRestoredPreferencesTime({ ...current, ...imported, protected: current.protected, videos }, current)
}

export function mergeBackupHistoryRecord(current, imported) {
  if (!current) return imported
  // `updateWatchProgress` can create a record with progress but no `timeWatched` or metadata
  const currentTimeWatched = Number.isFinite(current.timeWatched) ? current.timeWatched : -Infinity
  const newer = imported.timeWatched > currentTimeWatched ? imported : current
  return {
    ...newer,
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

/**
 * The data of each separate profile goes to `profile-data/<index>/`, listed
 * in the manifest's `profileData`. Only archives with separate profiles or
 * their data are version 2, so older versions still restore the others and
 * refuse these clearly.
 * @param {object} data the sections, and in `profileData` each separate profile's sections by its ID
 */
export function createUnifiedBackup(data) {
  const sections = BACKUP_SECTIONS.filter(section => Object.hasOwn(data, section))
  if (sections.length === 0) throw new Error('No backup sections selected')
  const profileData = Object.entries(data.profileData ?? {})
    .map(([id, profile]) => ({ id, sections: PROFILE_DATA_SECTIONS.filter(section => sections.includes(section) && Object.hasOwn(profile, section)) }))
    .filter(profile => profile.sections.length > 0)
  // Older versions would restore a separate profile as one sharing its data.
  const hasSeparateProfiles = sections.includes('profiles') && data.profiles.some(profile => profile?.separate === true)
  const manifest = profileData.length > 0 || hasSeparateProfiles
    ? { format: 'opentubex-backup', version: 2, createdAt: new Date().toISOString(), sections, profileData }
    : { format: 'opentubex-backup', version: 1, createdAt: new Date().toISOString(), sections }
  const files = {
    'manifest.json': strToU8(JSON.stringify(manifest))
  }
  let totalSize = files['manifest.json'].length
  const add = (name, value) => {
    files[name] = strToU8(JSON.stringify(value))
    if (files[name].length > MAX_ENTRY_SIZE) throw new Error('Backup entry is too large')
    totalSize += files[name].length
    if (totalSize > MAX_TOTAL_SIZE) throw new Error('Backup data is too large')
  }
  for (const section of sections) add(`${section}.json`, data[section])
  profileData.forEach(({ id, sections: profileSections }, index) => {
    for (const section of profileSections) add(`profile-data/${index}/${section}.json`, data.profileData[id][section])
  })
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

  const parse = name => JSON.parse(strFromU8(entries.get(name)))
  if (!entries.has('manifest.json')) throw new Error('Backup archive has missing or unexpected files')
  const manifest = parse('manifest.json')
  if (manifest?.format !== 'opentubex-backup' || (manifest.version !== 1 && manifest.version !== 2)) {
    throw new Error('Unsupported backup version')
  }
  const sections = manifest.sections ?? BACKUP_SECTIONS
  const validSections = (list, allowed) => Array.isArray(list) && list.length > 0 && new Set(list).size === list.length && list.every(section => allowed.includes(section))
  if (!validSections(sections, BACKUP_SECTIONS)) {
    throw new Error('Invalid backup sections')
  }
  const profileData = manifest.version === 2 ? manifest.profileData : []
  if (!Array.isArray(profileData) || new Set(profileData.map(profile => profile?.id)).size !== profileData.length ||
    !profileData.every(profile => typeof profile?.id === 'string' && profile.id !== '' && profile.id !== MAIN_PROFILE_ID &&
      validSections(profile.sections, PROFILE_DATA_SECTIONS.filter(section => sections.includes(section))))) {
    throw new Error('Invalid backup sections')
  }
  const expected = new Set(['manifest.json', ...sections.map(section => `${section}.json`)])
  profileData.forEach((profile, index) => {
    for (const section of profile.sections) expected.add(`profile-data/${index}/${section}.json`)
  })
  if (entries.size !== expected.size || [...entries.keys()].some(name => !expected.has(name))) {
    throw new Error('Backup archive has missing or unexpected files')
  }
  const data = Object.fromEntries(sections.map(section => [section, parse(`${section}.json`)]))
  validateUnifiedBackup(data)
  if (profileData.length > 0) {
    data.profileData = Object.fromEntries(profileData.map((profile, index) => {
      const sectionData = Object.fromEntries(profile.sections.map(section => [section, parse(`profile-data/${index}/${section}.json`)]))
      validateUnifiedBackup(sectionData)
      return [profile.id, sectionData]
    }))
  }
  return { manifest, data }
}

export function validateBackupWatchStats(backup) {
  const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  if (!plainObject(backup) || !Array.isArray(backup.records) ||
    !backup.records.every(record => plainObject(record) && /^\d{4}-\d{2}-\d{2}$/.test(record.date) && Number.isFinite(record.seconds) && record.seconds >= 0) ||
    (backup.adjustment !== null && !plainObject(backup.adjustment))) {
    throw new Error('Invalid backup watchStats')
  }
}

export function validateUnifiedBackup(data) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (Object.hasOwn(data, 'settings') && (!object(data.settings) || Object.keys(data.settings).some(key => key === '__proto__'))) throw new Error('Invalid backup settings')
  const sections = {
    profiles: record => object(record) && typeof record._id === 'string' && record._id !== '' && (record._id === MAIN_PROFILE_ID ? record.name === null || typeof record.name === 'string' : typeof record.name === 'string' && record.name !== '') && Array.isArray(record.subscriptions) && record.subscriptions.every(channel => object(channel) && typeof channel.id === 'string'),
    playlists: record => object(record) && typeof record._id === 'string' && typeof record.playlistName === 'string' && Array.isArray(record.videos) && record.videos.every(video => object(video) && typeof video.videoId === 'string'),
    history: record => object(record) && typeof record.videoId === 'string' && (record.timeWatched === undefined || (Number.isFinite(record.timeWatched) && record.timeWatched >= 0)) && (record.watchProgress === undefined || (Number.isFinite(record.watchProgress) && record.watchProgress >= 0)),
    searchHistory: record => object(record) && typeof record._id === 'string' && typeof record.query === 'string',
  }
  for (const [section, valid] of Object.entries(sections)) {
    if (Object.hasOwn(data, section) && (!Array.isArray(data[section]) || !data[section].every(valid))) throw new Error(`Invalid backup ${section}`)
  }
  if (Object.hasOwn(data, 'watchStats')) validateBackupWatchStats(data.watchStats)
}
