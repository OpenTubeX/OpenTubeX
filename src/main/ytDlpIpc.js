import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import asyncFs from 'fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { DOWNLOADED_MEDIA_MIME_TYPES, IpcChannels } from '../constants'
import { getSubscriptionAutoRefreshOwner } from './subscriptionAutoRefresh'
import { isOpenTubeXUrl } from './utils'
import {
  getYtDlpDownloadFile,
  handleYtDlpCancelDownload,
  handleYtDlpCancelHistoryRepair,
  handleYtDlpCheckBinaryUpdate,
  handleYtDlpClearDownloads,
  handleYtDlpControlDownload,
  handleYtDlpDownload,
  handleYtDlpDownloadBinary,
  handleYtDlpGetHistoryMetadata,
  handleYtDlpGetInfo,
  handleYtDlpGetPlaybackInfo,
  handleYtDlpGetRecommendations,
  handleYtDlpGetSubtitle,
  handleYtDlpListDownloads,
  handleYtDlpOpenDownload,
  handleYtDlpQueueAction,
  handleYtDlpRemoveDownload,
  handleYtDlpSearch,
} from './ytDlp'
import {
  handleYtDlpPlaybackCacheClear,
  handleYtDlpPlaybackCacheDelete,
  handleYtDlpPlaybackCacheGet,
  handleYtDlpPlaybackCacheSet,
} from './ytDlpPlaybackCache'

/**
 * Serves completed downloads to the player through downloadmedia://, with
 * byte ranges so that it can seek.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleDownloadMediaRequest(request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  const url = new URL(request.url)
  const [, rawId, videoId] = url.pathname.split('/')
  if (url.host !== 'file' || !/^\d+$/.test(rawId ?? '')) {
    return new Response(null, { status: 400 })
  }

  const file = await getYtDlpDownloadFile(Number(rawId), videoId ?? '', url.searchParams.get('path'))
  if (file === null) return new Response(null, { status: 404 })

  let fileSize
  try {
    const fileStats = await asyncFs.stat(file.path)
    if (!fileStats.isFile()) {
      return new Response(null, { status: 404 })
    }
    fileSize = fileStats.size
  } catch {
    return new Response(null, { status: 404 })
  }
  const extension = path.extname(file.path).toLowerCase()
  const mimeType = file.mode === 'audio' && extension === '.webm'
    ? 'audio/webm'
    : file.mode === 'audio' && extension === '.mp4'
      ? 'audio/mp4'
      : DOWNLOADED_MEDIA_MIME_TYPES[extension.slice(1)] ?? 'application/octet-stream'
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType
  }
  if (fileSize === 0) {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
  }
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
  let start = 0
  let end = fileSize - 1
  let status = 200

  if (rangeMatch !== null) {
    const [, rawStart, rawEnd] = rangeMatch
    if (rawStart === '') {
      const suffixLength = Number(rawEnd)
      start = Math.max(0, fileSize - suffixLength)
    } else {
      start = Number(rawStart)
      if (rawEnd !== '') end = Math.min(Number(rawEnd), end)
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${fileSize}` }
      })
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
  }

  headers['Content-Length'] = String(end - start + 1)
  const body = request.method === 'HEAD'
    ? null
    : Readable.toWeb(createReadStream(file.path, { start, end }))
  return new Response(body, { status, headers })
}

/**
 * Registers the yt-dlp handlers for downloads, metadata, the playback cache,
 * binary updates and the settings file pickers.
 */
export function setupYtDlpIpc() {
  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD, (event, payload, retryDownloadId) => {
    const subscriptionAutoRefreshOwner = getSubscriptionAutoRefreshOwner()
    const automaticDownloadAuthorized = subscriptionAutoRefreshOwner?.webContents.id === event.sender.id &&
      payload?.refreshOwnerTabId === subscriptionAutoRefreshOwner.tabId
    return handleYtDlpDownload(event, payload, retryDownloadId, automaticDownloadAuthorized)
  })

  ipcMain.on(IpcChannels.YT_DLP_CANCEL_DOWNLOAD, handleYtDlpCancelDownload)
  ipcMain.handle(IpcChannels.YT_DLP_CONTROL_DOWNLOAD, handleYtDlpControlDownload)
  ipcMain.handle(IpcChannels.YT_DLP_QUEUE_ACTION, handleYtDlpQueueAction)
  ipcMain.handle(IpcChannels.YT_DLP_LIST_DOWNLOADS, handleYtDlpListDownloads)
  ipcMain.handle(IpcChannels.YT_DLP_CLEAR_DOWNLOADS, handleYtDlpClearDownloads)
  ipcMain.handle(IpcChannels.YT_DLP_OPEN_DOWNLOAD, handleYtDlpOpenDownload)
  ipcMain.handle(IpcChannels.YT_DLP_REMOVE_DOWNLOAD, handleYtDlpRemoveDownload)

  ipcMain.handle(IpcChannels.YT_DLP_GET_INFO, handleYtDlpGetInfo)

  ipcMain.handle(IpcChannels.YT_DLP_GET_SUBTITLE, handleYtDlpGetSubtitle)
  ipcMain.handle(IpcChannels.YT_DLP_CANCEL_HISTORY_REPAIR, handleYtDlpCancelHistoryRepair)
  ipcMain.handle(IpcChannels.YT_DLP_GET_HISTORY_METADATA, handleYtDlpGetHistoryMetadata)
  ipcMain.handle(IpcChannels.YT_DLP_GET_PLAYBACK_INFO, handleYtDlpGetPlaybackInfo)
  ipcMain.handle(IpcChannels.YT_DLP_GET_RECOMMENDATIONS, handleYtDlpGetRecommendations)
  ipcMain.handle(IpcChannels.YT_DLP_SEARCH, handleYtDlpSearch)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_GET, handleYtDlpPlaybackCacheGet)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_SET, handleYtDlpPlaybackCacheSet)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_DELETE, handleYtDlpPlaybackCacheDelete)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_CLEAR, handleYtDlpPlaybackCacheClear)

  ipcMain.handle(IpcChannels.YT_DLP_CHECK_BINARY_UPDATE, handleYtDlpCheckBinaryUpdate)
  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD_BINARY, handleYtDlpDownloadBinary)

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_EXECUTABLE, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    /** @type {import('electron').FileFilter[]} */
    const filters = process.platform === 'win32'
      ? [
          { name: 'Executable Files', extensions: ['exe'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      : [{ name: 'All Files', extensions: ['*'] }]

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_COOKIES, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters: [
        { name: 'Cookie Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_BROWSER_PROFILE, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('downloads')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })
}
