import { AUTOMATIC_NUMBER_LIMITS, automaticNumber, ID_REGEX } from '../ytDlpArguments'
import { toFiniteNumber } from '../ytDlpMetadata'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, net, Notification } from 'electron'
import { settings } from '../datastores/handlers/base'
import { TabManager } from './tabs/TabManager'
import { IpcChannels } from '../constants'
import { supportsNativeNotifications } from './nativeNotifications'
import { downloadManagedYtDlp, pushProxyArgument, resolveExecutable } from './ytDlpBinaries'

/** @typedef {import('./ytDlpDownloads').YtDlpDownloadPayload} YtDlpDownloadPayload */

const execFileAsync = promisify(execFile)

const CHANNEL_ID_REGEX = /^UC[\w-]{22}$/
const AUTOMATIC_DISCOVERY_CACHE_TTL_MS = 60_000
const AUTOMATIC_DISCOVERY_TIMEOUT_MS = 15_000
const AUTOMATIC_METADATA_TIMEOUT_MS = 30_000
const AUTOMATIC_METADATA_MAX_BUFFER = 1024 * 1024
const AUTOMATIC_DISCOVERY_E2E_FIXTURE = 'automatic-download-discovery.xml'
const AUTOMATIC_TITLE_TERM_LIMIT = 20
const AUTOMATIC_TITLE_TERM_LENGTH_LIMIT = 100
const BUILT_IN_AUTOMATIC_TEMPLATE_OPTIONS = new Map([
  ['video:best', { mode: 'video' }],
  ['video:best:mp4', { mode: 'video', videoFormat: 'mp4' }],
  ['video:1080', { mode: 'video', quality: '1080' }],
  ['video:1080:mp4', { mode: 'video', quality: '1080', videoFormat: 'mp4' }],
  ['video:720', { mode: 'video', quality: '720' }],
  ['video:720:mp4', { mode: 'video', quality: '720', videoFormat: 'mp4' }],
  ['video:480', { mode: 'video', quality: '480' }],
  ['video:480:mp4', { mode: 'video', quality: '480', videoFormat: 'mp4' }],
  ['audio:best', { mode: 'audio', embedThumbnail: true, embedMetadata: true }],
  ['audio:mp3', { mode: 'audio', audioFormat: 'mp3', embedThumbnail: true, embedMetadata: true }],
  ['subtitles:srt', { mode: 'subtitles', subtitleFormat: 'srt' }],
  ['subtitles:vtt', { mode: 'subtitles', subtitleFormat: 'vtt' }]
])

const automaticDiscoveryCache = new Map()
const activeAutomaticDownloadNotifications = new Set()

export function showAutomaticDownloadNotification(payload, phase, downloadId = null) {
  if (payload.automatic !== true || !supportsNativeNotifications(Notification)) {
    return
  }

  const title = payload.notification?.[`${phase}Title`]
  const body = payload.notification?.[`${phase}Body`]
  if (typeof title !== 'string' || title.length === 0 || title.length > 200 ||
    typeof body !== 'string' || body.length === 0 || body.length > 500) {
    return
  }

  const notification = new Notification({ title, body })
  activeAutomaticDownloadNotifications.add(notification)
  notification.once('close', () => activeAutomaticDownloadNotifications.delete(notification))
  notification.once('click', () => {
    activeAutomaticDownloadNotifications.delete(notification)
    const browserWindow = BrowserWindow.getAllWindows().find(window => (
      !window.isDestroyed() && TabManager.getForWindow(window.id)
    )) ?? BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
    if (browserWindow) {
      if (browserWindow.isMinimized()) browserWindow.restore()
      browserWindow.show()
      browserWindow.focus()

      const tabManager = TabManager.getForWindow(browserWindow.id)
      if (phase === 'started') {
        browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, '/downloads')
      } else if (phase === 'completed' && tabManager && ID_REGEX.test(payload.videoId) && Number.isInteger(downloadId)) {
        tabManager.createTabWithPreference({
          route: `/watch/${payload.videoId}`,
          query: { downloadId },
          makeActive: true
        }).catch(error => {
          console.error('Failed to open automatically downloaded video', error)
        })
      }
    }
  })
  notification.show()
}

/**
 * Loads recent video IDs for a channel from a main-process-owned source. This
 * prevents a renderer from turning a persisted channel rule into permission to
 * download an arbitrary video that was not present in the subscription feed.
 * @param {string} channelId
 * @returns {Promise<Map<string, number> | null>}
 */
async function getAutomaticDiscoveryVideoIds(channelId) {
  const cached = automaticDiscoveryCache.get(channelId)
  if (cached?.expiresAt > Date.now()) {
    return cached.videos
  }

  let feed
  if (process.env.OPENTUBEX_E2E_USER_DATA_DIR) {
    try {
      feed = await readFile(join(app.getPath('userData'), AUTOMATIC_DISCOVERY_E2E_FIXTURE), 'utf8')
    } catch {
      return null
    }
  } else {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AUTOMATIC_DISCOVERY_TIMEOUT_MS)
    try {
      const response = await net.fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
        { signal: controller.signal }
      )
      if (!response.ok) {
        return null
      }
      feed = await response.text()
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  const videos = new Map()
  for (const entry of feed.matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const entryChannelId = entry[0].match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1]
    const videoId = entry[0].match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]
    const published = Date.parse(entry[0].match(/<published>([^<]+)<\/published>/)?.[1])
    if (entryChannelId === channelId && ID_REGEX.test(videoId) && Number.isFinite(published)) {
      videos.set(videoId, published)
    }
  }

  automaticDiscoveryCache.set(channelId, {
    expiresAt: Date.now() + AUTOMATIC_DISCOVERY_CACHE_TTL_MS,
    videos
  })
  return videos
}

/**
 * Verifies a candidate directly when YouTube's RSS feed has not indexed it
 * yet. Keep this check in the main process so a renderer cannot authorize an
 * arbitrary video by supplying its own channel or publication metadata.
 * @param {string} videoId
 * @param {string} channelId
 * @returns {Promise<number | null>} publication time in milliseconds
 */
async function getAutomaticVideoPublishedAt(videoId, channelId) {
  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()
    if ('error' in result) return null
  }

  const args = [
    '--flat-playlist',
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout',
    '15'
  ]
  await pushProxyArgument(args)
  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  let info
  try {
    const { stdout } = await execFileAsync(executable, args, {
      timeout: AUTOMATIC_METADATA_TIMEOUT_MS,
      maxBuffer: AUTOMATIC_METADATA_MAX_BUFFER,
      windowsHide: true
    })
    info = JSON.parse(stdout)
  } catch {
    return null
  }

  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    return null
  }

  const publishedAt = toFiniteNumber(info.timestamp)
  return info.id === videoId && info.channel_id === channelId && publishedAt !== null
    ? publishedAt * 1000
    : null
}

function automaticTitleTerms(value) {
  return typeof value === 'string'
    ? value.split(',')
        .map(term => term.trim().slice(0, AUTOMATIC_TITLE_TERM_LENGTH_LIMIT))
        .filter(Boolean)
        .slice(0, AUTOMATIC_TITLE_TERM_LIMIT)
    : []
}

async function getAutomaticTemplateOptions(template) {
  const builtInOptions = BUILT_IN_AUTOMATIC_TEMPLATE_OPTIONS.get(template)
  if (builtInOptions) {
    return builtInOptions
  }
  if (!template.startsWith('template:')) {
    return null
  }

  let templates
  try {
    templates = JSON.parse((await settings._findOne('ytDlpDownloadTemplates'))?.value || '[]')
  } catch {
    return null
  }
  if (!Array.isArray(templates)) {
    return null
  }

  const customTemplate = templates.find(candidate => (
    candidate?.name === template.slice('template:'.length)
  ))
  if (customTemplate?.options !== null && typeof customTemplate?.options === 'object' &&
    !Array.isArray(customTemplate.options)) {
    return { mode: 'video', ...customTemplate.options }
  }
  if (typeof customTemplate?.args === 'string') {
    return { mode: 'video', customArgs: customTemplate.args }
  }
  return null
}

/**
 * Rebuilds automatic-only options from settings owned by the main process.
 * A renderer-provided `automatic` flag alone must never waive the activation
 * boundary or select arbitrary yt-dlp arguments.
 * @param {YtDlpDownloadPayload} payload
 * @param {boolean} [discoveryPreviouslyAuthorized]
 * @returns {Promise<YtDlpDownloadPayload | null>}
 */
export async function authorizeAutomaticDownload(payload, discoveryPreviouslyAuthorized = false) {
  if (typeof payload.channelId !== 'string' || !CHANNEL_ID_REGEX.test(payload.channelId) ||
    typeof payload.videoId !== 'string' || !ID_REGEX.test(payload.videoId)) {
    return null
  }

  let rules
  try {
    rules = JSON.parse((await settings._findOne('ytDlpAutomaticDownloadRules'))?.value || '{}')
  } catch {
    return null
  }
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules) ||
    !Object.hasOwn(rules, payload.channelId)) {
    return null
  }

  const rule = rules[payload.channelId]
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    return null
  }
  const template = typeof rule.template === 'string' && rule.template !== '' ? rule.template : 'video:best'
  if (payload.template !== template) {
    return null
  }

  const mediaTypeAllowed = payload.automaticMediaType === 'short'
    ? rule.includeShorts === true
    : payload.automaticMediaType === 'livestream'
      ? rule.includeLivestreams === true
      : payload.automaticMediaType === 'video' && rule.includeVideos !== false
  if (!mediaTypeAllowed) {
    return null
  }

  const templateOptions = await getAutomaticTemplateOptions(template)
  if (templateOptions === null) {
    return null
  }

  if (!discoveryPreviouslyAuthorized) {
    let discoveredVideos = await getAutomaticDiscoveryVideoIds(payload.channelId)
    const enabledAt = automaticNumber(rule.enabledAt, Number.MAX_SAFE_INTEGER)
    let publishedAt = discoveredVideos?.get(payload.videoId) ?? null
    if (enabledAt !== null && publishedAt === null) {
      publishedAt = await getAutomaticVideoPublishedAt(payload.videoId, payload.channelId)
      if (publishedAt !== null) {
        if (discoveredVideos === null) {
          discoveredVideos = new Map()
          automaticDiscoveryCache.set(payload.channelId, {
            expiresAt: Date.now() + AUTOMATIC_DISCOVERY_CACHE_TTL_MS,
            videos: discoveredVideos
          })
        }
        discoveredVideos.set(payload.videoId, publishedAt)
      }
    }
    if (enabledAt === null || publishedAt === null ||
      Math.floor(publishedAt / 1000) < Math.floor(enabledAt / 1000)) {
      return null
    }
  }

  const sanitizedPayload = {
    videoId: payload.videoId,
    channelId: payload.channelId,
    title: payload.title,
    thumbnail: payload.thumbnail,
    notification: payload.notification
  }
  for (const [key, maximum] of Object.entries(AUTOMATIC_NUMBER_LIMITS)) {
    sanitizedPayload[key] = automaticNumber(rule[key], maximum)
  }
  sanitizedPayload.titleIncludes = automaticTitleTerms(rule.titleIncludes)
  sanitizedPayload.titleExcludes = automaticTitleTerms(rule.titleExcludes)

  return {
    ...sanitizedPayload,
    ...structuredClone(templateOptions),
    template,
    automatic: true
  }
}
