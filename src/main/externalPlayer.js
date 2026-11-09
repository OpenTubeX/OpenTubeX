import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { BrowserWindow, dialog } from 'electron'
import { settings } from '../datastores/handlers/base'
import { createMainTranslator } from './mainTranslator'
import { EXTERNAL_PLAYER_APPROVED_ARGS_SETTING } from './settingWriteGuard'
import { isOpenTubeXUrl } from './utils'
import { IpcChannels, UnsupportedPlayerActions } from '../constants'

/**
 * @typedef ExternalPlayerPayload
 * @property {string | undefined | null} [videoId]
 * @property {string | undefined | null} [playlistId]
 * @property {number | undefined | null} [startTime]
 * @property {number | undefined | null} [playbackRate]
 * @property {number | undefined | null} [playlistIndex]
 * @property {boolean | undefined | null} [playlistReverse]
 * @property {boolean | undefined | null} [playlistShuffle]
 * @property {boolean | undefined | null} [playlistLoop]
 */

/**
 * @typedef CmdArgs
 * @property {string} defaultExecutable
 * @property {string[] | null} defaultCustomArguments
 * @property {string} videoUrl
 * @property {string | null} playlistUrl
 * @property {string | null} startOffset
 * @property {string | null} playbackRate
 * @property {string | null} playlistIndex
 * @property {string | null} playlistReverse
 * @property {string | null} playlistShuffle
 * @property {string | null} playlistLoop
 */

const ID_REGEX = /^[\w-]+$/

/** @type {Map<string, CmdArgs>} */
const externalPlayerCmdArgs = new Map()

/**
 * @param {import('electron').IpcMainEvent} event
 * @param {ExternalPlayerPayload} payload
 */
export async function handleOpenInExternalPlayer(event, payload) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) {
    return
  }

  const hasValidVideoId = typeof payload.videoId === 'string' && payload.videoId.length === 11 && ID_REGEX.test(payload.videoId)
  const hasValidPlaylistId = typeof payload.playlistId === 'string' && payload.playlistId.length > 2 && ID_REGEX.test(payload.playlistId)

  if (!hasValidVideoId && !hasValidPlaylistId) {
    return
  }

  /** @type {string} */
  const externalPlayer = (await settings._findOne('externalPlayer'))?.value || ''

  // External player setting not set or set to "none"
  if (externalPlayer === '') {
    return
  }

  if (externalPlayerCmdArgs.size === 0) {
    await loadExternalPlayerData()
  }

  const cmdArgs = externalPlayerCmdArgs.get(externalPlayer)

  if (cmdArgs === undefined) {
    return
  }

  const args = []
  /** @type {import('../constants').UnsupportedPlayerAction[]} */
  const unsupportedActions = []

  /** @type {boolean} */
  const ignoreWarnings = (await settings._findOne('externalPlayerIgnoreWarnings'))?.value || false

  /** @type {boolean} */
  const ignoreDefaultArgs = (await settings._findOne('externalPlayerIgnoreDefaultArgs'))?.value || false

  const customArgs = parseCustomArguments((await settings._findOne('externalPlayerCustomArgs'))?.value)
  if (customArgs === null) {
    console.error('Invalid external player arguments')
    return
  }

  if (customArgs.length > 0) {
    args.push(...customArgs)
  } else if (!ignoreDefaultArgs && Array.isArray(cmdArgs.defaultCustomArguments)) {
    args.push(...cmdArgs.defaultCustomArguments)
  }

  if (ignoreDefaultArgs) {
    if (hasValidPlaylistId && !hasValidVideoId) {
      if (typeof cmdArgs.playlistUrl === 'string') {
        args.push(`${cmdArgs.playlistUrl}https://youtube.com/playlist?list=${payload.playlistId}`)
      } else if (!ignoreWarnings) {
        unsupportedActions.push(UnsupportedPlayerActions.OPENING_PLAYLISTS)
      }
    } else if (hasValidVideoId) {
      args.push(`${cmdArgs.videoUrl}https://www.youtube.com/watch?v=${payload.videoId}`)
    }
  } else {
    if (typeof payload.startTime === 'number' && payload.startTime > 0) {
      if (typeof cmdArgs.startOffset === 'string') {
        if (cmdArgs.defaultExecutable.startsWith('mpc')) {
          // For mpc-hc and mpc-be, which require startOffset to be in milliseconds
          args.push(cmdArgs.startOffset, 1000 * Math.trunc(payload.startTime))
        } else if (cmdArgs.startOffset.endsWith('=')) {
          // For players using `=` in arguments
          // e.g. vlc --start-time=xxxxx
          args.push(`${cmdArgs.startOffset}${payload.startTime}`)
        } else {
          // For players using space in arguments
          // e.g. smplayer -start xxxxx
          args.push(cmdArgs.startOffset, Math.trunc(payload.startTime))
        }
      } else if (!ignoreWarnings) {
        unsupportedActions.push(UnsupportedPlayerActions.STARTING_VIDEO_AT_OFFSET)
      }
    }

    if (typeof payload.playbackRate === 'number' && payload.playbackRate > 0) {
      if (typeof cmdArgs.playbackRate === 'string') {
        args.push(`${cmdArgs.playbackRate}${payload.playbackRate}`)
      } else if (!ignoreWarnings) {
        unsupportedActions.push(UnsupportedPlayerActions.PLAYBACK_RATE)
      }
    }

    // Check whether the video is in a playlist
    if (hasValidPlaylistId && typeof cmdArgs.playlistUrl === 'string') {
      if (typeof payload.playlistIndex === 'number' && payload.playlistIndex >= 0) {
        if (typeof cmdArgs.playlistIndex === 'string') {
          args.push(`${cmdArgs.playlistIndex}${payload.playlistIndex}`)
        } else if (!ignoreWarnings) {
          unsupportedActions.push(UnsupportedPlayerActions.PLAYLIST_SPECIFIC_VIDEO)
        }
      }

      if (payload.playlistReverse) {
        if (typeof cmdArgs.playlistReverse === 'string') {
          args.push(cmdArgs.playlistReverse)
        } else if (!ignoreWarnings) {
          unsupportedActions.push(UnsupportedPlayerActions.PLAYLIST_REVERSE)
        }
      }

      if (payload.playlistShuffle) {
        if (typeof cmdArgs.playlistShuffle === 'string') {
          args.push(cmdArgs.playlistShuffle)
        } else if (!ignoreWarnings) {
          unsupportedActions.push(UnsupportedPlayerActions.PLAYLIST_SHUFFLE)
        }
      }

      if (payload.playlistLoop) {
        if (typeof cmdArgs.playlistLoop === 'string') {
          args.push(cmdArgs.playlistLoop)
        } else if (!ignoreWarnings) {
          unsupportedActions.push(UnsupportedPlayerActions.PLAYLIST_LOOP)
        }
      }

      // If the player supports opening playlists but not indexes, send only the video URL if an index is specified
      if (cmdArgs.playlistIndex == null && typeof payload.playlistIndex === 'number') {
        args.push(`${cmdArgs.videoUrl}https://youtube.com/watch?v=${payload.videoId}`)
      } else {
        args.push(`${cmdArgs.playlistUrl}https://youtube.com/playlist?list=${payload.playlistId}`)
      }
    } else {
      if (hasValidPlaylistId && !ignoreWarnings) {
        unsupportedActions.push(UnsupportedPlayerActions.OPENING_PLAYLISTS)
      }

      if (hasValidVideoId) {
        args.push(`${cmdArgs.videoUrl}https://www.youtube.com/watch?v=${payload.videoId}`)
      }
    }
  }

  /** @type {string} */
  const externalPlayerExecutable = (await settings._findOne('externalPlayerExecutable'))?.value || ''

  const executable = externalPlayerExecutable.length > 0 ? externalPlayerExecutable : cmdArgs.defaultExecutable

  if (!await confirmCustomArguments(event.sender, externalPlayer, executable, customArgs)) {
    if (!event.sender.isDestroyed()) {
      event.reply(IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT, externalPlayer, [], hasValidPlaylistId, false, true)
    }
    return
  }

  let launchFailed = false
  try {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
    // Without an error listener, a missing executable crashes the main process
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
  } catch (error) {
    console.error('Could not start the external player', error)
    launchFailed = true
  }

  if (event.sender.isDestroyed()) return

  event.reply(
    IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT,
    externalPlayer,
    unsupportedActions,
    hasValidPlaylistId,
    launchFailed
  )
}

/**
 * @param {unknown} value the stored JSON array of arguments
 * @returns {string[] | null} null when the value is not a list of strings
 */
function parseCustomArguments(value) {
  if (value == null || value === '') return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) && parsed.every(argument => typeof argument === 'string') ? parsed : null
  } catch {
    return null
  }
}

/**
 * The value the user approves: custom arguments can run code or write files
 * through some players, and the renderer can change them, so a native
 * dialog in this process asks before they are first used with a player.
 * @param {string} externalPlayer
 * @param {string[]} customArgs
 */
function customArgumentsApprovalKey(externalPlayer, customArgs) {
  return JSON.stringify([externalPlayer, customArgs])
}

/**
 * @param {import('electron').WebContents} webContents
 * @param {string} externalPlayer
 * @param {string} executable
 * @param {string[]} customArgs
 * @returns {Promise<boolean>}
 */
async function confirmCustomArguments(webContents, externalPlayer, executable, customArgs) {
  if (customArgs.length === 0) return true

  const approvalKey = customArgumentsApprovalKey(externalPlayer, customArgs)
  if ((await settings._findOne(EXTERNAL_PLAYER_APPROVED_ARGS_SETTING))?.value === approvalKey) return true

  const t = await createMainTranslator()
  const window = webContents.isDestroyed() ? null : BrowserWindow.fromWebContents(webContents)
  /** @type {import('electron').MessageBoxOptions} */
  const options = {
    type: 'warning',
    title: t('Video.External Player.Confirm Arguments Title'),
    message: t('Video.External Player.Confirm Arguments Message', { externalPlayer }),
    // JSON quotes show spaces and empty arguments exactly as they are passed.
    detail: `${executable}\n${customArgs.map(argument => JSON.stringify(argument)).join('\n')}\n\n${t('Video.External Player.Confirm Arguments Warning')}`,
    buttons: [t('Cancel'), t('Video.External Player.Run')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  if (response !== 1) return false

  await settings.upsert(EXTERNAL_PLAYER_APPROVED_ARGS_SETTING, approvalKey)
  return true
}

async function loadExternalPlayerData() {
  const path = process.env.NODE_ENV === 'development'
    ? '../../static/external-player-map.json'
    : 'static/external-player-map.json'

  const json = JSON.parse(await readFile(join(__dirname, path)))

  for (const entry of json) {
    if (entry.value.length > 0) {
      externalPlayerCmdArgs.set(entry.value, entry.cmdArguments)
    }
  }
}
