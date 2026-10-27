import { app, session } from 'electron'
import { lstat, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { IpcChannels } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { handleTrusted } from './ipc'
import { TabManager } from './tabs/TabManager'
import { tabPreviewStorage } from './tabs/TabPreviewStorage'
import { clearYtDlpPlaybackCache } from './ytDlpPlaybackCache'

// Includes the legacy NeDB file, which stays for older versions.
const sqliteFiles = name => [`${name}.sqlite`, `${name}.sqlite-wal`, `${name}.sqlite-shm`, `${name}.db`]

const USER_DATA_FILES = {
  downloadRecords: 'downloads.json',
  videoMetadata: sqliteFiles('video-metadata-cache'),
  subscriptionCache: sqliteFiles('subscription-cache'),
  searchHistory: sqliteFiles('search-history'),
  history: sqliteFiles('history'),
  watchStats: sqliteFiles('watch-stats'),
  recommendations: sqliteFiles('recommendations'),
  playlists: sqliteFiles('playlists'),
  profiles: sqliteFiles('profiles'),
  settings: sqliteFiles('settings'),
  tabSessions: sqliteFiles('tab-session'),
  liveReminders: sqliteFiles('live-reminders'),
  ytDlpPlayback: 'yt-dlp-playback-cache.json'
}

const BROWSER_CACHE_ENTRIES = [
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Dictionaries',
  'GPUCache',
  'GrShaderCache',
  'Safe Browsing',
  'Service Worker',
  'ShaderCache',
  'Shared Dictionary',
  'component_crx_cache',
  'extensions_crx_cache'
]

const BROWSER_RUNTIME_ENTRIES = [
  'AutofillStrikeDatabase',
  'BrowserMetrics',
  'Cookies',
  'Cookies-journal',
  'Crash Reports',
  'Crashpad',
  'DIPS',
  'DIPS-journal',
  'DIPS-shm',
  'DIPS-wal',
  'DevToolsActivePort',
  'Favicons',
  'Favicons-journal',
  'File System',
  'History',
  'History-journal',
  'IndexedDB',
  'Local State',
  'Local Storage',
  'Login Data',
  'Login Data-journal',
  'Network',
  'Network Persistent State',
  'Origin Bound Certs',
  'Origin Bound Certs-journal',
  'Preferences',
  'QuotaManager',
  'QuotaManager-journal',
  'Reporting and NEL',
  'Reporting and NEL-journal',
  'Secure Preferences',
  'Session Storage',
  'SharedStorage',
  'SharedStorage-wal',
  'Shortcuts',
  'Shortcuts-journal',
  'Site Characteristics Database',
  'Top Sites',
  'Top Sites-journal',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'VideoDecodeStats',
  'Visited Links',
  'Web Data',
  'Web Data-journal',
  'WebStorage',
  'blob_storage',
  'databases',
  'segmentation_platform',
  'shared_proto_db'
]

async function fileSize(filePath) {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile() ? fileStat.size : 0
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

async function entrySize(entryPath) {
  try {
    const entryStat = await lstat(entryPath)
    if (entryStat.isDirectory()) return directorySize(entryPath)
    if (entryStat.isFile()) return entryStat.size
    return 0
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

async function profileEntrySizes(directoryPath) {
  let entries
  try {
    entries = await readdir(directoryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map()
    throw error
  }

  return new Map(await Promise.all(entries.map(async entry => (
    [entry, await entrySize(join(directoryPath, entry))]
  ))))
}

function sumEntries(entrySizes, entryNames) {
  if (!(entrySizes instanceof Map)) return null
  return entryNames.reduce((total, entry) => total + (entrySizes.get(entry) ?? 0), 0)
}

async function readSize(read, label) {
  try {
    return await read()
  } catch (error) {
    console.warn(`Could not calculate ${label} storage usage`, error)
    return null
  }
}

export async function directorySize(directoryPath) {
  let entries
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }

  const sizes = await Promise.all(entries.map(entry => {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) return directorySize(entryPath)
    if (entry.isFile()) return fileSize(entryPath)
    return 0
  }))
  return sizes.reduce((total, size) => total + size, 0)
}

export async function getStorageUsage() {
  const userDataPath = app.getPath('userData')
  const entrySizes = await readSize(() => profileEntrySizes(userDataPath), 'profile directory')
  const fileEntries = Object.entries(USER_DATA_FILES).map(([key, fileNames]) => (
    [key, sumEntries(entrySizes, [fileNames].flat())]
  ))
  const categorizedUsage = {
    ...Object.fromEntries(fileEntries),
    httpCache: sumEntries(entrySizes, ['Cache']),
    tabPreviews: sumEntries(entrySizes, [basename(tabPreviewStorage.directory())]),
    playerCache: sumEntries(entrySizes, ['player_cache']),
    browserCacheData: sumEntries(entrySizes, BROWSER_CACHE_ENTRIES),
    browserRuntimeData: sumEntries(entrySizes, BROWSER_RUNTIME_ENTRIES)
  }
  const profileTotal = entrySizes instanceof Map
    ? [...entrySizes.values()].reduce((total, size) => total + size, 0)
    : null
  const categorizedSizes = Object.values(categorizedUsage)
  const otherProfileData = Number.isFinite(profileTotal) && categorizedSizes.every(Number.isFinite)
    ? Math.max(profileTotal - categorizedSizes.reduce((total, size) => total + size, 0), 0)
    : null

  return {
    ...categorizedUsage,
    otherProfileData,
    profileTotal
  }
}

export async function clearStorage(category) {
  const userDataPath = app.getPath('userData')
  switch (category) {
    case 'http-cache':
      await session.defaultSession.clearCache()
      break
    case 'tab-previews':
      await TabManager.clearTabPreviewCache()
      break
    case 'yt-dlp-playback':
      await clearYtDlpPlaybackCache()
      break
    case 'player-cache':
      await rm(join(userDataPath, 'player_cache'), { force: true, recursive: true })
      break
    default:
      return false
  }
  return true
}

export async function compactStorageDatabases() {
  const results = await baseHandlers.compactAllDatastores()
  return results.every(result => result.status === 'fulfilled')
}

export function setupStorageIpc() {
  handleTrusted(IpcChannels.STORAGE_GET_USAGE, () => getStorageUsage(), {})
  // Only the focused window may clear data, after the user confirmed it there.
  handleTrusted(IpcChannels.STORAGE_CLEAR, (event, category) =>
    event.sender.isFocused() ? clearStorage(category) : false, false)
  handleTrusted(IpcChannels.STORAGE_COMPACT_DATABASES, () => compactStorageDatabases(), false)
}
