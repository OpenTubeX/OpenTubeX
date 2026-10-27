import { jsRuntimeArguments } from '../ytDlpArguments'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import { app, BrowserWindow, net } from 'electron'
import { settings } from '../datastores/handlers/base'
import { buildProxyUrl, isOpenTubeXUrl } from './utils'
import { IpcChannels } from '../constants'
import { getMatchingDownloadValidators, getYtDlpAssetName } from './ytDlpAsset'
import { verifyYtDlpReleaseAsset } from './ytDlpSignature'

const execFileAsync = promisify(execFile)

const MANAGED_BINARY_UPDATE_CHECK_TIMEOUT_MS = 15_000
const YT_DLP_RELEASE_REPOSITORIES = {
  stable: 'yt-dlp/yt-dlp',
  nightly: 'yt-dlp/yt-dlp-nightly-builds',
  master: 'yt-dlp/yt-dlp-master-builds'
}

let binaryInstallCounter = 0
let managedBinaryInstallQueue = Promise.resolve()
let managedYtDlpUpdateQueue = Promise.resolve()

/** @type {Map<string, AbortController>} */
const getInfoAbortControllers = new Map()

/**
 * Supersede an earlier ytDlpGetInfo for the same probe key. System and managed
 * refreshes use different keys so they can run in parallel on mount.
 * @param {string} key
 * @returns {AbortSignal}
 */
function takeGetInfoAbortSignal(key) {
  getInfoAbortControllers.get(key)?.abort()
  const controller = new AbortController()
  getInfoAbortControllers.set(key, controller)
  return controller.signal
}

export function broadcastToRenderers(channel, payload) {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (!browserWindow.webContents.isDestroyed() && isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(channel, payload)
    }
  }
}

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
 * @param {'yt-dlp' | 'ffmpeg' | 'ffprobe'} binaryName
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
export async function resolveExecutable(sourceSettingId, pathSettingId, binaryName, sourceOverride, pathOverride) {
  /** @type {'system' | 'managed'} */
  const source = sourceOverride ?? ((await settings._findOne(sourceSettingId))?.value === 'managed' ? 'managed' : 'system')

  if (source === 'managed') {
    return { source, executable: getManagedBinaryPath(binaryName) }
  }

  /** @type {string} */
  const customPath = pathOverride ?? ((await settings._findOne(pathSettingId))?.value || '')

  return { source, executable: customPath === '' ? binaryName : customPath }
}

/** Reuse the configured FFmpeg installation for streaming DLNA remuxing. */
export async function getDlnaFfmpegExecutable() {
  const { executable } = await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg')
  if (await getFfmpegVersion(executable) === null) throw new Error('FFmpeg is required to cast separate video and audio tracks')
  return executable
}

/**
 * FFmpeg and FFprobe share one source setting because yt-dlp accepts a single
 * `--ffmpeg-location`. A custom FFmpeg path therefore also locates FFprobe in
 * the same directory.
 * @param {'system' | 'managed'} [sourceOverride]
 * @param {string} [ffmpegPathOverride]
 * @returns {Promise<{ source: 'system' | 'managed', executable: string }>}
 */
export async function resolveFfprobeExecutable(sourceOverride, ffmpegPathOverride) {
  const ffmpeg = await resolveExecutable(
    'ytDlpFfmpegSource',
    'ytDlpFfmpegPath',
    'ffmpeg',
    sourceOverride,
    ffmpegPathOverride
  )

  if (ffmpeg.source === 'managed') {
    return { source: ffmpeg.source, executable: getManagedBinaryPath('ffprobe') }
  }

  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffmpegDirectory = dirname(ffmpeg.executable)
  return {
    source: ffmpeg.source,
    executable: ffmpegDirectory === '.' ? 'ffprobe' : join(ffmpegDirectory, ffprobeName)
  }
}

/**
 * Builds the proxy URL for yt-dlp's `--proxy` argument from the app's proxy settings.
 * @returns {Promise<string | null>} null when the proxy is disabled
 */
async function getProxyUrl() {
  if (!(await settings._findOne('useProxy'))?.value) {
    return null
  }

  return buildProxyUrl({
    protocol: (await settings._findOne('proxyProtocol'))?.value,
    hostname: (await settings._findOne('proxyHostname'))?.value,
    port: (await settings._findOne('proxyPort'))?.value,
    username: (await settings._findOne('proxyUsername'))?.value,
    password: (await settings._findOne('proxyPassword'))?.value
  })
}

/**
 * @param {string[]} args
 */
export async function pushProxyArgument(args) {
  const proxyUrl = await getProxyUrl()

  if (proxyUrl !== null) {
    args.push('--proxy', proxyUrl)
  }
}

/**
 * @param {string} executable
 * @param {string[]} args
 */
export async function prependJsRuntimeArgument(executable, args) {
  // Leading, so a custom --no-js-runtimes later in the command still disables it.
  args.unshift(...jsRuntimeArguments(await getYtDlpVersion(executable), process.execPath))
}

/** Makes `--js-runtimes node:<execPath>` start Electron as plain Node.js. */
export function ytDlpEnvironment() {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
}

/** @type {Map<string, { fileKey: string, version: string }>} */
const ytDlpVersionCache = new Map()
/** @type {Map<string, Promise<string | null>>} */
const pendingYtDlpVersions = new Map()

/**
 * Identifies the file execFile would run so the version cache can tell when
 * the binary changed. A bare name is looked up through PATH like execFile does.
 * @param {string} executable
 * @returns {Promise<string | null>}
 */
async function getExecutableFileKey(executable) {
  const isBareName = !executable.includes('/') && !executable.includes('\\')
  // execFile without a shell tries the exact name and, on Windows, .com/.exe;
  // it does not consult PATHEXT.
  const extensions = process.platform === 'win32' ? ['', '.com', '.exe'] : ['']
  const candidates = isBareName
    ? (process.env.PATH ?? '').split(delimiter).filter(Boolean)
        .flatMap(directory => extensions.map(extension => join(directory, executable + extension)))
    : [executable]

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      return `${candidate}:${info.mtimeMs}:${info.size}`
    } catch {}
  }
  return null
}

/**
 * @param {string} executable
 * @param {AbortSignal} [signal] aborts a superseded ytDlpGetInfo probe
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
export async function getYtDlpVersion(executable, signal) {
  // Playback asks for the version on every request and PyInstaller builds take
  // a moment to answer, so reuse the answer until the binary file changes.
  const fileKey = await getExecutableFileKey(executable)
  const cached = fileKey === null ? undefined : ytDlpVersionCache.get(executable)
  if (cached !== undefined && cached.fileKey === fileKey) {
    return cached.version
  }

  // Concurrent downloads and playback share one probe; an abortable probe keeps its own.
  const pendingKey = `${executable}\0${fileKey}`
  const pending = signal === undefined ? pendingYtDlpVersions.get(pendingKey) : undefined
  if (pending !== undefined) return pending

  const probe = (async () => {
    try {
      // PyInstaller onefile builds extract on first launch; allow time for that on slow disks/VMs
      const { stdout } = await execFileAsync(executable, ['--version'], {
        timeout: 60_000,
        windowsHide: true,
        signal
      })
      const version = stdout.trim()
      if (fileKey !== null) {
        ytDlpVersionCache.set(executable, { fileKey, version })
      }
      return version
    } catch {
      return null
    }
  })()
  if (signal !== undefined) return probe

  pendingYtDlpVersions.set(pendingKey, probe)
  try {
    return await probe
  } finally {
    pendingYtDlpVersions.delete(pendingKey)
  }
}

/**
 * @param {string} helpOutput
 * @returns {string[]}
 */
export function parseYtDlpSupportedBrowsers(helpOutput) {
  const browserList = helpOutput.match(
    /Currently supported browsers are:\s*([\s\S]*?)\s+Optionally,\s+the KEYRING/i
  )?.[1]

  if (browserList === undefined) {
    return []
  }

  const browsers = browserList
    .replaceAll(/\s+/g, ' ')
    .split(',')
    .map(browser => browser.trim())
    .filter(browser => /^[a-z0-9_-]+$/i.test(browser))

  return [...new Set(browsers)]
}

/**
 * Reads the browser names from yt-dlp's own help output so newly supported
 * browsers appear without an OpenTubeX update.
 * @param {string} executable
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function getYtDlpSupportedBrowsers(executable, signal) {
  try {
    const { stdout } = await execFileAsync(executable, ['--help'], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      signal
    })
    return parseYtDlpSupportedBrowsers(stdout)
  } catch {
    return []
  }
}

/**
 * @param {string} executable
 * @param {AbortSignal} [signal] aborts a superseded ytDlpGetInfo probe
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getFfmpegVersion(executable, signal) {
  try {
    const { stdout } = await execFileAsync(executable, ['-version'], {
      timeout: 60_000,
      windowsHide: true,
      signal
    })
    const version = /^ffmpeg version (\S+)/.exec(stdout)?.[1] ?? null
    // the martin-riedl.de builds embed their website URL in the version string
    return version?.replace(/-https?:.*$/, '') ?? null
  } catch {
    return null
  }
}

/**
 * @param {string} executable
 * @param {AbortSignal} [signal] aborts a superseded ytDlpGetInfo probe
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getFfprobeVersion(executable, signal) {
  try {
    const { stdout } = await execFileAsync(executable, ['-version'], {
      timeout: 60_000,
      windowsHide: true,
      signal
    })
    const version = /^ffprobe version (\S+)/.exec(stdout)?.[1] ?? null
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
 * @property {string} [source]
 * @property {'stable' | 'nightly' | 'master'} [channel]
 * @property {number} [signedAt] when yt-dlp signed the installed release, in seconds
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

  // use Electron's net module instead of fetch, so that the download
  // goes through the configured proxy (including its authentication)
  const response = await net.fetch(url, { headers })

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
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function fetchBuffer(url) {
  const response = await net.fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Reads the tag from the `releases/latest` redirect, which unlike GitHub's
 * REST API has no 60 requests per hour limit for unauthenticated clients.
 * @param {string} repository
 * @returns {Promise<string>}
 */
function getLatestReleaseDownloadUrl(repository) {
  return new Promise((resolve, reject) => {
    const failure = managedToolError('MANAGED_TOOL_RELEASE_NOT_FOUND', `Could not find the latest ${repository} release`)
    // Not following the redirect cancels it, so the release page is never downloaded
    const request = net.request({ url: `https://github.com/${repository}/releases/latest`, method: 'HEAD', redirect: 'manual' })
    request.on('redirect', (statusCode, method, redirectUrl) => {
      const prefix = `https://github.com/${repository}/releases/tag/`
      const tag = redirectUrl.startsWith(prefix) ? redirectUrl.slice(prefix.length) : ''
      if (/^[\w.-]+$/.test(tag)) {
        resolve(`https://github.com/${repository}/releases/download/${tag}`)
      } else {
        reject(failure)
      }
    })
    request.on('response', () => reject(failure))
    request.on('error', reject)
    request.end()
  })
}

/**
 * Checks a managed download without transferring its payload.
 * A missing validator means there is no trustworthy installed-release baseline.
 * @param {string} url
 * @param {BinaryDownloadValidators | null} validators
 * @returns {Promise<boolean>}
 */
async function isFileUpdateAvailable(url, validators) {
  if (!validators?.etag && !validators?.lastModified) {
    return false
  }

  const headers = {}
  if (validators.etag) {
    headers['If-None-Match'] = validators.etag
  }
  if (validators.lastModified) {
    headers['If-Modified-Since'] = validators.lastModified
  }

  const response = await net.fetch(url, {
    method: 'HEAD',
    headers,
    signal: AbortSignal.timeout(MANAGED_BINARY_UPDATE_CHECK_TIMEOUT_MS)
  })
  if (response.status === 304) {
    return false
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return true
}

/**
 * @param {string} binaryPath
 * @param {string} source
 * @param {'stable' | 'nightly' | 'master'} [channel]
 * @returns {Promise<BinaryDownloadValidators | null>}
 */
async function readDownloadValidators(binaryPath, source, channel) {
  if (!existsSync(binaryPath)) {
    return null
  }

  try {
    const validators = JSON.parse(await readFile(`${binaryPath}.download.json`, 'utf8'))
    return getMatchingDownloadValidators(validators, source, channel)
  } catch {
    return null
  }
}

/**
 * @param {string} binaryPath
 * @param {BinaryDownloadValidators} validators
 * @param {string} source
 * @param {'stable' | 'nightly' | 'master'} [channel]
 */
async function writeDownloadValidators(binaryPath, validators, source, channel) {
  await writeFile(`${binaryPath}.download.json`, JSON.stringify({
    ...validators,
    source,
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
    throw managedToolError('MANAGED_TOOL_INVALID_ARCHIVE', 'Invalid zip file')
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

      throw managedToolError('MANAGED_TOOL_INVALID_ARCHIVE', `Unsupported zip compression method: ${compressionMethod}`)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  throw managedToolError('MANAGED_TOOL_INVALID_ARCHIVE', 'Binary not found in the downloaded archive')
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
 * Replaces a related set of managed binaries as one transaction. If any
 * replacement fails, every executable that was already replaced is restored.
 * @template T
 * @param {{ data: Buffer, path: string }[]} binaries
 * @param {() => Promise<T>} validate
 * @returns {Promise<T>}
 */
async function performAtomicBinaryInstall(binaries, validate) {
  if (binaries.length === 0) {
    return validate()
  }

  await mkdir(getManagedBinariesDirectory(), { recursive: true })

  const transactionId = `${process.pid}-${++binaryInstallCounter}`
  const entries = binaries.map(binary => ({
    ...binary,
    temporaryPath: `${binary.path}.part-${transactionId}`,
    backupPath: `${binary.path}.backup-${transactionId}`,
    backedUp: false,
    installed: false
  }))

  let result
  try {
    for (const entry of entries) {
      await writeFile(entry.temporaryPath, entry.data)
      if (process.platform !== 'win32') {
        await chmod(entry.temporaryPath, 0o755)
      }
    }

    for (const entry of entries) {
      if (existsSync(entry.path)) {
        await rename(entry.path, entry.backupPath)
        entry.backedUp = true
      }
    }

    for (const entry of entries) {
      await rename(entry.temporaryPath, entry.path)
      entry.installed = true
    }

    result = await validate()
  } catch (error) {
    const rollbackErrors = []
    async function attemptRollback(operation) {
      try {
        await operation()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }

    for (const entry of entries.toReversed()) {
      if (entry.installed) {
        await attemptRollback(() => rm(entry.path, { force: true }))
      }
      if (entry.backedUp) {
        await attemptRollback(() => rename(entry.backupPath, entry.path))
      }
      await attemptRollback(() => rm(entry.temporaryPath, { force: true }))
    }

    if (rollbackErrors.length > 0) {
      throw Object.assign(new AggregateError(
        rollbackErrors,
        'Installing the managed binaries failed and could not be fully rolled back',
        { cause: error }
      ), { code: 'MANAGED_TOOL_ROLLBACK_FAILED' })
    }
    throw error
  }

  const cleanupResults = await Promise.allSettled(entries
    .filter(entry => entry.backedUp)
    .map(entry => rm(entry.backupPath, { force: true })))
  const cleanupErrors = cleanupResults.filter(result => result.status === 'rejected')
  if (cleanupErrors.length > 0) {
    console.warn('Could not remove managed binary backups', cleanupErrors)
  }

  return result
}

/**
 * Prevents concurrent managed downloads from interleaving transactions that
 * replace the same FFmpeg and FFprobe destinations.
 * @template T
 * @param {{ data: Buffer, path: string }[]} binaries
 * @param {() => Promise<T>} validate
 * @returns {Promise<T>}
 */
async function installBinariesAtomically(binaries, validate) {
  const installation = managedBinaryInstallQueue
    .catch(() => {})
    .then(() => performAtomicBinaryInstall(binaries, validate))
  managedBinaryInstallQueue = installation
  return installation
}

/**
 * Downloads the latest yt-dlp release into the user data directory. Updates
 * run one at a time, so each verifies its release against the signing time
 * that the previous update committed and cannot roll it back.
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string, errorCode?: string }>}
 */
export function downloadManagedYtDlp(onProgress, onDownloadStart) {
  const update = managedYtDlpUpdateQueue
    .catch(() => {})
    .then(() => updateManagedYtDlp(onProgress, onDownloadStart))
  managedYtDlpUpdateQueue = update
  return update
}

/**
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string, errorCode?: string }>}
 */
async function updateManagedYtDlp(onProgress, onDownloadStart) {
  const configuredChannel = (await settings._findOne('ytDlpChannel'))?.value
  const channel = Object.hasOwn(YT_DLP_RELEASE_REPOSITORIES, configuredChannel) ? configuredChannel : 'stable'
  const assetName = getYtDlpAssetName(process.platform, process.arch)
  const repository = YT_DLP_RELEASE_REPOSITORIES[channel]
  const source = `https://github.com/${repository}/releases/latest/download/${assetName}`

  const managedPath = getManagedBinaryPath('yt-dlp')
  let download

  try {
    // fetch the binary and its signed checksums from the same release,
    // even if a newer one is published in between
    const releaseUrl = await getLatestReleaseDownloadUrl(repository)
    const validators = await readDownloadValidators(managedPath, source, channel)
    download = await downloadFile(`${releaseUrl}/${assetName}`, onProgress, onDownloadStart, validators)

    if (download.data !== null) {
      const [checksums, signature] = await Promise.all([
        fetchBuffer(`${releaseUrl}/SHA2-256SUMS`),
        fetchBuffer(`${releaseUrl}/SHA2-256SUMS.sig`)
      ])
      download.validators.signedAt = verifyYtDlpReleaseAsset(
        download.data, assetName, checksums, signature, validators?.signedAt
      )
      await installBinary(download.data, managedPath)
    }
  } catch (error) {
    return toErrorResult(error)
  }

  const version = await getYtDlpVersion(managedPath)

  if (version === null) {
    return toErrorResult(unusableBinaryError('yt-dlp', managedPath))
  }

  if (download.data !== null) {
    try {
      await writeDownloadValidators(managedPath, download.validators, source, channel)
    } catch (error) {
      console.warn('Could not save yt-dlp download metadata', error)
    }
    broadcastToRenderers(IpcChannels.YT_DLP_BINARY_UPDATED)
  }

  return { version, updated: download.data !== null }
}

/**
 * Explains why a downloaded binary failed its version check. Antivirus
 * software often quarantines new executables or blocks them from running.
 * @param {string} name
 * @param {string} path
 * @returns {Error}
 */
function unusableBinaryError(name, path) {
  return existsSync(path)
    ? managedToolError('MANAGED_TOOL_UNUSABLE', `The downloaded ${name} binary could not be run`)
    : managedToolError('MANAGED_TOOL_REMOVED', `The downloaded ${name} binary was removed`)
}

/**
 * Keeps the English message for logs and network failure detection while the
 * code lets the renderer translate known failures.
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function managedToolError(code, message) {
  return Object.assign(new Error(message), { code })
}

/**
 * @param {Error & { code?: unknown }} error
 * @returns {{ error: string, errorCode?: string }}
 */
function toErrorResult(error) {
  return typeof error.code === 'string'
    ? { error: error.message, errorCode: error.code }
    : { error: error.message }
}

/**
 * Downloads up-to-date FFmpeg and FFprobe builds into the user data directory.
 * They are kept together because yt-dlp locates both through one
 * `--ffmpeg-location` argument.
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string, errorCode?: string }>}
 */
export async function downloadManagedFfmpeg(onProgress, onDownloadStart) {
  const ffmpegPath = getManagedBinaryPath('ffmpeg')
  const ffprobePath = getManagedBinaryPath('ffprobe')
  const pendingValidatorWrites = []
  const pendingInstalls = []

  if (process.platform === 'win32') {
    // yt-dlp's own FFmpeg builds, patched for use with yt-dlp,
    // unfortunately they are only extractable without extra dependencies for Windows (zip)
    const url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'

    try {
      // Existing FFmpeg-only installations must fetch the archive again so
      // FFprobe can be added even when its validators would return 304.
      const validators = existsSync(ffprobePath)
        ? await readDownloadValidators(ffmpegPath, url)
        : null
      const download = await downloadFile(url, onProgress, onDownloadStart, validators)

      if (download.data !== null) {
        pendingInstalls.push(
          { data: extractZipEntry(download.data, name => name.endsWith('/bin/ffmpeg.exe')), path: ffmpegPath },
          { data: extractZipEntry(download.data, name => name.endsWith('/bin/ffprobe.exe')), path: ffprobePath }
        )
        pendingValidatorWrites.push(
          { path: ffmpegPath, validators: download.validators, url },
          { path: ffprobePath, validators: download.validators, url }
        )
      }
    } catch (error) {
      return toErrorResult(error)
    }
  } else {
    // daily builds of the latest FFmpeg release for Linux and macOS
    // https://ffmpeg.martin-riedl.de
    const platform = process.platform === 'darwin' ? 'macos' : 'linux'
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
    const binaries = [
      { name: 'ffmpeg', path: ffmpegPath },
      { name: 'ffprobe', path: ffprobePath }
    ]
    try {
      for (const [index, binary] of binaries.entries()) {
        const url = `https://ffmpeg.martin-riedl.de/redirect/latest/${platform}/${arch}/release/${binary.name}.zip`
        const download = await downloadFile(
          url,
          percent => onProgress?.(percent === null ? null : Math.round((index * 100 + percent) / binaries.length)),
          onDownloadStart,
          await readDownloadValidators(binary.path, url)
        )

        if (download.data !== null) {
          pendingInstalls.push({
            data: extractZipEntry(download.data, name => name === binary.name),
            path: binary.path
          })
          pendingValidatorWrites.push({ path: binary.path, validators: download.validators, url })
        }
      }
    } catch (error) {
      return toErrorResult(error)
    }
  }

  let version
  try {
    version = await installBinariesAtomically(pendingInstalls, async () => {
      const [ffmpegVersion, ffprobeVersion] = await Promise.all([
        getFfmpegVersion(ffmpegPath),
        getFfprobeVersion(ffprobePath)
      ])

      if (ffmpegVersion === null) {
        throw unusableBinaryError('FFmpeg', ffmpegPath)
      }
      if (ffprobeVersion === null) {
        throw unusableBinaryError('FFprobe', ffprobePath)
      }

      return ffmpegVersion
    })
  } catch (error) {
    return toErrorResult(error)
  }

  try {
    await Promise.all(pendingValidatorWrites.map(({ path, validators, url }) =>
      writeDownloadValidators(path, validators, url)))
  } catch (error) {
    console.warn('Could not save FFmpeg and FFprobe download metadata', error)
  }

  return { version, updated: pendingInstalls.length > 0 }
}

/**
 * Checks whether the selected managed binary has a newer remote asset.
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<boolean>}
 */
async function isManagedBinaryUpdateAvailable(binary) {
  if (binary === 'yt-dlp') {
    const configuredChannel = (await settings._findOne('ytDlpChannel'))?.value
    const channel = Object.hasOwn(YT_DLP_RELEASE_REPOSITORIES, configuredChannel) ? configuredChannel : 'stable'
    const assetName = getYtDlpAssetName(process.platform, process.arch)
    const source = `https://github.com/${YT_DLP_RELEASE_REPOSITORIES[channel]}/releases/latest/download/${assetName}`
    const managedPath = getManagedBinaryPath('yt-dlp')
    return isFileUpdateAvailable(source, await readDownloadValidators(managedPath, source, channel))
  }

  const ffmpegPath = getManagedBinaryPath('ffmpeg')
  if (process.platform === 'win32') {
    const url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
    return isFileUpdateAvailable(url, await readDownloadValidators(ffmpegPath, url))
  }

  const platform = process.platform === 'darwin' ? 'macos' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  for (const binaryName of ['ffmpeg', 'ffprobe']) {
    const url = `https://ffmpeg.martin-riedl.de/redirect/latest/${platform}/${arch}/release/${binaryName}.zip`
    const binaryPath = getManagedBinaryPath(binaryName)
    if (await isFileUpdateAvailable(url, await readDownloadValidators(binaryPath, url))) {
      return true
    }
  }

  return false
}

/**
 * @typedef YtDlpBinaryInfo
 * @property {'system' | 'managed'} source
 * @property {boolean} available
 * @property {string | null} version
 */

/**
 * @typedef {YtDlpBinaryInfo & { supportedBrowsers: string[] }} YtDlpInfo
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
 * @param {{ source: 'system' | 'managed', executable: string }} resolved
 * @param {AbortSignal} signal
 * @returns {Promise<YtDlpInfo>}
 */
async function getYtDlpInfo(resolved, signal) {
  if (resolved.source === 'managed' && !existsSync(resolved.executable)) {
    return { source: resolved.source, available: false, version: null, supportedBrowsers: [] }
  }

  const [version, supportedBrowsers] = await Promise.all([
    getYtDlpVersion(resolved.executable, signal),
    getYtDlpSupportedBrowsers(resolved.executable, signal)
  ])

  return {
    source: resolved.source,
    available: version !== null,
    version,
    supportedBrowsers
  }
}

/**
 * @param {{
 *   ytDlpSource: 'system' | 'managed',
 *   ytDlpPath: string,
 *   ffmpegSource: 'system' | 'managed',
 *   ffmpegPath: string
 * } | undefined} options
 * @returns {string}
 */
function getInfoProbeKey(options) {
  if (options === undefined) {
    return 'startup'
  }

  return `${options.ytDlpSource}:${options.ffmpegSource}`
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {{
 *   ytDlpSource: 'system' | 'managed',
 *   ytDlpPath: string,
 *   ffmpegSource: 'system' | 'managed',
 *   ffmpegPath: string
 * } | undefined} [options]
 * @returns {Promise<{ ytDlp: YtDlpInfo, ffmpeg: YtDlpBinaryInfo, ffprobe: YtDlpBinaryInfo } | null>}
 */
export async function handleYtDlpGetInfo(event, options) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  // The startup check (called without options) downloads the managed binaries
  // when they are missing, which would hit the network and show the download
  // progress bar during E2E runs.
  if (options === undefined && process.env.OPENTUBEX_E2E_USER_DATA_DIR) {
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

  // Abort superseded probes for this key (e.g. rapid path edits) so the longer
  // PyInstaller cold-start timeout cannot accumulate children. System vs managed
  // use different keys and stay concurrent.
  const probeKey = getInfoProbeKey(options)
  const signal = takeGetInfoAbortSignal(probeKey)

  try {
    const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
      getYtDlpInfo(
        await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp', options?.ytDlpSource, options?.ytDlpPath),
        signal
      ),
      getBinaryInfo(
        await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg', options?.ffmpegSource, options?.ffmpegPath),
        (executable) => getFfmpegVersion(executable, signal)
      ),
      getBinaryInfo(
        await resolveFfprobeExecutable(options?.ffmpegSource, options?.ffmpegPath),
        (executable) => getFfprobeVersion(executable, signal)
      )
    ])

    if (signal.aborted) {
      return null
    }

    return {
      ytDlp,
      ffmpeg,
      ffprobe
    }
  } finally {
    if (getInfoAbortControllers.get(probeKey)?.signal === signal) {
      getInfoAbortControllers.delete(probeKey)
    }
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<{ available: boolean } | { error: string } | null>}
 */
export async function handleYtDlpCheckBinaryUpdate(event, binary) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || (binary !== 'yt-dlp' && binary !== 'ffmpeg')) {
    return null
  }

  try {
    return { available: await isManagedBinaryUpdateAvailable(binary) }
  } catch (error) {
    return { error: error.message }
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<{ version: string, updated: boolean } | { error: string, errorCode?: string } | null>}
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
    const updated = result != null && 'version' in result && result.updated
    sendProgress(updated ? 100 : null, false)
  }
}
