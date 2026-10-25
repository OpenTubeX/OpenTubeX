import { BrowserWindow, dialog, ipcMain, session } from 'electron'
import * as http from 'node:http'
import * as https from 'node:https'
import { randomUUID } from 'crypto'

import { IpcChannels } from '../constants'
import { applyTwitchPlaylistOrigin } from '../twitchPlaylistOrigin'
import { fetchCastMedia, resolveCastMediaAddresses } from './castMediaServer'
import { discoverDlnaDevices, startDlnaCast, stopDlnaCast, hasDlnaCastFailed, getDlnaCastPosition } from './dlnaCast'
import { isInvidiousInstanceUrl } from './invidiousAuthorization'
import { createMainTranslator } from './mainTranslator'
import { isOpenTubeXUrl } from './utils'
import { getDlnaFfmpegExecutable, getYtDlpExternalStreamCookieHeader, getYtDlpExternalStreamHeaders } from './ytDlp'

/**
 * Registers the Google Cast, FCast and DLNA handlers. Only a focused OpenTubeX window
 * may start casting, and each window controls only its own casts.
 * @param {object} options
 * @param {import('./chromecast').ChromecastManager} options.chromecast
 * @param {import('./fcast').FcastManager} options.fcast
 * @param {Map<number, { url: string, authorization: string }>} options.invidiousAuthorizations
 * @param {() => Promise<string | undefined>} options.getConfiguredApiServerUrl
 */
export function setupCastIpc({ chromecast, fcast, invidiousAuthorizations, getConfiguredApiServerUrl }) {
  /** Relays may reach a non-public address only for the user's Invidious instance or Yattee server, after native consent. */
  const createMediaAddressResolver = async (sender, protocol) => {
    let privateInstance = null
    try {
      const configuredInstance = await getConfiguredApiServerUrl()
      if (typeof configuredInstance === 'string' && configuredInstance !== '') {
        const instance = new URL(configuredInstance)
        if (['http:', 'https:'].includes(instance.protocol)) {
          privateInstance = instance.origin + instance.pathname
        }
      }
    } catch { }
    let privateApproval = null
    const authorizePrivateUrl = async url => {
      if (!privateInstance || !isInvidiousInstanceUrl(url.href, privateInstance) ||
          /%(?:25)*(?:2e|2f|5c)/i.test(url.pathname) || sender.isDestroyed()) return false
      // Settings can be written by the renderer. Only a native dialog grants
      // access, for this session and this instance's origin and path.
      privateApproval ??= (async () => {
        const t = await createMainTranslator()
        if (sender.isDestroyed()) return false
        const titles = { dlna: t('Video.Player.DLNA.Cast'), google: t('Video.Player.Google Cast.Cast'), fcast: t('Video.Player.FCast.Cast') }
        const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(sender), {
          type: 'question',
          title: titles[protocol],
          message: t('Video.Player.Google Cast.Allow Private Instance', { instance: privateInstance }),
          buttons: [t('Cancel'), t('Yes')],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        return response === 1
      })()
      return await privateApproval && !sender.isDestroyed()
    }
    const resolveAddresses = url => resolveCastMediaAddresses(url, authorizePrivateUrl,
      hostname => session.defaultSession.resolveHost(hostname, { cacheUsage: 'disallowed' }))
    return { privateInstance, resolveAddresses }
  }
  ipcMain.handle(IpcChannels.DLNA_DISCOVER, event => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return []
    return discoverDlnaDevices()
  })
  const dlnaOwners = new WeakSet()
  const startDlnaForWindow = async (event, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return { error: 'Casting requires an active OpenTubeX window' }
    }
    const sourceHeaders = mediaUrl => {
      let headers = {}
      if (typeof mediaUrl === 'string' && /^https?:\/\//.test(mediaUrl)) {
        try {
          const url = new URL(mediaUrl)
          if (url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
            headers = { Referer: 'https://www.youtube.com/', Origin: 'https://www.youtube.com' }
          }
          const invidiousAuthorization = invidiousAuthorizations.get(event.sender.id)
          if (invidiousAuthorization && isInvidiousInstanceUrl(mediaUrl, invidiousAuthorization.url)) {
            headers.Authorization = invidiousAuthorization.authorization
          }
          Object.assign(headers, getYtDlpExternalStreamHeaders(event.sender, mediaUrl))
          const cookies = getYtDlpExternalStreamCookieHeader(event.sender, mediaUrl)
          if (cookies !== null) headers.Cookie = cookies
        } catch { /* startDlnaCast reports an invalid URL. */ }
      }
      return headers
    }
    let muxOptions = {}
    if (payload?.audioUrl !== undefined) {
      try {
        muxOptions = { ffmpegPath: await getDlnaFfmpegExecutable(), audioHeaders: sourceHeaders(payload.audioUrl) }
      } catch (error) { return { error: error.message, muxUnavailable: true } }
    }
    const { resolveAddresses } = await createMediaAddressResolver(event.sender, 'dlna')
    // Validate before the renderer requests media, so a refused source cannot start a cast
    // and a private instance's dialog cannot outlast the renderer's timeout.
    for (const sourceUrl of [payload?.mediaUrl, payload?.audioUrl]) {
      let url
      try { url = new URL(sourceUrl) } catch { continue /* startDlnaCast reports an invalid URL. */ }
      if (!await resolveAddresses(url)) return { error: 'Media address is not allowed' }
    }
    if (event.sender.isDestroyed()) return { error: 'Casting requires an active OpenTubeX window' }
    const result = await startDlnaCast(event.sender.id, payload, sourceHeaders(payload?.mediaUrl), muxOptions, resolveAddresses)
    if (result.castId) {
      if (event.sender.isDestroyed()) {
        stopDlnaCast(event.sender.id).catch(console.error)
      } else if (!dlnaOwners.has(event.sender)) {
        dlnaOwners.add(event.sender)
        event.sender.once('destroyed', () => stopDlnaCast(event.sender.id).catch(console.error))
      }
    }
    return result
  }
  ipcMain.handle(IpcChannels.DLNA_START, async (event, payload) => {
    if (!event.sender.isFocused()) return { error: 'Casting requires an active OpenTubeX window' }
    const result = await startDlnaForWindow(event, payload)
    if (result.muxUnavailable && payload?.audioUrl && typeof payload.fallbackMediaUrl === 'string') {
      // Validation can outlast activation and focus. Retry within the same
      // authorized operation, using the normal source and owner checks.
      return {
        ...await startDlnaForWindow(event, {
          deviceId: payload.deviceId,
          mediaUrl: payload.fallbackMediaUrl,
          title: payload.title,
          startSeconds: payload.startSeconds
        }),
        usedFallback: true
      }
    }
    return result
  })
  ipcMain.handle(IpcChannels.DLNA_RECOVER, async (event, castId, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof castId !== 'string' ||
        payload?.audioUrl !== undefined || !hasDlnaCastFailed(event.sender.id, castId)) {
      return { error: 'No failed cast is available to recover' }
    }
    const position = await getDlnaCastPosition(event.sender.id, castId)
    await stopDlnaCast(event.sender.id, castId)
    return startDlnaForWindow(event, {
      ...payload, startSeconds: (Number.isFinite(payload?.startSeconds) ? payload.startSeconds : 0) + (position ?? 0)
    })
  })
  ipcMain.handle(IpcChannels.DLNA_HAS_FAILED, (event, castId) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof castId !== 'string') return false
    return hasDlnaCastFailed(event.sender.id, castId)
  })
  ipcMain.handle(IpcChannels.DLNA_STOP, (event, castId) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof castId !== 'string') return false
    return stopDlnaCast(event.sender.id, castId)
  })

  // Google Cast and FCast share the casting IPC, selected by `protocol`.
  const castManager = protocol => protocol === 'fcast' ? fcast : chromecast
  ipcMain.handle(IpcChannels.CAST_DISCOVER, async (event, protocol) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) return []
    try { return await castManager(protocol).discover() } catch (error) { return { error: error.message, ...(error.code ? { errorCode: error.code } : {}) } }
  })
  const castOwners = new WeakSet()
  const castPreparations = new Map()
  ipcMain.handle(IpcChannels.CAST_PREPARE, event => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) return { error: 'Casting requires an active OpenTubeX window', errorCode: 'CAST_NOT_AUTHORIZED' }
    const ownerId = event.sender.id
    const preparationId = randomUUID()
    castPreparations.set(ownerId, { preparationId, frameId: event.senderFrame.routingId, frameUrl: event.senderFrame.url })
    if (!castOwners.has(event.sender)) {
      castOwners.add(event.sender)
      event.sender.once('destroyed', () => {
        castPreparations.delete(ownerId)
        for (const manager of [chromecast, fcast]) {
          if (manager.active?.ownerId === ownerId) manager.stop(ownerId, manager.active.castId).catch(console.error)
        }
      })
    }
    return { preparationId }
  })
  ipcMain.on(IpcChannels.CAST_CANCEL_PREPARATION, (event, preparationId) => {
    if (isOpenTubeXUrl(event.senderFrame.url) && castPreparations.get(event.sender.id)?.preparationId === preparationId) {
      castPreparations.delete(event.sender.id)
    }
  })
  ipcMain.handle(IpcChannels.CAST_START, async (event, payload, preparationId, protocol) => {
    const ownerId = event.sender.id
    const preparation = castPreparations.get(ownerId)
    if (!isOpenTubeXUrl(event.senderFrame.url) || !preparation || preparation.preparationId !== preparationId ||
        preparation.frameId !== event.senderFrame.routingId || preparation.frameUrl !== event.senderFrame.url) {
      return { error: 'Cast start is not authorized', errorCode: 'CAST_NOT_AUTHORIZED' }
    }
    // Consume the focused-window grant once, preserving it across subtitle work.
    castPreparations.delete(ownerId)
    const getHeaders = mediaUrl => {
      const url = new URL(mediaUrl)
      const headers = { 'User-Agent': session.defaultSession.getUserAgent() }
      if (url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
        headers.Referer = 'https://www.youtube.com/'
        headers.Origin = 'https://www.youtube.com'
      }
      const authorization = invidiousAuthorizations.get(ownerId)
      if (authorization && isInvidiousInstanceUrl(mediaUrl, authorization.url)) headers.Authorization = authorization.authorization
      Object.assign(headers, getYtDlpExternalStreamHeaders(event.sender, mediaUrl))
      applyTwitchPlaylistOrigin(url, headers)
      const cookies = getYtDlpExternalStreamCookieHeader(event.sender, mediaUrl)
      if (cookies !== null) headers.Cookie = cookies
      return headers
    }
    const manager = castManager(protocol)
    const { privateInstance, resolveAddresses } = await createMediaAddressResolver(event.sender, protocol === 'fcast' ? 'fcast' : 'google')
    const fetchMedia = async (url, options) => fetchCastMedia(new URL(url).protocol === 'https:' ? https : http, url, {
      ...options, proxy: await session.defaultSession.resolveProxy(url)
    })
    // Ask before launching the receiver, so a private source's native consent
    // dialog does not consume the receiver's media-loading timeout.
    if (privateInstance && isInvidiousInstanceUrl(payload?.source?.url, privateInstance) &&
        !await resolveAddresses(new URL(payload.source.url))) return { error: 'Private Cast media was not authorized', errorCode: 'CAST_PRIVATE_NOT_AUTHORIZED' }
    if (event.sender.isDestroyed()) return { error: 'Cast start cancelled', errorCode: 'CAST_CANCELLED' }
    const onProgress = stage => {
      const frame = event.senderFrame
      if (!event.sender.isDestroyed() && frame && !frame.detached) {
        try {
          frame.send(IpcChannels.CAST_PROGRESS, { preparationId, stage })
        } catch {
          // Progress is advisory; the frame may close between the guard and send.
        }
      }
    }
    const result = await manager.start(ownerId, payload, getHeaders, resolveAddresses, fetchMedia, onProgress)
    if (result.castId) {
      if (event.sender.isDestroyed()) await manager.stop(ownerId, result.castId)
    }
    return result
  })
  ipcMain.handle(IpcChannels.CAST_STATUS, (event, castId, protocol) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof castId !== 'string') return { connected: false }
    return castManager(protocol).status(event.sender.id, castId)
  })
  ipcMain.handle(IpcChannels.CAST_CONTROL, (event, castId, action, value, protocol) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || typeof castId !== 'string') {
      return { error: 'Casting requires an active OpenTubeX window', errorCode: 'CAST_NOT_AUTHORIZED' }
    }
    return castManager(protocol).control(event.sender.id, castId, action, value)
  })
  ipcMain.handle(IpcChannels.CAST_STOP, (event, castId, protocol) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof castId !== 'string') return { connected: false }
    return castManager(protocol).stop(event.sender.id, castId)
  })
}
