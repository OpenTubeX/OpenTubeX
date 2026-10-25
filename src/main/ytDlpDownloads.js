import {
  buildYtDlpDownloadArguments, ID_REGEX, PLAYLIST_ID_REGEX, DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT,
  SUBTITLE_FORMATS, MAX_LOCAL_PLAYLIST_VIDEOS, isDeniedCustomArgument, splitArguments, isYtDlpMediaUrl,
} from '../ytDlpArguments'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, powerMonitor, shell } from 'electron'
import { settings } from '../datastores/handlers/base'
import { isOpenTubeXUrl } from './utils'
import { IpcChannels } from '../constants'
import { shouldUseGioTrash } from './trashPlatform'
import {
  compareQueuedDownloads,
  normalizeDownloadBandwidth,
  normalizeDownloadConcurrency,
  resumePendingDownload,
  updatePendingDownloadStatuses,
} from './downloadQueue'
import {
  broadcastToRenderers,
  downloadManagedFfmpeg,
  downloadManagedYtDlp,
  prependJsRuntimeArgument,
  pushProxyArgument,
  resolveExecutable,
  resolveFfprobeExecutable,
  ytDlpEnvironment,
} from './ytDlpBinaries'
import { pushYtDlpPlaybackAuthenticationArguments } from './ytDlpPlayback'
import { authorizeAutomaticDownload, showAutomaticDownloadNotification } from './ytDlpAutomaticDownloads'

const execFileAsync = promisify(execFile)

/**
 * @typedef YtDlpDownloadPayload
 * @property {string} videoId
 * @property {string} [externalUrl] web media URL to download instead of a YouTube video ID
 * @property {string[]} [videoIds]
 * @property {string} [playlistId]
 * @property {string} [playlistKey] stable playlist identity used only by the renderer
 * @property {boolean} [isPlaylist]
 * @property {string} [title] only used for display purposes in the renderer
 * @property {string} [thumbnail] only used for display purposes in the renderer
 * @property {'video' | 'audio' | 'subtitles' | 'custom'} mode
 * @property {string} [quality] maximum video resolution e.g. '1080'
 * @property {string} [videoFormat] e.g. 'mp4'
 * @property {string} [audioFormat] e.g. 'mp3'
 * @property {string} [videoCodec]
 * @property {string} [filenameTemplate]
 * @property {string} [startTime]
 * @property {string} [endTime]
 * @property {boolean} [splitChapters]
 * @property {boolean} [removeSponsorblock]
 * @property {string[]} [sponsorBlockCategories]
 * @property {boolean} [includeSubtitles]
 * @property {boolean} [embedSubtitles]
 * @property {string} [subtitleLanguages]
 * @property {string} [subtitleFormat] e.g. 'srt'
 * @property {boolean} [embedThumbnail]
 * @property {boolean} [embedMetadata]
 * @property {string} [customArgs] additional yt-dlp command line arguments
 * @property {number} [estimatedSizeBytes] estimated output size when the caller has format metadata
 * @property {string} [template] the template the options came from, only used for display purposes
 * @property {boolean} [automatic] whether a subscription refresh started the download
 * @property {string} [channelId] channel whose persisted rule authorized the automatic download
 * @property {'video' | 'short' | 'livestream'} [automaticMediaType]
 * @property {string} [refreshOwnerTabId] logical tab that owns the subscription refresh
 * @property {number} [minDurationSeconds]
 * @property {number} [maxDurationSeconds]
 * @property {number} [minFileSizeMb]
 * @property {number} [maxFileSizeMb]
 * @property {number} [maxAgeDays]
 * @property {{ startedTitle?: string, startedBody?: string, completedTitle?: string, completedBody?: string, failedTitle?: string, failedBody?: string }} [notification]
 */

/**
 * @typedef YtDlpDownloadStatus
 * @property {number} id
 * @property {string} videoId
 * @property {string} playlistId
 * @property {string} playlistKey
 * @property {string} title
 * @property {string} thumbnail
 * @property {'video' | 'audio' | 'subtitles' | 'custom'} mode
 * @property {string} template
 * @property {boolean} [automatic]
 * @property {YtDlpDownloadPayload} [retryPayload]
 * @property {'queued' | 'preparing' | 'downloading' | 'processing' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'skipped'} status
 * @property {number} queuePosition
 * @property {'unmetered' | 'charging' | null} [waitingFor] unmet automatic download requirement
 * @property {boolean} [started]
 * @property {number} percent
 * @property {string | null} speed
 * @property {string | null} eta
 * @property {string | null} destination
 * @property {string[]} destinations
 * @property {{ videoId: string, path: string, title?: string, author?: string, authorId?: string, duration?: number, width?: number, height?: number, available?: boolean }[]} [files]
 * @property {'available' | 'partial' | 'missing'} [availability]
 * @property {number} [availableDestinationCount]
 * @property {number} [destinationCount]
 * @property {number} [sizeBytes]
 * @property {number} [completedAt] Unix timestamp in milliseconds
 * @property {boolean} [titleTruncated]
 * @property {number} [estimatedSizeBytes]
 * @property {number} [availableSpaceBytes]
 * @property {'unknown-estimate' | 'space-check-unavailable' | null} [spaceWarning]
 * @property {string | null} errorMessage
 */

const PROGRESS_REGEX = /^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+(\S+))?(?:.*?\bETA\s+(\S+))?/
const DESTINATION_REGEX = /^\[(?:download|ExtractAudio)\] Destination: (.+)$/
const MERGER_REGEX = /^\[Merger\] Merging formats into "(.+)"$/
// yt-dlp doesn't include subtitle files in its `after_move:%(filepath)s` output
const SUBTITLE_DESTINATION_REGEX = /^\[info\] Writing video subtitles to: (.+)$/
const FINAL_PATH_PREFIX = '__OPENTUBEX_FILE__:'
const FINAL_METADATA_PREFIX = '__OPENTUBEX_METADATA__:'

let downloadCounter = 0
let downloadQueuePositionCounter = 0
let downloadRecordsSaveQueue = Promise.resolve()
const retryingDownloadIds = new Set()
let downloadQueueDrainRunning = false
let downloadQueueDrainRequested = false
let runningDownloadCount = 0
let persistedDownloadQueueRestorePromise = null
let shuttingDownDownloads = false
let downloadQueuePaused = false
let downloadQueuePauseAllRequested = false
let powerSourceListenersAdded = false
/** @type {NodeJS.Timeout | null} */
let powerSourcePollTimer = null

/** @type {Map<number, { child: import('node:child_process').ChildProcess, cancelled: boolean, paused: boolean, restarting: boolean, restartStatus: 'queued' | 'paused' }>} */
const activeDownloads = new Map()
/** @type {Map<number, YtDlpDownloadStatus>} */
const downloadRecords = new Map()
/** @type {Map<number, (permitted: boolean) => void>} */
const queuedDownloadWaiters = new Map()
const individuallyResumedDownloadIds = new Set()
/** @type {Promise<void> | null} */
let downloadRecordsLoadPromise = null

function getDownloadRecordsPath() {
  return join(app.getPath('userData'), 'downloads.json')
}

function broadcastDownloadStatus(record) {
  broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOAD_STATUS, { ...record })
}

function setPendingDownloadStatus(status) {
  const pendingIds = status === 'paused'
    ? [...queuedDownloadWaiters.keys()].filter(id => !individuallyResumedDownloadIds.has(id))
    : queuedDownloadWaiters.keys()
  const updated = updatePendingDownloadStatuses(
    downloadRecords,
    pendingIds,
    status
  )
  for (const record of updated) {
    broadcastDownloadStatus(record)
  }
  return updated
}

async function getDownloadQueueSettings() {
  const concurrency = await settings._findOne('ytDlpMaxConcurrentDownloads')
  return {
    concurrency: normalizeDownloadConcurrency(concurrency?.value),
  }
}

/**
 * Electron cannot detect metered connections, so charging is the only
 * automatic download requirement on desktop.
 * @returns {Promise<'charging' | null>}
 */
async function getAutomaticDownloadWaitingFor() {
  const requireCharging = await settings._findOne('ytDlpAutomaticDownloadsRequireCharging')
  return requireCharging?.value === true && powerMonitor.isOnBatteryPower() ? 'charging' : null
}

function watchPowerSource(waiting) {
  const drain = () => requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
  if (waiting && !powerSourceListenersAdded) {
    powerSourceListenersAdded = true
    powerMonitor.on('on-ac', drain)
    powerMonitor.on('on-battery', drain)
  }
  // Power source events are not emitted on every platform.
  if (waiting && powerSourcePollTimer === null) {
    powerSourcePollTimer = setInterval(drain, 60_000)
    powerSourcePollTimer.unref()
  } else if (!waiting && powerSourcePollTimer !== null) {
    clearInterval(powerSourcePollTimer)
    powerSourcePollTimer = null
  }
}

async function drainDownloadQueue() {
  if (shuttingDownDownloads) return
  const queueSettings = await getDownloadQueueSettings()
  const automaticWaitingFor = await getAutomaticDownloadWaitingFor()

  let waiting = false
  for (const id of queuedDownloadWaiters.keys()) {
    const record = downloadRecords.get(id)
    if (record?.status !== 'queued') continue
    const waitingFor = record.automatic === true ? automaticWaitingFor : null
    waiting ||= waitingFor !== null
    if ((record.waitingFor ?? null) !== waitingFor) {
      record.waitingFor = waitingFor
      broadcastDownloadStatus(record)
    }
  }
  watchPowerSource(waiting)

  while (runningDownloadCount < queueSettings.concurrency) {
    const next = [...queuedDownloadWaiters.keys()]
      .map(id => downloadRecords.get(id))
      .filter(record => record?.status === 'queued' && !record.waitingFor && (
        !downloadQueuePaused || individuallyResumedDownloadIds.has(record.id)
      ))
      .sort(compareQueuedDownloads)[0]
    if (!next) return

    const resolve = queuedDownloadWaiters.get(next.id)
    queuedDownloadWaiters.delete(next.id)
    runningDownloadCount++
    resolve?.(true)
  }
}

async function requestDownloadQueueDrain() {
  downloadQueueDrainRequested = true
  if (downloadQueueDrainRunning) return
  downloadQueueDrainRunning = true
  try {
    while (downloadQueueDrainRequested) {
      downloadQueueDrainRequested = false
      await drainDownloadQueue()
    }
  } finally {
    downloadQueueDrainRunning = false
  }
}

function waitForDownloadSlot(id) {
  return new Promise(resolve => {
    queuedDownloadWaiters.set(id, resolve)
    if (downloadQueuePaused && setPendingDownloadStatus('paused').length > 0) {
      saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
    }
    requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
  })
}

function cancelQueuedDownload(id) {
  const resolve = queuedDownloadWaiters.get(id)
  if (!resolve) return false
  queuedDownloadWaiters.delete(id)
  individuallyResumedDownloadIds.delete(id)
  resolve(false)
  return true
}

function releaseDownloadSlot() {
  runningDownloadCount = Math.max(0, runningDownloadCount - 1)
  requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
}

function loadDownloadRecords() {
  downloadRecordsLoadPromise ??= (async () => {
    try {
      const records = JSON.parse(await readFile(getDownloadRecordsPath(), 'utf8'))
      if (!Array.isArray(records)) return
      for (const record of records) {
        if (Number.isInteger(record?.id) && typeof record.title === 'string' &&
          ['queued', 'paused', 'completed', 'failed', 'cancelled', 'skipped'].includes(record.status)) {
          const normalizedRecord = {
            ...record,
            queuePosition: Number.isFinite(record.queuePosition) ? record.queuePosition : record.id,
          }
          if (!downloadRecords.has(record.id)) downloadRecords.set(record.id, normalizedRecord)
          downloadCounter = Math.max(downloadCounter, record.id)
          downloadQueuePositionCounter = Math.max(downloadQueuePositionCounter, normalizedRecord.queuePosition)
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load download history', error)
    }
  })()
  return downloadRecordsLoadPromise
}

function hasAutomaticDownloadRecord(videoId) {
  return [...downloadRecords.values()].some(record => (
    record.videoId === videoId && ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused', 'completed', 'skipped'].includes(record.status)
  ))
}

function saveDownloadRecords() {
  downloadRecordsSaveQueue = downloadRecordsSaveQueue
    .catch(() => {})
    .then(async () => {
      const records = [...downloadRecords.values()]
        .map(record => ['preparing', 'downloading', 'processing', 'pausing'].includes(record.status)
          ? { ...record, status: record.status === 'pausing' ? 'paused' : 'queued', speed: null, eta: null }
          : record)
        .slice(-200)
      // Write atomically so a crash mid-write cannot wipe the download history
      // and reset the id counter.
      const path = getDownloadRecordsPath()
      const temporaryPath = `${path}.tmp`
      await writeFile(temporaryPath, JSON.stringify(records), 'utf8')
      await rename(temporaryPath, path)
    })
  return downloadRecordsSaveQueue
}

export function flushYtDlpDownloadRecords() {
  return downloadRecordsSaveQueue
}

export async function shutdownYtDlpDownloads() {
  shuttingDownDownloads = true
  const downloads = [...activeDownloads.values()]
  const settled = downloads.map(({ child }) => new Promise((resolve) => {
    child.once('close', resolve)
    child.once('error', resolve)
  }))

  for (const [id, entry] of activeDownloads) {
    entry.restarting = true
    const record = downloadRecords.get(id)
    entry.restartStatus = record && ['paused', 'pausing'].includes(record.status) ? 'paused' : 'queued'
    if (entry.paused) entry.child.kill('SIGCONT')
    entry.child.kill()
  }

  await Promise.allSettled(settled)
  await saveDownloadRecords()
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {YtDlpDownloadPayload} incomingPayload
 * @param {boolean} automaticDownloadAuthorized
 * @param {boolean} [automaticDiscoveryPreviouslyAuthorized]
 * @param {(result: { id: number }) => void} [onQueued]
 * @param {boolean} [previouslyAccepted]
 * @returns {Promise<{ id: number } | { error: string } | { skipped: string } | null>}
 */
async function startYtDlpDownload(
  event,
  incomingPayload,
  automaticDownloadAuthorized,
  automaticDiscoveryPreviouslyAuthorized = false,
  onQueued,
  previouslyAccepted = false
) {
  if ((!previouslyAccepted && !isOpenTubeXUrl(event?.senderFrame.url)) ||
    typeof incomingPayload !== 'object' || incomingPayload === null) {
    return null
  }

  const payload = previouslyAccepted
    ? incomingPayload
    : incomingPayload.automatic === true && automaticDownloadAuthorized
      ? await authorizeAutomaticDownload(incomingPayload, automaticDiscoveryPreviouslyAuthorized)
      : incomingPayload.automatic === true ? null : incomingPayload
  if (payload === null || (!previouslyAccepted && payload.automatic !== true && !event.sender.isFocused())) {
    return null
  }

  if ((await settings._findOne('enableDownloads'))?.value === false) {
    return { error: 'downloads-disabled' }
  }

  if (!['video', 'audio', 'subtitles', 'custom'].includes(payload.mode)) {
    return null
  }

  const subtitlesOnly = payload.mode === 'subtitles'
  const subtitleFormat = typeof payload.subtitleFormat === 'string' && SUBTITLE_FORMATS.includes(payload.subtitleFormat)
    ? payload.subtitleFormat
    : ''

  const globalCustomArgsSetting = (await settings._findOne('ytDlpDownloadCustomArgs'))?.value
  const globalCustomArgs = typeof globalCustomArgsSetting === 'string' && globalCustomArgsSetting.trim() !== ''
    ? splitArguments(globalCustomArgsSetting)
    : []
  const customArgs = typeof payload.customArgs === 'string' && payload.customArgs.trim() !== ''
    ? splitArguments(payload.customArgs)
    : []
  if ([...globalCustomArgs, ...customArgs].some(isDeniedCustomArgument)) {
    return { error: 'unsupported-custom-argument' }
  }

  if (payload.videoIds !== undefined && (!Array.isArray(payload.videoIds) ||
    payload.videoIds.some(videoId => typeof videoId !== 'string' || !ID_REGEX.test(videoId)))) {
    return { error: 'invalid-video-ids' }
  }

  const videoIds = Array.isArray(payload.videoIds)
    ? payload.videoIds
    : []
  if (videoIds.length > MAX_LOCAL_PLAYLIST_VIDEOS) {
    return { error: 'too-many-videos' }
  }
  const isRemotePlaylist = payload.isPlaylist === true && typeof payload.playlistId === 'string' &&
    PLAYLIST_ID_REGEX.test(payload.playlistId)
  const isSingleVideo = typeof payload.videoId === 'string' && ID_REGEX.test(payload.videoId)

  const isExternalMedia = payload.externalUrl !== undefined
  if (isExternalMedia && (!isYtDlpMediaUrl(payload.externalUrl) || payload.automatic === true || payload.isPlaylist === true || isSingleVideo || videoIds.length > 0)) {
    return { error: 'invalid-media-url' }
  }
  if (!isExternalMedia && !isRemotePlaylist && !isSingleVideo && videoIds.length === 0) {
    return null
  }

  await loadDownloadRecords()

  if (payload.automatic === true && isSingleVideo && hasAutomaticDownloadRecord(payload.videoId)) {
    return { skipped: 'already-downloaded' }
  }

  const args = [
    '--newline',
    '--progress',
    '--print',
    `after_move:${FINAL_PATH_PREFIX}%(id)s\t%(duration)s\t%(width)s\t%(height)s\t%(filepath)s`,
    '--print',
    `${subtitlesOnly ? 'video' : 'after_move'}:${FINAL_METADATA_PREFIX}%(id)j\t%(title)j\t%(thumbnail|null)j\t%(channel,uploader|null)j\t%(channel_id|null)j`
  ]

  await pushProxyArgument(args)
  args.push(...globalCustomArgs)

  const ffmpeg = await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg')

  if (ffmpeg.source === 'managed') {
    const ffprobe = await resolveFfprobeExecutable()
    if (!existsSync(ffmpeg.executable) || !existsSync(ffprobe.executable)) {
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
  const { args: downloadArgs, truncatesLongTitles } = buildYtDlpDownloadArguments(payload)
  args.push('--paths', downloadFolder, ...downloadArgs)

  if (!isExternalMedia && ((await settings._findOne('ytDlpPlaybackAlwaysUseCookies'))?.value === true ||
    (await settings._findOne('ytDlpDownloadUseCookies'))?.value === true) &&
    (await settings._findOne('ytDlpPlaybackAuthMode'))?.value !== 'none') {
    const authenticationError = await pushYtDlpPlaybackAuthenticationArguments(args)
    if (authenticationError !== null) return { error: authenticationError }
  }

  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()

    if ('error' in result) {
      return { error: result.error }
    }
  }
  await prependJsRuntimeArgument(executable, args)

  // Authorization and executable setup contain awaits, so another refresh can
  // start the same video after the initial fast-path check above.
  if (payload.automatic === true && isSingleVideo && hasAutomaticDownloadRecord(payload.videoId)) {
    return { skipped: 'already-downloaded' }
  }

  const id = ++downloadCounter
  /** @type {YtDlpDownloadStatus} */
  const status = {
    id,
    videoId: isSingleVideo ? payload.videoId : '',
    playlistId: typeof payload.playlistId === 'string' ? payload.playlistId.slice(0, 128) : '',
    playlistKey: typeof payload.playlistKey === 'string' ? payload.playlistKey.slice(0, 255) : '',
    title: typeof payload.title === 'string'
      ? payload.title.slice(0, 255)
      : (isSingleVideo ? payload.videoId : isRemotePlaylist ? payload.playlistId : ''),
    thumbnail: typeof payload.thumbnail === 'string' ? payload.thumbnail.slice(0, 2048) : '',
    mode: payload.mode,
    template: typeof payload.template === 'string' ? payload.template.slice(0, 255) : '',
    automatic: payload.automatic === true,
    retryPayload: structuredClone(payload),
    status: downloadQueuePaused ? 'paused' : 'queued',
    started: false,
    queuePosition: ++downloadQueuePositionCounter,
    percent: 0,
    speed: null,
    eta: null,
    destination: null,
    destinations: [],
    files: [],
    titleTruncated: false,
    estimatedSizeBytes: Number.isSafeInteger(payload.estimatedSizeBytes) && payload.estimatedSizeBytes > 0
      ? payload.estimatedSizeBytes
      : undefined,
    availableSpaceBytes: undefined,
    spaceWarning: null,
    errorMessage: null
  }
  downloadRecords.set(id, status)

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

    broadcastDownloadStatus(status)
  }

  sendStatus(true)
  await saveDownloadRecords()
  onQueued?.({ id })

  if (!await waitForDownloadSlot(id)) {
    return { id }
  }

  // Keep post-processing inputs away from completed files with the same title
  // and video ID. Put the isolated directory beside the completed files so a
  // sandbox's capacity-limited runtime directory does not hold the media data.
  // Audio extraction otherwise reuses and then deletes an existing video file
  // when both variants have the same source extension.
  let temporaryDownloadFolder
  try {
    temporaryDownloadFolder = await mkdtemp(join(downloadFolder, '.opentubex-download-'))
  } catch {
    try {
      temporaryDownloadFolder = await mkdtemp(join(app.getPath('temp'), 'opentubex-download-'))
    } catch (error) {
      individuallyResumedDownloadIds.delete(id)
      status.status = 'failed'
      status.errorMessage = error.code === 'ENOENT' ? 'ENOENT' : error.message
      sendStatus(true)
      releaseDownloadSlot()
      await saveDownloadRecords()
      return { id }
    }
  }
  args.push('--paths', `temp:${temporaryDownloadFolder}`)

  try {
    const fileSystem = await statfs(downloadFolder)
    status.availableSpaceBytes = fileSystem.bavail * fileSystem.bsize
    if (status.estimatedSizeBytes === undefined) {
      status.spaceWarning = 'unknown-estimate'
    } else if (status.availableSpaceBytes < status.estimatedSizeBytes) {
      individuallyResumedDownloadIds.delete(id)
      status.status = 'failed'
      status.errorMessage = 'INSUFFICIENT_SPACE'
      sendStatus(true)
      releaseDownloadSlot()
      await rm(temporaryDownloadFolder, { recursive: true, force: true })
      await saveDownloadRecords()
      return { id }
    }
  } catch {
    status.spaceWarning = 'space-check-unavailable'
  }

  async function abortQueuedPreparation(error) {
    individuallyResumedDownloadIds.delete(id)
    if (error) {
      console.error('Could not prepare queued download', error)
      status.status = 'failed'
      status.errorMessage = 'download-queue-failed'
      sendStatus(true)
    }
    releaseDownloadSlot()
    await rm(temporaryDownloadFolder, { recursive: true, force: true })
    await saveDownloadRecords()
    return { id }
  }

  function queuedPreparationWasInterrupted() {
    if (status.status !== 'queued') return true
    if (!downloadQueuePaused || individuallyResumedDownloadIds.has(id)) return false
    status.status = 'paused'
    sendStatus(true)
    return true
  }

  if (queuedPreparationWasInterrupted()) return abortQueuedPreparation()

  try {
    const bandwidthLimit = normalizeDownloadBandwidth(
      (await settings._findOne('ytDlpDownloadBandwidthLimit'))?.value
    )
    if (bandwidthLimit > 0) {
      const bandwidthShare = Math.max(1, Math.floor(
        bandwidthLimit / (await getDownloadQueueSettings()).concurrency
      ))
      args.push('--limit-rate', `${bandwidthShare}K`)
    }
  } catch (error) {
    return abortQueuedPreparation(error)
  }
  if (queuedPreparationWasInterrupted()) return abortQueuedPreparation()

  individuallyResumedDownloadIds.delete(id)
  status.status = 'preparing'
  status.started = true
  const child = spawn(executable, args, { windowsHide: true, env: ytDlpEnvironment() })
  const entry = { child, cancelled: false, paused: false, restarting: false, restartStatus: 'queued' }
  activeDownloads.set(id, entry)
  showAutomaticDownloadNotification(payload, 'started')
  sendStatus(true)

  /** @type {string[]} */
  const stderrLines = []
  /** @type {Set<string>} */
  const subtitleDestinations = new Set()

  /** @param {'preparing' | 'downloading' | 'processing'} phase */
  function setDownloadPhase(phase) {
    if (status.status === 'paused' || status.status === 'pausing') {
      entry.resumeStatus = phase
    } else {
      status.status = phase
    }
  }

  const metadataByVideoId = new Map()

  /**
   * @param {string} line
   */
  function handleStdoutLine(line) {
    if (line.startsWith('__OPENTUBEX_PREPARING__:') || line === '__OPENTUBEX_PROCESSING__' || line.startsWith('__OPENTUBEX_DOWNLOAD__:finished')) {
      setDownloadPhase(line.startsWith('__OPENTUBEX_PREPARING__:') ? 'preparing' : 'processing')
      status.percent = 0
      status.speed = null
      status.eta = null
      sendStatus(true)
      return
    }
    if (line.startsWith('__OPENTUBEX_DOWNLOAD__:downloading\t')) {
      const [, percent, speed, eta] = line.split('\t')
      const changed = status.status !== 'downloading'
      setDownloadPhase('downloading')
      status.percent = Number.parseFloat(percent) || 0
      status.speed = !speed || /^(Unknown|NA)/.test(speed.trim()) ? null : speed.trim()
      status.eta = !eta || /^(Unknown|NA)/.test(eta.trim()) ? null : eta.trim()
      sendStatus(changed)
      return
    }
    if (line.startsWith(FINAL_METADATA_PREFIX)) {
      const [rawVideoId, rawTitle, rawThumbnail, rawAuthor, rawAuthorId] = line.slice(FINAL_METADATA_PREFIX.length).split('\t')
      try {
        const videoId = JSON.parse(rawVideoId)
        const title = JSON.parse(rawTitle)
        const thumbnail = JSON.parse(rawThumbnail)
        const author = JSON.parse(rawAuthor)
        const authorId = JSON.parse(rawAuthorId)
        const metadata = {
          title: typeof title === 'string' ? title.slice(0, 255) : '',
          author: typeof author === 'string' ? author.slice(0, 255) : '',
          authorId: typeof authorId === 'string' ? authorId.slice(0, 128) : ''
        }
        metadataByVideoId.set(videoId, metadata)
        for (const file of status.files) {
          if (file.videoId === videoId) Object.assign(file, metadata)
        }
        if (typeof title === 'string' && title !== '') {
          status.titleTruncated ||= truncatesLongTitles &&
            Buffer.byteLength(title, 'utf8') > DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT
        }
        if (videoId === status.videoId || (isExternalMedia && status.videoId === '')) {
          if (typeof title === 'string' && title !== '') {
            status.title = title.slice(0, 255)
          }
          if (typeof thumbnail === 'string') status.thumbnail = thumbnail.slice(0, 2048)
          else if (thumbnail === null) status.thumbnail = ''
        }
        sendStatus(true)
      } catch {
        // A malformed metadata line must not interfere with the download itself.
      }
      return
    }

    if (line.startsWith(FINAL_PATH_PREFIX)) {
      const parts = line.slice(FINAL_PATH_PREFIX.length).split('\t')
      const hasMediaMetadata = parts.length >= 5
      const [videoId, rawDuration, rawWidth, rawHeight] = parts
      const pathParts = parts.slice(hasMediaMetadata ? 4 : parts.length > 1 ? 1 : 0)
      status.destination = pathParts.join('\t')
      if (status.destination !== '' && !status.destinations.includes(status.destination)) {
        status.destinations.push(status.destination)
      }
      if (ID_REGEX.test(videoId) && status.destination !== '' &&
        !status.files.some(file => file.videoId === videoId && file.path === status.destination)) {
        const duration = hasMediaMetadata ? Number(rawDuration) : NaN
        const width = hasMediaMetadata ? Number(rawWidth) : NaN
        const height = hasMediaMetadata ? Number(rawHeight) : NaN
        status.files.push({
          ...metadataByVideoId.get(videoId),
          videoId,
          path: status.destination,
          ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
          ...(Number.isInteger(width) && width > 0 ? { width } : {}),
          ...(Number.isInteger(height) && height > 0 ? { height } : {})
        })
      }
      sendStatus(true)
      return
    }

    const subtitleMatch = SUBTITLE_DESTINATION_REGEX.exec(line)
    if (subtitleMatch) {
      const subtitlePath = subtitleMatch[1]
      subtitleDestinations.add(subtitlePath)
      status.destination = subtitlePath
      if (!status.destinations.includes(subtitlePath)) status.destinations.push(subtitlePath)
      sendStatus(true)
      return
    }
    const progressMatch = PROGRESS_REGEX.exec(line)
    if (progressMatch) {
      const previousStatus = status.status
      setDownloadPhase(/\bin\s/.test(line) && Number(progressMatch[1]) === 100 ? 'processing' : 'downloading')
      status.percent = parseFloat(progressMatch[1])
      status.speed = progressMatch[2] ?? null
      status.eta = progressMatch[3] ?? null
      sendStatus(previousStatus !== status.status)
      return
    }

    // subtitle files are announced twice, and only the line handled above
    // accounts for the extension a conversion gives them
    const destinationMatch = subtitlesOnly ? null : DESTINATION_REGEX.exec(line)
    if (destinationMatch) {
      status.destination = destinationMatch[1]

      if (line.startsWith('[ExtractAudio]')) {
        setDownloadPhase('processing')
      }

      sendStatus(true)
      return
    }

    const mergerMatch = MERGER_REGEX.exec(line)
    if (mergerMatch) {
      setDownloadPhase('processing')
      status.destination = mergerMatch[1]
      sendStatus(true)
    }
  }

  let stdoutBuffer = ''
  function removeTemporaryDownloadFolder() {
    rm(temporaryDownloadFolder, { recursive: true, force: true })
      .catch(error => console.warn('Could not remove temporary download folder', error))
  }
  child.stdout.setEncoding('utf-8')
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop()
    lines.forEach(handleStdoutLine)
  })

  let stderrBuffer = ''
  child.stderr.setEncoding('utf-8')
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk
    const lines = stderrBuffer.split(/\r?\n/)
    stderrBuffer = lines.pop()
    lines.forEach(handleStderrLine)
  })
  child.stderr.on('end', () => {
    if (stderrBuffer) handleStderrLine(stderrBuffer)
  })

  /** @param {string} line */
  function handleStderrLine(line) {
    handleStdoutLine(line)
    if (line.length > 0) stderrLines.push(line)
    // only keep the last few lines for error reporting
    if (stderrLines.length > 5) {
      stderrLines.splice(0, stderrLines.length - 5)
    }
  }

  child.on('error', (error) => {
    if (finished) {
      return
    }
    finished = true

    activeDownloads.delete(id)
    releaseDownloadSlot()
    removeTemporaryDownloadFolder()
    status.status = entry.restarting ? entry.restartStatus : 'failed'
    status.errorMessage = entry.restarting ? null : error.code === 'ENOENT' ? 'ENOENT' : error.message
    if (!entry.restarting) showAutomaticDownloadNotification(payload, 'failed')
    sendStatus(true)
    saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
  })

  child.on('close', (code) => {
    if (finished) {
      return
    }
    finished = true

    activeDownloads.delete(id)
    releaseDownloadSlot()
    removeTemporaryDownloadFolder()

    if (entry.restarting) {
      status.status = entry.restartStatus
      status.speed = null
      status.eta = null
    } else if (entry.cancelled) {
      status.status = 'cancelled'
    } else if (code === 0) {
      if (subtitleFormat !== '') {
        const convertedSubtitleDestinations = new Map([...subtitleDestinations].map((subtitlePath) => [
          subtitlePath,
          subtitlePath.replace(/\.[^.]+$/, `.${subtitleFormat}`)
        ]))
        status.destinations = status.destinations.map((destination) => (
          convertedSubtitleDestinations.get(destination) ?? destination
        ))
        status.destination = convertedSubtitleDestinations.get(status.destination) ?? status.destination
      }
      status.status = payload.automatic === true && status.destinations.length === 0
        ? 'skipped'
        : 'completed'
      if (status.status === 'completed') {
        status.percent = 100
        status.completedAt = Date.now()
      }
    } else {
      status.status = 'failed'
      status.errorMessage = stderrLines.join('\n')
    }

    if (status.status === 'completed') {
      showAutomaticDownloadNotification(payload, 'completed', id)
    } else if (status.status === 'failed') {
      showAutomaticDownloadNotification(payload, 'failed')
    }

    sendStatus(true)
    saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
  })

  return { id }
}

function queueYtDlpDownload(
  event,
  payload,
  automaticDownloadAuthorized,
  automaticDiscoveryPreviouslyAuthorized = false,
  previouslyAccepted = false,
  onQueued
) {
  return new Promise(resolve => {
    let resolved = false
    const resolveOnce = result => {
      if (resolved) return
      resolved = true
      resolve(result)
    }
    const resolveQueued = result => {
      onQueued?.(result)
      resolveOnce(result)
    }
    startYtDlpDownload(
      event,
      payload,
      automaticDownloadAuthorized,
      automaticDiscoveryPreviouslyAuthorized,
      resolveQueued,
      previouslyAccepted
    ).then(resolveOnce).catch(error => {
      console.error('Could not queue download', error)
      resolveOnce({ error: 'download-queue-failed' })
    })
  })
}

async function restartPersistedDownload(event, record, resumeIndividually = false) {
  if (!record?.retryPayload) return { error: 'download-not-resumable' }
  downloadRecords.delete(record.id)
  const result = await queueYtDlpDownload(
    event,
    record.retryPayload,
    true,
    record.automatic === true,
    true,
    queuedResult => {
      if (!resumeIndividually || !queuedResult || !('id' in queuedResult)) return
      const restartedRecord = downloadRecords.get(queuedResult.id)
      if (resumePendingDownload(restartedRecord, individuallyResumedDownloadIds, downloadQueuePaused)) {
        broadcastDownloadStatus(restartedRecord)
      }
    }
  )
  if (result && 'id' in result) {
    broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, [record.id])
    await saveDownloadRecords()
    return result
  }
  if (result?.error === 'downloads-disabled') {
    downloadRecords.set(record.id, record)
    broadcastDownloadStatus(record)
    await saveDownloadRecords()
    return result
  }
  record.status = 'failed'
  record.errorMessage = result && 'error' in result ? result.error : 'download-queue-failed'
  downloadRecords.set(record.id, record)
  broadcastDownloadStatus(record)
  await saveDownloadRecords()
  return result
}

async function restorePersistedDownloadQueue(event) {
  persistedDownloadQueueRestorePromise ??= (async () => {
    await loadDownloadRecords()
    const persisted = [...downloadRecords.values()]
      .filter(record => record.status === 'queued' &&
        !queuedDownloadWaiters.has(record.id) && !activeDownloads.has(record.id))
      .sort(compareQueuedDownloads)
    for (const record of persisted) await restartPersistedDownload(event, record)
  })().catch(error => {
    persistedDownloadQueueRestorePromise = null
    throw error
  })
  return persistedDownloadQueueRestorePromise
}

export function restoreYtDlpDownloadQueue() {
  return restorePersistedDownloadQueue(null)
}

export function refreshYtDlpDownloadQueue() {
  return requestDownloadQueueDrain()
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {YtDlpDownloadPayload} payload
 * @param {number} [retryDownloadId]
 * @param {boolean} [automaticDownloadAuthorized]
 * @returns {Promise<{ id: number } | { error: string } | { skipped: string } | null>}
 */
export async function handleYtDlpDownload(event, payload, retryDownloadId, automaticDownloadAuthorized = false) {
  if (retryDownloadId === undefined) {
    return queueYtDlpDownload(event, payload, automaticDownloadAuthorized)
  }

  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() ||
    !Number.isInteger(retryDownloadId)) {
    return null
  }
  if (retryingDownloadIds.has(retryDownloadId)) {
    return { error: 'download-already-retrying' }
  }

  retryingDownloadIds.add(retryDownloadId)
  try {
    await loadDownloadRecords()
    const retryRecord = downloadRecords.get(retryDownloadId)
    if (!['failed', 'cancelled'].includes(retryRecord?.status)) {
      return { error: 'download-not-retryable' }
    }

    const retryPayload = retryRecord.automatic === true ? retryRecord.retryPayload : payload
    const result = await queueYtDlpDownload(event, retryPayload, true, retryRecord.automatic === true)
    if (result && 'id' in result) {
      downloadRecords.delete(retryDownloadId)
      broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, [retryDownloadId])
      await saveDownloadRecords()
        .catch(error => console.warn('Could not save download history', error))
    }
    return result
  } finally {
    retryingDownloadIds.delete(retryDownloadId)
  }
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
    if (entry.paused) entry.child.kill('SIGCONT')
    entry.child.kill()
    return
  }

  const record = downloadRecords.get(id)
  if (record && ['queued', 'paused'].includes(record.status)) {
    cancelQueuedDownload(id)
    record.status = 'cancelled'
    record.speed = null
    record.eta = null
    broadcastDownloadStatus(record)
    saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
    requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
  }
}

function clearQueuePauseAfterLastIndividualResume() {
  if (!downloadQueuePauseAllRequested || [...downloadRecords.values()]
    .some(download => ['paused', 'pausing'].includes(download.status))) return

  downloadQueuePaused = false
  downloadQueuePauseAllRequested = false
  individuallyResumedDownloadIds.clear()
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number} id
 * @param {'pause' | 'resume' | 'move'} action
 * @param {number} [value]
 */
export async function handleYtDlpControlDownload(event, id, action, value) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || !Number.isInteger(id)) return false
  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  if (!record) return false

  const entry = activeDownloads.get(id)
  if (action === 'pause') {
    if (record.status === 'queued') {
      individuallyResumedDownloadIds.delete(id)
      record.status = 'paused'
    } else if (entry && ['preparing', 'downloading', 'processing'].includes(record.status)) {
      entry.resumeStatus = record.status
      if (process.platform !== 'win32' && entry.child.kill('SIGSTOP')) {
        entry.paused = true
        record.status = 'paused'
      } else {
        downloadQueuePaused = true
        record.status = 'pausing'
        setPendingDownloadStatus('paused')
      }
    } else {
      return false
    }
  } else if (action === 'resume') {
    if (entry?.paused && record.status === 'paused') {
      entry.child.kill('SIGCONT')
      entry.paused = false
      record.status = entry.resumeStatus ?? 'preparing'
    } else if (record.status === 'paused') {
      if (!queuedDownloadWaiters.has(id)) {
        const result = await restartPersistedDownload(event, record, true)
        const resumed = Boolean(result && 'id' in result)
        if (resumed) clearQueuePauseAfterLastIndividualResume()
        return resumed
      }
      resumePendingDownload(record, individuallyResumedDownloadIds, downloadQueuePaused)
    } else if (record.status === 'pausing') {
      record.status = entry.resumeStatus ?? 'preparing'
      const anotherDownloadIsPausing = [...downloadRecords.values()]
        .some(download => download.id !== id && download.status === 'pausing')
      if (!downloadQueuePauseAllRequested && !anotherDownloadIsPausing) {
        downloadQueuePaused = false
        individuallyResumedDownloadIds.clear()
        setPendingDownloadStatus('queued')
      }
    } else {
      return false
    }
    clearQueuePauseAfterLastIndividualResume()
  } else if (action === 'move' && ['queued', 'paused'].includes(record.status) && !entry && (value === -1 || value === 1)) {
    const peers = [...downloadRecords.values()]
      .filter(download => ['queued', 'paused'].includes(download.status) && !activeDownloads.has(download.id))
      .sort(compareQueuedDownloads)
    const index = peers.findIndex(download => download.id === id)
    const other = peers[index + value]
    if (!other) return false
    const position = record.queuePosition
    record.queuePosition = other.queuePosition
    other.queuePosition = position
    broadcastDownloadStatus(other)
  } else {
    return false
  }

  broadcastDownloadStatus(record)
  await saveDownloadRecords()
  await requestDownloadQueueDrain()
  return true
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'pause-all' | 'resume-all' | 'retry-all' | 'refresh'} action
 */
export async function handleYtDlpQueueAction(event, action) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) return false
  await loadDownloadRecords()
  if (action === 'refresh') {
    await requestDownloadQueueDrain()
    return true
  }
  if (action === 'pause-all') {
    downloadQueuePaused = true
    downloadQueuePauseAllRequested = true
    individuallyResumedDownloadIds.clear()
    setPendingDownloadStatus('paused')
    for (const [id, entry] of activeDownloads) {
      const record = downloadRecords.get(id)
      if (!record || entry.paused) continue
      if (record.status !== 'pausing') entry.resumeStatus = record.status
      if (process.platform !== 'win32' && entry.child.kill('SIGSTOP')) {
        entry.paused = true
        record.status = 'paused'
      } else {
        record.status = 'pausing'
      }
      broadcastDownloadStatus(record)
    }
  } else if (action === 'resume-all') {
    downloadQueuePaused = false
    downloadQueuePauseAllRequested = false
    individuallyResumedDownloadIds.clear()
    setPendingDownloadStatus('queued')
    const persistedPaused = []
    for (const record of downloadRecords.values()) {
      const entry = activeDownloads.get(record.id)
      if (entry?.paused) {
        entry.child.kill('SIGCONT')
        entry.paused = false
        record.status = entry.resumeStatus ?? 'preparing'
        broadcastDownloadStatus(record)
      } else if (entry && record.status === 'pausing') {
        record.status = entry.resumeStatus ?? 'preparing'
        broadcastDownloadStatus(record)
      } else if (record.status === 'paused') {
        persistedPaused.push(record)
      }
    }
    for (const record of persistedPaused) await restartPersistedDownload(event, record)
  } else if (action === 'retry-all') {
    const failed = [...downloadRecords.values()].filter(record => record.status === 'failed')
    for (const record of failed) {
      await handleYtDlpDownload(event, record.retryPayload ?? {
        videoId: record.videoId,
        playlistId: record.playlistId,
        isPlaylist: Boolean(record.playlistId),
        title: record.title,
        thumbnail: record.thumbnail,
        mode: record.mode,
        template: record.template,
      }, record.id, true)
    }
  } else {
    return false
  }

  await saveDownloadRecords()
  await requestDownloadQueueDrain()
  return true
}

/**
 * Moves a file to the operating system trash.
 * Electron does not use the Trash portal for document portal paths, so let
 * GIO handle the operation when running inside Flatpak.
 * @param {string} destination
 */
async function moveToTrash(destination) {
  if (shouldUseGioTrash()) {
    await execFileAsync('gio', ['trash', destination])
  } else {
    await shell.trashItem(destination)
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number} id
 */
export async function handleYtDlpOpenDownload(event, id) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || !Number.isInteger(id)) {
    return false
  }

  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  const destinations = Array.isArray(record?.destinations) && record.destinations.length > 0
    ? record.destinations
    : [record?.destination].filter(destination => typeof destination === 'string')
  const destination = destinations.find(existsSync)
  if (destination === undefined) {
    return false
  }

  shell.showItemInFolder(destination)
  return true
}

/**
 * Moves a completed download to the operating system trash.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number} id
 */
export async function handleYtDlpRemoveDownload(event, id) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || !Number.isInteger(id)) {
    return false
  }

  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  const destinations = Array.isArray(record?.destinations) && record.destinations.length > 0
    ? record.destinations
    : [record?.destination].filter(destination => typeof destination === 'string')
  if (record?.status !== 'completed' || destinations.length === 0 || !destinations.some(existsSync)) {
    return false
  }

  let trashed = false
  for (const destination of destinations) {
    if (!existsSync(destination)) continue
    try {
      await moveToTrash(destination)
      trashed = true
    } catch (error) {
      console.warn('Could not move download to trash', destination, error)
    }
  }
  if (!trashed) return false

  downloadRecords.delete(id)
  await saveDownloadRecords()
  broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, [id])
  return true
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 */
export async function handleYtDlpListDownloads(event) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) return []
  await loadDownloadRecords()
  await restorePersistedDownloadQueue(event)
  return Promise.all([...downloadRecords.values()].map(async record => {
    if (record.status !== 'completed') return record

    const destinations = Array.isArray(record.destinations) && record.destinations.length > 0
      ? record.destinations
      : [record.destination].filter(destination => typeof destination === 'string')
    const destinationStats = await Promise.all(destinations.map(async destination => {
      try {
        return await stat(destination)
      } catch {
        return null
      }
    }))
    const availableDestinationCount = destinationStats.filter(Boolean).length
    const sizeBytes = destinationStats.reduce((total, destinationStat) => (
      total + (destinationStat?.isFile() ? destinationStat.size : 0)
    ), 0)
    const availability = availableDestinationCount === 0
      ? 'missing'
      : availableDestinationCount === destinations.length
        ? 'available'
        : 'partial'
    const legacyCompletedAt = Math.max(0, ...destinationStats.map(destinationStat => (
      destinationStat?.birthtimeMs > 0 ? destinationStat.birthtimeMs : (destinationStat?.ctimeMs ?? 0)
    )))

    return {
      ...record,
      availability,
      availableDestinationCount,
      destinationCount: destinations.length,
      sizeBytes,
      completedAt: record.completedAt ?? (legacyCompletedAt || undefined),
      files: getDownloadFiles(record).map(file => ({
        ...file,
        available: existsSync(file.path)
      }))
    }
  }))
}

/**
 * Returns the playable files recorded for a video download. Older single-video
 * records can be identified without guessing from their user-customizable path.
 * @param {YtDlpDownloadStatus} record
 */
function getDownloadFiles(record) {
  if (Array.isArray(record.files) && record.files.length > 0) {
    return record.files.filter(file => ID_REGEX.test(file?.videoId) && typeof file.path === 'string')
  }
  if (['video', 'audio'].includes(record.mode) && ID_REGEX.test(record.videoId) && typeof record.destination === 'string') {
    return [{ videoId: record.videoId, path: record.destination }]
  }
  return []
}

/**
 * Resolves a local media request without exposing arbitrary filesystem access
 * through the custom protocol.
 * @param {number} id
 * @param {string} videoId
 * @param {string | null} [filePath] an exact path from this download's recorded files
 */
export async function getYtDlpDownloadFile(id, videoId, filePath = null) {
  if (!Number.isInteger(id) || !ID_REGEX.test(videoId) || (filePath !== null && typeof filePath !== 'string')) return null
  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  if (record?.status !== 'completed' || !['video', 'audio'].includes(record.mode)) return null
  const file = getDownloadFiles(record).find(file => file.videoId === videoId &&
    (filePath === null || file.path === filePath) && existsSync(file.path))
  return file === undefined ? null : { path: file.path, mode: record.mode }
}

/**
 * Removes download history entries without touching their files.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number[]} ids
 */
export async function handleYtDlpClearDownloads(event, ids) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() ||
    !Array.isArray(ids) || ids.some(id => !Number.isInteger(id))) {
    return false
  }
  await loadDownloadRecords()
  const removedIds = []
  for (const id of ids) {
    const record = downloadRecords.get(id)
    if (!activeDownloads.has(id) && !queuedDownloadWaiters.has(id) &&
      ['completed', 'failed', 'cancelled', 'skipped'].includes(record?.status) &&
      downloadRecords.delete(id)) removedIds.push(id)
  }
  await saveDownloadRecords()
  if (removedIds.length > 0) broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, removedIds)
  return true
}
