import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import { app, BrowserWindow } from 'electron'
import { settings } from '../datastores/handlers/base'
import { isOpenTubeXUrl } from './utils'
import { IpcChannels } from '../constants'

const execFileAsync = promisify(execFile)

/**
 * @typedef YtDlpDownloadPayload
 * @property {string} videoId
 * @property {string} [title] only used for display purposes in the renderer
 * @property {'video' | 'audio' | 'custom'} mode
 * @property {string} [quality] maximum video resolution e.g. '1080'
 * @property {string} [videoFormat] e.g. 'mp4'
 * @property {string} [audioFormat] e.g. 'mp3'
 * @property {string} [customArgs] additional yt-dlp command line arguments
 */

/**
 * @typedef YtDlpDownloadStatus
 * @property {number} id
 * @property {string} videoId
 * @property {string} title
 * @property {'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled'} status
 * @property {number} percent
 * @property {string | null} speed
 * @property {string | null} eta
 * @property {string | null} destination
 * @property {string | null} errorMessage
 */

const ID_REGEX = /^[\w-]{11}$/
const QUALITY_REGEX = /^\d{3,4}$/
const VIDEO_FORMATS = ['mp4']
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac']
const YT_DLP_RELEASE_REPOSITORIES = {
  stable: 'yt-dlp/yt-dlp',
  nightly: 'yt-dlp/yt-dlp-nightly-builds',
  master: 'yt-dlp/yt-dlp-master-builds'
}
const PROGRESS_REGEX = /^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+(\S+))?(?:.*?\bETA\s+(\S+))?/
const DESTINATION_REGEX = /^\[(?:download|ExtractAudio)\] Destination: (.+)$/
const MERGER_REGEX = /^\[Merger\] Merging formats into "(.+)"$/

let downloadCounter = 0

/** @type {Map<number, { child: import('node:child_process').ChildProcess, cancelled: boolean }>} */
const activeDownloads = new Map()
const windowsShownOnce = new WeakSet()

/**
 * Keep first-launch executable checks and downloads from competing with the
 * renderer before its BrowserWindow has been presented.
 * @param {import('electron').WebContents} webContents
 * @returns {Promise<boolean>}
 */
async function waitForFirstWindowShow(webContents) {
  const browserWindow = BrowserWindow.fromWebContents(webContents)
  if (browserWindow === null || browserWindow.isDestroyed()) {
    return false
  }
  if (windowsShownOnce.has(browserWindow)) {
    return true
  }

  if (browserWindow.isVisible()) {
    windowsShownOnce.add(browserWindow)
    return true
  }

  await new Promise(resolve => {
    const finish = () => {
      browserWindow.removeListener('show', finish)
      browserWindow.removeListener('closed', finish)
      resolve()
    }

    browserWindow.once('show', finish)
    browserWindow.once('closed', finish)
  })

  if (!browserWindow.isDestroyed()) {
    windowsShownOnce.add(browserWindow)
    return true
  }

  return false
}

function getManagedBinariesDirectory() {
  return join(app.getPath('userData'), 'yt-dlp')
}

/**
 * @param {'yt-dlp' | 'ffmpeg'} binaryName
 */
function getManagedBinaryPath(binaryName) {
  return join(getManagedBinariesDirectory(), process.platform === 'win32' ? `${binaryName}.exe` : binaryName)
}

/**
 * @param {'ytDlpSource' | 'ytDlpFfmpegSource'} sourceSettingId
 * @param {'ytDlpPath' | 'ytDlpFfmpegPath'} pathSettingId
 * @param {'yt-dlp' | 'ffmpeg'} binaryName
 * @param {'system' | 'managed'} [sourceOverride]
 * @param {string} [pathOverride]
 * @returns {Promise<{ source: 'system' | 'managed', executable: string }>}
 */
async function resolveExecutable(sourceSettingId, pathSettingId, binaryName, sourceOverride, pathOverride) {
  /** @type {'system' | 'managed'} */
  const source = sourceOverride ?? ((await settings._findOne(sourceSettingId))?.value === 'managed' ? 'managed' : 'system')

  if (source === 'managed') {
    return { source, executable: getManagedBinaryPath(binaryName) }
  }

  /** @type {string} */
  const customPath = pathOverride ?? ((await settings._findOne(pathSettingId))?.value || '')

  return { source, executable: customPath === '' ? binaryName : customPath }
}

/**
 * @param {string} executable
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getYtDlpVersion(executable) {
  try {
    const { stdout } = await execFileAsync(executable, ['--version'], { timeout: 10_000, windowsHide: true })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * @param {string} executable
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getFfmpegVersion(executable) {
  try {
    const { stdout } = await execFileAsync(executable, ['-version'], { timeout: 10_000, windowsHide: true })
    const version = /^ffmpeg version (\S+)/.exec(stdout)?.[1] ?? null
    // the martin-riedl.de builds embed their website URL in the version string
    return version?.replace(/-https?:.*$/, '') ?? null
  } catch {
    return null
  }
}

/**
 * @callback BinaryDownloadProgressCallback
 * @param {number | null} percent null when the total size is unknown
 */

/**
 * @typedef BinaryDownloadValidators
 * @property {string | null} etag
 * @property {string | null} lastModified
 * @property {'stable' | 'nightly' | 'master'} [channel]
 */

/**
 * @param {string} url
 * @param {BinaryDownloadProgressCallback | undefined} onProgress
 * @param {(() => void) | undefined} onDownloadStart
 * @param {BinaryDownloadValidators | null} validators
 * @returns {Promise<{ data: Buffer | null, validators: BinaryDownloadValidators }>}
 */
async function downloadFile(url, onProgress, onDownloadStart, validators) {
  const headers = {}
  if (validators?.etag) {
    headers['If-None-Match'] = validators.etag
  }
  if (validators?.lastModified) {
    headers['If-Modified-Since'] = validators.lastModified
  }

  const response = await fetch(url, { headers })

  if (response.status === 304) {
    return { data: null, validators }
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  onDownloadStart?.()

  const contentLength = parseInt(response.headers.get('content-length')) || 0

  /** @type {Buffer[]} */
  const chunks = []
  let receivedBytes = 0
  let lastReportedPercent = -1

  for await (const chunk of response.body) {
    chunks.push(Buffer.from(chunk))
    receivedBytes += chunk.byteLength

    if (contentLength > 0) {
      const percent = Math.min(Math.round((receivedBytes / contentLength) * 100), 100)

      if (percent !== lastReportedPercent) {
        lastReportedPercent = percent
        onProgress?.(percent)
      }
    } else {
      onProgress?.(null)
    }
  }

  return {
    data: Buffer.concat(chunks),
    validators: {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    }
  }
}

/**
 * @param {string} binaryPath
 * @param {'stable' | 'nightly' | 'master'} [channel]
 * @returns {Promise<BinaryDownloadValidators | null>}
 */
async function readDownloadValidators(binaryPath, channel) {
  if (!existsSync(binaryPath)) {
    return null
  }

  try {
    const validators = JSON.parse(await readFile(`${binaryPath}.download.json`, 'utf8'))
    if (channel !== undefined && (validators.channel ?? 'stable') !== channel) {
      return null
    }
    return {
      etag: typeof validators.etag === 'string' ? validators.etag : null,
      lastModified: typeof validators.lastModified === 'string' ? validators.lastModified : null,
      ...(channel === undefined ? {} : { channel })
    }
  } catch {
    return null
  }
}

/**
 * @param {string} binaryPath
 * @param {BinaryDownloadValidators} validators
 * @param {'stable' | 'nightly' | 'master'} [channel]
 */
async function writeDownloadValidators(binaryPath, validators, channel) {
  await writeFile(`${binaryPath}.download.json`, JSON.stringify({
    ...validators,
    ...(channel === undefined ? {} : { channel })
  }))
}

/**
 * Minimal ZIP extractor that reads a single file from an archive.
 * The FFmpeg builds only use stored or deflated entries,
 * so this avoids pulling in a full archive dependency.
 * @param {Buffer} zip
 * @param {(name: string) => boolean} matches
 * @returns {Buffer}
 */
function extractZipEntry(zip, matches) {
  // locate the end of central directory record,
  // which is at the very end of the file apart from an optional comment
  const earliestPossibleOffset = Math.max(zip.length - 65557, 0)
  let eocdOffset = -1
  for (let i = zip.length - 22; i >= earliestPossibleOffset; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid zip file')
  }

  const entryCount = zip.readUInt16LE(eocdOffset + 10)
  let offset = zip.readUInt32LE(eocdOffset + 16)

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      break
    }

    const compressionMethod = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localHeaderOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString('utf-8', offset + 46, offset + 46 + nameLength)

    if (matches(name)) {
      // the name and extra field lengths in the local header can
      // differ from the ones in the central directory, so read them again
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const data = zip.subarray(dataStart, dataStart + compressedSize)

      if (compressionMethod === 8) {
        return inflateRawSync(data)
      } else if (compressionMethod === 0) {
        return Buffer.from(data)
      }

      throw new Error(`Unsupported zip compression method: ${compressionMethod}`)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  throw new Error('Binary not found in the downloaded archive')
}

/**
 * @param {Buffer} data
 * @param {string} destinationPath
 */
async function installBinary(data, destinationPath) {
  await mkdir(getManagedBinariesDirectory(), { recursive: true })

  // write to a temporary file first, so a failed download
  // doesn't corrupt an existing working binary
  const temporaryPath = `${destinationPath}.part`
  await writeFile(temporaryPath, data)

  if (process.platform !== 'win32') {
    await chmod(temporaryPath, 0o755)
  }

  await rename(temporaryPath, destinationPath)
}

/**
 * Downloads the latest yt-dlp release into the user data directory
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string }>}
 */
async function downloadManagedYtDlp(onProgress, onDownloadStart) {
  const configuredChannel = (await settings._findOne('ytDlpChannel'))?.value
  const channel = Object.hasOwn(YT_DLP_RELEASE_REPOSITORIES, configuredChannel) ? configuredChannel : 'stable'
  let assetName
  switch (process.platform) {
    case 'win32':
      assetName = 'yt-dlp.exe'
      break
    case 'darwin':
      assetName = 'yt-dlp_macos'
      break
    default:
      assetName = 'yt-dlp'
  }

  const managedPath = getManagedBinaryPath('yt-dlp')
  let download

  try {
    download = await downloadFile(
      `https://github.com/${YT_DLP_RELEASE_REPOSITORIES[channel]}/releases/latest/download/${assetName}`,
      onProgress,
      onDownloadStart,
      await readDownloadValidators(managedPath, channel)
    )

    if (download.data !== null) {
      await installBinary(download.data, managedPath)
    }
  } catch (error) {
    return { error: error.message }
  }

  const version = await getYtDlpVersion(managedPath)

  if (version === null) {
    return { error: 'The downloaded yt-dlp binary does not work on this system' }
  }

  if (download.data !== null) {
    try {
      await writeDownloadValidators(managedPath, download.validators, channel)
    } catch (error) {
      console.warn('Could not save yt-dlp download metadata', error)
    }
  }

  return { version, updated: download.data !== null }
}

/**
 * Downloads an up-to-date FFmpeg build into the user data directory
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string }>}
 */
async function downloadManagedFfmpeg(onProgress, onDownloadStart) {
  let url
  /** @type {(name: string) => boolean} */
  let matches

  if (process.platform === 'win32') {
    // yt-dlp's own FFmpeg builds, patched for use with yt-dlp,
    // unfortunately they are only extractable without extra dependencies for Windows (zip)
    url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
    matches = (name) => name.endsWith('/bin/ffmpeg.exe')
  } else {
    // daily builds of the latest FFmpeg release for Linux and macOS
    // https://ffmpeg.martin-riedl.de
    const platform = process.platform === 'darwin' ? 'macos' : 'linux'
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
    url = `https://ffmpeg.martin-riedl.de/redirect/latest/${platform}/${arch}/release/ffmpeg.zip`
    matches = (name) => name === 'ffmpeg'
  }

  const managedPath = getManagedBinaryPath('ffmpeg')
  let download

  try {
    download = await downloadFile(url, onProgress, onDownloadStart, await readDownloadValidators(managedPath))

    if (download.data !== null) {
      await installBinary(extractZipEntry(download.data, matches), managedPath)
    }
  } catch (error) {
    return { error: error.message }
  }

  const version = await getFfmpegVersion(managedPath)

  if (version === null) {
    return { error: 'The downloaded FFmpeg binary does not work on this system' }
  }

  if (download.data !== null) {
    try {
      await writeDownloadValidators(managedPath, download.validators)
    } catch (error) {
      console.warn('Could not save FFmpeg download metadata', error)
    }
  }

  return { version, updated: download.data !== null }
}

/**
 * @typedef YtDlpBinaryInfo
 * @property {'system' | 'managed'} source
 * @property {boolean} available
 * @property {string | null} version
 */

/**
 * @param {{ source: 'system' | 'managed', executable: string }} resolved
 * @param {(executable: string) => Promise<string | null>} getVersion
 * @returns {Promise<YtDlpBinaryInfo>}
 */
async function getBinaryInfo(resolved, getVersion) {
  if (resolved.source === 'managed' && !existsSync(resolved.executable)) {
    return { source: resolved.source, available: false, version: null }
  }

  const version = await getVersion(resolved.executable)

  return { source: resolved.source, available: version !== null, version }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {{
 *   ytDlpSource: 'system' | 'managed',
 *   ytDlpPath: string,
 *   ffmpegSource: 'system' | 'managed',
 *   ffmpegPath: string
 * } | undefined} [options]
 * @returns {Promise<{ ytDlp: YtDlpBinaryInfo, ffmpeg: YtDlpBinaryInfo } | null>}
 */
export async function handleYtDlpGetInfo(event, options) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  if (options !== undefined && (
    options === null ||
    typeof options !== 'object' ||
    (options.ytDlpSource !== 'system' && options.ytDlpSource !== 'managed') ||
    typeof options.ytDlpPath !== 'string' ||
    (options.ffmpegSource !== 'system' && options.ffmpegSource !== 'managed') ||
    typeof options.ffmpegPath !== 'string'
  )) {
    return null
  }

  if (!await waitForFirstWindowShow(event.sender)) {
    return null
  }

  const [ytDlp, ffmpeg] = await Promise.all([
    getBinaryInfo(
      await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp', options?.ytDlpSource, options?.ytDlpPath),
      getYtDlpVersion
    ),
    getBinaryInfo(
      await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg', options?.ffmpegSource, options?.ffmpegPath),
      getFfmpegVersion
    )
  ])

  return {
    ytDlp,
    ffmpeg
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<{ version: string, updated: boolean } | { error: string } | null>}
 */
export async function handleYtDlpDownloadBinary(event, binary) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  if (binary !== 'yt-dlp' && binary !== 'ffmpeg') {
    return null
  }

  const webContents = event.sender

  let lastSent = 0

  /**
   * @param {number | null} percent
   * @param {boolean} inProgress
   */
  function sendProgress(percent, inProgress) {
    if (!webContents.isDestroyed()) {
      webContents.send(IpcChannels.YT_DLP_BINARY_DOWNLOAD_PROGRESS, { binary, percent, inProgress })
    }
  }

  /** @type {BinaryDownloadProgressCallback} */
  function onProgress(percent) {
    const now = Date.now()
    if (now - lastSent < 250) {
      return
    }
    lastSent = now

    sendProgress(percent, true)
  }

  let result
  try {
    result = binary === 'yt-dlp'
      ? await downloadManagedYtDlp(onProgress, () => sendProgress(0, true))
      : await downloadManagedFfmpeg(onProgress, () => sendProgress(0, true))
    return result
  } finally {
    sendProgress(result != null && 'version' in result && result.updated ? 100 : null, false)
  }
}

/**
 * Splits a command line argument string into an array of arguments,
 * treating single and double quoted sections as a single argument
 * @param {string} argsString
 * @returns {string[]}
 */
function splitArguments(argsString) {
  const args = []
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g

  let match
  while ((match = tokenRegex.exec(argsString)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3])
  }

  return args
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {YtDlpDownloadPayload} payload
 * @returns {Promise<{ id: number } | { error: string } | null>}
 */
export async function handleYtDlpDownload(event, payload) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) {
    return null
  }

  if (typeof payload !== 'object' || payload === null ||
    typeof payload.videoId !== 'string' || !ID_REGEX.test(payload.videoId)) {
    return null
  }

  const args = ['--newline', '--no-playlist']

  const ffmpeg = await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg')

  if (ffmpeg.source === 'managed') {
    if (!existsSync(ffmpeg.executable)) {
      const result = await downloadManagedFfmpeg()

      if ('error' in result) {
        return { error: result.error }
      }
    }

    args.push('--ffmpeg-location', ffmpeg.executable)
  } else if (ffmpeg.executable !== 'ffmpeg') {
    args.push('--ffmpeg-location', ffmpeg.executable)
  }

  /** @type {string} */
  const downloadFolder = (await settings._findOne('ytDlpDownloadFolderPath'))?.value || app.getPath('downloads')
  args.push('--paths', downloadFolder, '--output', '%(title)s [%(id)s].%(ext)s')

  switch (payload.mode) {
    case 'video':
      if (typeof payload.quality === 'string' && QUALITY_REGEX.test(payload.quality)) {
        args.push('-S', `res:${payload.quality}`)
      }
      if (typeof payload.videoFormat === 'string' && VIDEO_FORMATS.includes(payload.videoFormat)) {
        args.push('--merge-output-format', payload.videoFormat, '--remux-video', payload.videoFormat)
      }
      break
    case 'audio':
      args.push('--extract-audio', '--embed-thumbnail', '--embed-metadata')
      if (typeof payload.audioFormat === 'string' && AUDIO_FORMATS.includes(payload.audioFormat)) {
        args.push('--audio-format', payload.audioFormat)
      }
      break
    case 'custom':
      if (typeof payload.customArgs !== 'string') {
        return null
      }
      args.push(...splitArguments(payload.customArgs))
      break
    default:
      return null
  }

  args.push(`https://www.youtube.com/watch?v=${payload.videoId}`)

  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()

    if ('error' in result) {
      return { error: result.error }
    }
  }

  const id = ++downloadCounter
  const child = spawn(executable, args, { windowsHide: true })
  const entry = { child, cancelled: false }
  activeDownloads.set(id, entry)

  const webContents = event.sender

  /** @type {YtDlpDownloadStatus} */
  const status = {
    id,
    videoId: payload.videoId,
    title: typeof payload.title === 'string' ? payload.title.slice(0, 255) : payload.videoId,
    status: 'downloading',
    percent: 0,
    speed: null,
    eta: null,
    destination: null,
    errorMessage: null
  }

  let lastSent = 0
  let finished = false

  /**
   * @param {boolean} [force]
   */
  function sendStatus(force = false) {
    const now = Date.now()
    if (!force && now - lastSent < 500) {
      return
    }
    lastSent = now

    if (!webContents.isDestroyed()) {
      webContents.send(IpcChannels.YT_DLP_DOWNLOAD_STATUS, { ...status })
    }
  }

  /** @type {string[]} */
  const stderrLines = []

  /**
   * @param {string} line
   */
  function handleStdoutLine(line) {
    const progressMatch = PROGRESS_REGEX.exec(line)
    if (progressMatch) {
      status.status = 'downloading'
      status.percent = parseFloat(progressMatch[1])
      status.speed = progressMatch[2] ?? status.speed
      status.eta = progressMatch[3] ?? status.eta
      sendStatus()
      return
    }

    const destinationMatch = DESTINATION_REGEX.exec(line)
    if (destinationMatch) {
      status.destination = destinationMatch[1]

      if (line.startsWith('[ExtractAudio]')) {
        status.status = 'processing'
      }

      sendStatus(true)
      return
    }

    const mergerMatch = MERGER_REGEX.exec(line)
    if (mergerMatch) {
      status.status = 'processing'
      status.destination = mergerMatch[1]
      sendStatus(true)
    }
  }

  let stdoutBuffer = ''
  child.stdout.setEncoding('utf-8')
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop()
    lines.forEach(handleStdoutLine)
  })

  child.stderr.setEncoding('utf-8')
  child.stderr.on('data', (chunk) => {
    stderrLines.push(...chunk.split(/\r?\n/).filter((line) => line.length > 0))

    // only keep the last few lines for error reporting
    if (stderrLines.length > 5) {
      stderrLines.splice(0, stderrLines.length - 5)
    }
  })

  child.on('error', (error) => {
    if (finished) {
      return
    }
    finished = true

    activeDownloads.delete(id)
    status.status = 'failed'
    status.errorMessage = error.code === 'ENOENT' ? 'ENOENT' : error.message
    sendStatus(true)
  })

  child.on('close', (code) => {
    if (finished) {
      return
    }
    finished = true

    activeDownloads.delete(id)

    if (entry.cancelled) {
      status.status = 'cancelled'
    } else if (code === 0) {
      status.status = 'completed'
      status.percent = 100
    } else {
      status.status = 'failed'
      status.errorMessage = stderrLines.join('\n')
    }

    sendStatus(true)
  })

  return { id }
}

/**
 * @param {import('electron').IpcMainEvent} event
 * @param {number} id
 */
export function handleYtDlpCancelDownload(event, id) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return
  }

  const entry = activeDownloads.get(id)
  if (entry) {
    entry.cancelled = true
    entry.child.kill()
  }
}
