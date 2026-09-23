import { historyRepairYtDlpArguments, historyRepairYtDlpError } from '../../historyRepair'
import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { normalizeYtDlpPlaybackCacheMaxEntrySize } from '../../ytDlpPlaybackCacheSettings'
import store from '../store/index'
import { getDownloadTemplateOptions } from './downloadTemplates'
import { normalizeAutomaticDownloadRule, parseAutomaticDownloadRules } from './automaticDownloadRules'
import { buildYtDlpDownloadArguments } from '../../ytDlpArguments'
import { PLAYBACK_INFO_OUTPUT_TEMPLATE, mapPlaybackFormat, mapPlaybackCaptions, toFiniteNumber, toNonEmptyString } from '../../ytDlpMetadata'
import { buildYtDlpStoryboardVtt } from '../../main/ytDlpStoryboard'
import { isYouTubeSubtitleUrl } from '../../youtubeSubtitle'
import { chooseAndroidDirectory } from './androidStorage'

const native = process.env.IS_CAPACITOR ? registerPlugin('YtDlp') : null

function configuration() {
  const rules = {}
  let templates = []
  try {
    const parsed = JSON.parse(store.getters.getYtDlpDownloadTemplates || '[]')
    if (Array.isArray(parsed)) templates = parsed.filter(template => template && typeof template === 'object')
  } catch (error) { console.warn('Invalid download templates', error) }
  for (const [channelId, rawRule] of Object.entries(parseAutomaticDownloadRules(store.getters.getYtDlpAutomaticDownloadRules))) {
    if (!rawRule || typeof rawRule !== 'object') continue
    const rule = normalizeAutomaticDownloadRule(rawRule)
    const options = getDownloadTemplateOptions(rule.template, templates)
    if (options === null || !/^UC[\w-]{22}$/.test(channelId)) continue
    const payload = {
      ...options,
      ...rule,
      videoId: '___________',
      channelId,
      automatic: true,
      titleIncludes: rule.titleIncludes.split(',').map(term => term.trim()).filter(Boolean),
      titleExcludes: rule.titleExcludes.split(',').map(term => term.trim()).filter(Boolean)
    }
    try {
      rules[channelId] = { rule, payload, args: buildYtDlpDownloadArguments(payload, store.getters.getYtDlpDownloadCustomArgs).args }
    } catch (error) { console.warn('Invalid automatic download options', error) }
  }
  return {
    rules,
    useCookies: (store.getters.getYtDlpPlaybackAlwaysUseCookies || store.getters.getYtDlpDownloadUseCookies) && store.getters.getYtDlpPlaybackAuthMode === 'file',
    cookies: store.getters.getYtDlpPlaybackAuthMode === 'file' ? store.getters.getYtDlpPlaybackCookiesPath : '',
    concurrency: store.getters.getYtDlpMaxConcurrentDownloads,
    bandwidth: store.getters.getYtDlpDownloadBandwidthLimit,
    folder: store.getters.getYtDlpDownloadFolderPath,
    channel: store.getters.getYtDlpChannel,
    enabled: store.getters.getEnableDownloads,
  }
}

async function extract(args, useAuthentication = false, externalMedia = false) {
  const cookies = useAuthentication && store.getters.getYtDlpPlaybackAuthMode === 'file'
    ? store.getters.getYtDlpPlaybackCookiesPath
    : ''
  if (useAuthentication && !cookies) throw new Error('yt-dlp playback authentication is not configured')
  const { stdout } = await native.extract({ args, cookies, externalMedia })
  return JSON.parse(stdout)
}

function listen(event, callback) {
  const handle = native.addListener(event, callback)
  return () => { handle.then(listener => listener.remove()) }
}

let removeSettingsProgressListener = null

const android = {
  async ytDlpDownload(payload, retryDownloadId) {
    try {
      if (!store.getters.getEnableDownloads) return { error: 'downloads-disabled' }
      if (!payload.automatic) {
        const permission = await LocalNotifications.checkPermissions()
        if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') await LocalNotifications.requestPermissions()
      }
      const { args } = buildYtDlpDownloadArguments(payload, store.getters.getYtDlpDownloadCustomArgs)
      return await native.download({ payload, args, retryDownloadId, configuration: configuration() })
    } catch (error) {
      return { error: error.message }
    }
  },
  ytDlpCancelDownload: id => native.control({ id, action: 'cancel' }).then(result => result.ok),
  ytDlpControlDownload: (id, action, value) => native.control({ id, action, value }).then(result => result.ok),
  ytDlpQueueAction: action => native.queue({ action, configuration: configuration() }).then(result => result.ok),
  ytDlpListDownloads: () => native.list().then(result => result.downloads),
  ytDlpClearDownloads: ids => native.clear({ ids }).then(result => result.ok),
  ytDlpOpenDownload: id => native.open({ id }).then(result => result.ok),
  ytDlpRemoveDownload: id => native.remove({ id }).then(result => result.ok),
  handleYtDlpDownloadStatus: callback => listen('downloadStatus', callback),
  handleYtDlpDownloadsRemoved: callback => listen('downloadsRemoved', result => callback(result.ids)),
  ytDlpChooseDownloadFolder: chooseAndroidDirectory,
  ytDlpChooseCookies: () => native.chooseCookies().then(result => result.path),
  ytDlpCreateSession: labels => native.createSession(labels).then(result => result.path),
  ytDlpGetInfo: () => native.info(),
  ytDlpCheckBinaryUpdate: binary => native.checkUpdate({ binary, channel: configuration().channel }),
  ytDlpDownloadBinary: binary => native.update({ binary, channel: configuration().channel }),
  setYtDlpBinaryDownloadProgressListener(callback) {
    removeSettingsProgressListener?.()
    removeSettingsProgressListener = callback ? listen('binaryProgress', callback) : null
  },
  handleYtDlpBinaryDownloadProgress: callback => listen('binaryProgress', callback),
  addYtDlpBinaryDownloadProgressListener: callback => listen('binaryProgress', callback),
  addYtDlpBinaryUpdatedListener: callback => listen('binaryUpdated', callback),
  async ytDlpGetSubtitle(url) {
    if (!isYouTubeSubtitleUrl(url) || store.getters.getYtDlpPlaybackAuthMode !== 'file' ||
      !store.getters.getYtDlpPlaybackCookiesPath) return null
    try {
      const result = await native.subtitle({ url, cookies: store.getters.getYtDlpPlaybackCookiesPath })
      if (typeof result.text !== 'string') throw new Error('Invalid subtitle response')
      return result.text
    } catch {
      return { error: 'Unable to load subtitle with configured cookies' }
    }
  },
  async ytDlpGetHistoryMetadata(videoId) {
    if (!/^[\w-]{11}$/.test(videoId)) return null
    try {
      return await extract([...historyRepairYtDlpArguments(), `https://www.youtube.com/watch?v=${videoId}`], true)
    } catch (error) {
      return historyRepairYtDlpError(error.message)
    }
  },
  async ytDlpGetPlaybackInfo(videoId, useDefaultClients = false, useAuthentication = false, includeSubtitles = true) {
    const isYouTubeVideo = /^[\w-]{11}$/.test(videoId)
    if (!isYouTubeVideo) {
      try {
        const url = new URL(videoId)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || videoId.length > 8192) return null
      } catch { return null }
    }
    try {
      const args = ['--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '15', '--ignore-no-formats-error', '--format', isYouTubeVideo ? 'sb0/sb1/sb2/sb3' : 'bestvideo*+bestaudio/best', '--print', PLAYBACK_INFO_OUTPUT_TEMPLATE]
      if (includeSubtitles) args.push('--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'vtt')
      if (isYouTubeVideo && !useDefaultClients) args.push('--extractor-args', useAuthentication ? 'youtube:player_client=default,web_safari' : 'youtube:player_client=default,web_embedded,-android_vr')
      args.push(isYouTubeVideo ? `https://www.youtube.com/watch?v=${videoId}` : videoId)
      const [info, binaries] = await Promise.all([extract(args, useAuthentication, !isYouTubeVideo), native.info()])
      const formats = Array.isArray(info.formats) ? info.formats : []
      const creatorAvatarUrl = [info.channel_thumbnail, info.channel_avatar, info.uploader_thumbnail, info.uploader_avatar]
        .find(value => { try { return new URL(value).protocol === 'https:' } catch { return false } }) ?? null
      return {
        version: binaries.ytDlp.version,
        title: toNonEmptyString(info.title),
        description: toNonEmptyString(info.description),
        uploader: toNonEmptyString(info.uploader),
        uploaderUrl: toNonEmptyString(info.uploader_url),
        uploaderThumbnail: info.channel ? null : creatorAvatarUrl,
        channel: toNonEmptyString(info.channel),
        channelUrl: toNonEmptyString(info.channel_url),
        channelThumbnail: info.channel ? creatorAvatarUrl : null,
        thumbnail: toNonEmptyString(info.thumbnail),
        webpageUrl: toNonEmptyString(info.webpage_url),
        viewCount: toFiniteNumber(info.view_count),
        uploadDate: toNonEmptyString(info.upload_date),
        isLive: !!info.is_live,
        liveStatus: toNonEmptyString(info.live_status),
        duration: toFiniteNumber(info.duration),
        hlsManifestUrl: toNonEmptyString(info.manifest_url) ?? formats.find(format => format.protocol === 'm3u8_native' && format.manifest_url)?.manifest_url ?? null,
        storyboardVtt: buildYtDlpStoryboardVtt([info.storyboard], toFiniteNumber(info.duration)),
        ...mapPlaybackCaptions(info.requested_subtitles),
        formats: formats.filter(format => format.protocol !== 'mhtml').map(mapPlaybackFormat),
      }
    } catch (error) {
      return { error: error.message }
    }
  },
  async ytDlpGetRecommendations(currentVideoId) {
    try {
      const info = await extract(['--flat-playlist', '--playlist-end', '30', '--dump-single-json', 'https://www.youtube.com/feed/recommended'], true)
      return (info.entries ?? []).filter(entry => /^[\w-]{11}$/.test(entry.id) && entry.id !== currentVideoId).map(entry => ({
        type: 'video',
        videoId: entry.id,
        title: entry.title || entry.id,
        author: entry.channel || entry.uploader || '',
        authorId: entry.channel_id || null,
        viewCount: entry.view_count ?? null,
        lengthSeconds: entry.duration ?? '',
        liveNow: entry.live_status === 'is_live',
        isUpcoming: entry.live_status === 'is_upcoming',
      }))
    } catch (error) { return { error: error.message } }
  },
  ytDlpPlaybackCacheGet: (videoId, cacheKey) => native.cache({ action: 'get', videoId, cacheKey }).then(result => result.entry ?? null),
  ytDlpPlaybackCacheSet: (videoId, cacheKey, expiryTime, source) => native.cache({ action: 'set', videoId, cacheKey, expiryTime, source, maxEntryBytes: normalizeYtDlpPlaybackCacheMaxEntrySize(store.getters.getYtDlpPlaybackCacheMaxEntrySize) * 1024 * 1024 }),
  ytDlpPlaybackCacheDelete: videoId => native.cache({ action: 'delete', videoId }),
  ytDlpPlaybackCacheClear: () => native.cache({ action: 'clear' }),
}

export function initializeAndroidYtDlp() {
  if (!native) return () => {}
  return store.watch(() => JSON.stringify(configuration()), value => {
    native.configure({ configuration: JSON.parse(value) }).catch(error => console.error('Could not configure Android downloads', error))
  }, { immediate: true })
}

export const ytDlp = process.env.IS_CAPACITOR ? android : window.ftElectron
