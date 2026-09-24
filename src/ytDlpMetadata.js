/** @typedef {import('./main/ytDlp').YtDlpPlaybackFormat} YtDlpPlaybackFormat */
/** @typedef {import('./main/ytDlp').YtDlpPlaybackCaption} YtDlpPlaybackCaption */

const PLAYBACK_FORMAT_OUTPUT_FIELDS = [
  'format_id',
  'url',
  'manifest_url',
  'http_headers',
  'protocol',
  'ext',
  'container',
  'vcodec',
  'acodec',
  'width',
  'height',
  'fps',
  'tbr',
  'asr',
  'audio_channels',
  'language',
  'format_note',
  'dynamic_range',
  'available_at',
  'target_duration',
  // Every Post-Live-DVR fragment carries the total count, so one is enough.
  'fragments.0.fragment_count'
].join(',')
const EXTERNAL_INFO_FIELDS = [
  ',"timestamp":%(timestamp|null)j',
  ',"release_date":%(release_date|null)j',
  ',"release_timestamp":%(release_timestamp|null)j',
  ',"concurrent_view_count":%(concurrent_view_count|null)j',
  ',"like_count":%(like_count|null)j',
  ',"dislike_count":%(dislike_count|null)j',
  ',"comment_count":%(comment_count|null)j',
  ',"repost_count":%(repost_count|null)j',
  ',"save_count":%(save_count|null)j',
  ',"series":%(series|null)j',
  ',"season":%(season|null)j',
  ',"season_number":%(season_number|null)j',
  ',"episode":%(episode|null)j',
  ',"episode_number":%(episode_number|null)j',
  ',"track":%(track|null)j',
  ',"track_number":%(track_number|null)j',
  ',"artists":%(artists|null)j',
  ',"album":%(album|null)j',
  ',"genres":%(genres|null)j',
  ',"license":%(license|null)j',
  ',"categories":%(categories|null)j',
  ',"tags":%(tags|null)j',
  ',"age_limit":%(age_limit|null)j',
  ',"availability":%(availability|null)j',
  ',"media_type":%(media_type|null)j',
  ',"chapters":%(chapters.:.{start_time,end_time,title})j',
  ',"subtitles":%(subtitles|null)j'
].join('')

function playbackInfoOutputTemplate(formatFields, external = false, storyboardFields = 'protocol,width,height,fps,rows,columns,fragments,http_headers') {
  return [
    '{"title":%(title|null)j',
    ',"description":%(description|null)j',
    ',"uploader":%(uploader|null)j',
    ',"uploader_id":%(uploader_id|null)j',
    ',"uploader_url":%(uploader_url|null)j',
    ',"uploader_thumbnail":%(uploader_thumbnail|null)j',
    ',"uploader_avatar":%(uploader_avatar|null)j',
    ',"channel":%(channel|null)j',
    ',"channel_url":%(channel_url|null)j',
    ',"channel_thumbnail":%(channel_thumbnail|null)j',
    ',"channel_avatar":%(channel_avatar|null)j',
    ',"thumbnail":%(thumbnail|null)j',
    ',"webpage_url":%(webpage_url|null)j',
    ',"view_count":%(view_count|null)j',
    ',"upload_date":%(upload_date|null)j',
    ',"is_live":%(is_live|null)j',
    ',"live_status":%(live_status|null)j',
    ',"duration":%(duration|null)j',
    ',"manifest_url":%(manifest_url|null)j',
    ',"requested_subtitles":%(requested_subtitles|null)j',
    ...(external ? [EXTERNAL_INFO_FIELDS] : []),
  `,"formats":%(formats.:.{${formatFields}})j`,
  // Project the selected storyboard only, avoiding the much larger media
  // fragment arrays that can occur in the full formats list.
  `,"storyboard":%(.{${storyboardFields}})j}`
  ].join('')
}

export const PLAYBACK_INFO_OUTPUT_TEMPLATE = playbackInfoOutputTemplate(PLAYBACK_FORMAT_OUTPUT_FIELDS)
export const EXTERNAL_PLAYBACK_FORMAT_SELECTOR = 'bestvideo*+bestaudio/best,mhtml'
export const EXTERNAL_PLAYBACK_INFO_OUTPUT_TEMPLATE = playbackInfoOutputTemplate(PLAYBACK_FORMAT_OUTPUT_FIELDS, true)
// Desktop keeps these scoped cookies in the main process; Android uses its
// native cookie jar and must not return them to the WebView.
export const PLAYBACK_INFO_WITH_COOKIES_OUTPUT_TEMPLATE = playbackInfoOutputTemplate(
  `${PLAYBACK_FORMAT_OUTPUT_FIELDS},cookies`,
  true,
  'protocol,width,height,fps,rows,columns,fragments,http_headers,cookies'
)

export class YtDlpPlaybackTimeoutError extends Error {
  constructor() {
    super('yt-dlp playback extraction timed out')
  }
}

/** yt-dlp prints one JSON line for the media and another when an image grid exists. */
export function parseYtDlpPlaybackInfo(stdout, stderr = '') {
  // A client request can time out while yt-dlp still exits successfully with
  // formats from other clients. That partial result must not be cached.
  if (/^WARNING:.*(?:timed?\s*out|time-?out)/mi.test(stderr)) {
    throw new YtDlpPlaybackTimeoutError()
  }

  const [media, ...additional] = stdout.trim().split('\n').map(line => JSON.parse(line))
  if (!media || typeof media !== 'object') throw new Error('yt-dlp returned invalid playback metadata')
  const storyboard = [media, ...additional]
    .find(info => info?.storyboard?.protocol === 'mhtml')?.storyboard
  if (storyboard) media.storyboard = storyboard
  return media
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function toFiniteNumber(value) {
  const number = typeof value === 'string' ? parseFloat(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : null
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function toNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** @param {unknown} value */
function stringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length > 0).slice(0, 100) : []
}

/** @param {Record<string, unknown>} info */
export function mapExternalPlaybackMetadata(info) {
  const duration = toFiniteNumber(info.duration)
  const chapters = Array.isArray(info.chapters) ? info.chapters : []
  return {
    timestamp: toFiniteNumber(info.timestamp),
    releaseDate: toNonEmptyString(info.release_date),
    releaseTimestamp: toFiniteNumber(info.release_timestamp),
    concurrentViewCount: toFiniteNumber(info.concurrent_view_count),
    likeCount: toFiniteNumber(info.like_count),
    dislikeCount: toFiniteNumber(info.dislike_count),
    commentCount: toFiniteNumber(info.comment_count),
    repostCount: toFiniteNumber(info.repost_count),
    saveCount: toFiniteNumber(info.save_count),
    series: toNonEmptyString(info.series),
    season: toNonEmptyString(info.season),
    seasonNumber: toFiniteNumber(info.season_number),
    episode: toNonEmptyString(info.episode),
    episodeNumber: toFiniteNumber(info.episode_number),
    track: toNonEmptyString(info.track),
    trackNumber: toFiniteNumber(info.track_number),
    artists: stringList(info.artists),
    album: toNonEmptyString(info.album),
    genres: stringList(info.genres),
    license: toNonEmptyString(info.license),
    categories: stringList(info.categories),
    tags: stringList(info.tags),
    ageLimit: toFiniteNumber(info.age_limit),
    availability: toNonEmptyString(info.availability),
    mediaType: toNonEmptyString(info.media_type),
    chapters: chapters.flatMap((chapter, index) => {
      if (chapter === null || typeof chapter !== 'object') return []
      const startSeconds = toFiniteNumber(chapter.start_time)
      const next = chapters[index + 1]
      const nextStartSeconds = next && typeof next === 'object' ? toFiniteNumber(next.start_time) : null
      const endSeconds = toFiniteNumber(chapter.end_time) ??
        (startSeconds !== null && nextStartSeconds !== null && nextStartSeconds > startSeconds ? nextStartSeconds : null) ?? duration
      if (startSeconds === null || startSeconds < 0 || (endSeconds !== null && endSeconds <= startSeconds)) return []
      return [{ startSeconds, endSeconds, title: toNonEmptyString(chapter.title) ?? String(index + 1) }]
    })
  }
}

/**
 * @param {Record<string, unknown>} format
 * @returns {YtDlpPlaybackFormat}
 */
export function mapPlaybackFormat(format) {
  const bitrate = toFiniteNumber(format.tbr)

  return {
    formatId: String(format.format_id),
    url: toNonEmptyString(format.url),
    manifestUrl: toNonEmptyString(format.manifest_url),
    protocol: typeof format.protocol === 'string' ? format.protocol : '',
    ext: typeof format.ext === 'string' ? format.ext : '',
    container: toNonEmptyString(format.container),
    vcodec: toNonEmptyString(format.vcodec),
    acodec: toNonEmptyString(format.acodec),
    width: toFiniteNumber(format.width),
    height: toFiniteNumber(format.height),
    fps: toFiniteNumber(format.fps),
    // yt-dlp reports bitrates in kbit/s
    bitrate: bitrate === null ? null : Math.round(bitrate * 1000),
    audioSampleRate: toFiniteNumber(format.asr),
    audioChannels: toFiniteNumber(format.audio_channels),
    language: toNonEmptyString(format.language),
    formatNote: toNonEmptyString(format.format_note),
    dynamicRange: toNonEmptyString(format.dynamic_range),
    availableAt: toFiniteNumber(format.available_at),
    targetDuration: toFiniteNumber(format.target_duration),
    fragmentCount: toFiniteNumber(format['fragments.0.fragment_count']) ??
      (Array.isArray(format.fragments) ? format.fragments.length : null)
  }
}

/**
 * Maps yt-dlp's selected WebVTT subtitles and keeps translated tracks separate,
 * so the player can load translations only when the user selects one.
 * @param {unknown} requestedSubtitles
 * @returns {{ captions: YtDlpPlaybackCaption[], captionTranslations: YtDlpPlaybackCaption[] }}
 */
export function mapPlaybackCaptions(requestedSubtitles, manualSubtitles = null, allowHttp = false) {
  if (requestedSubtitles === null || typeof requestedSubtitles !== 'object') {
    return { captions: [], captionTranslations: [] }
  }

  const captions = new Map()
  const captionTranslations = new Map()

  for (const [requestedLanguage, subtitle] of Object.entries(requestedSubtitles)) {
    if (subtitle === null || typeof subtitle !== 'object') continue
    const mimeType = {
      vtt: 'text/vtt',
      srt: 'text/srt',
      ttml: 'application/ttml+xml',
      dfxp: 'application/ttml+xml'
    }[subtitle.ext]
    if (typeof mimeType !== 'string') continue

    const subtitleUrl = toNonEmptyString(subtitle.url)
    if (subtitleUrl === null) continue

    let url
    try {
      url = new URL(subtitleUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) continue

    const sourceLanguage = toNonEmptyString(url.searchParams.get('lang'))
    const rawTargetLanguage = toNonEmptyString(url.searchParams.get('tlang'))
    const sourceSuffix = sourceLanguage === null ? '' : `-${sourceLanguage}`
    const targetLanguage = rawTargetLanguage?.endsWith(sourceSuffix) && sourceSuffix !== ''
      ? rawTargetLanguage.slice(0, -sourceSuffix.length)
      : rawTargetLanguage
    const isTranslation = targetLanguage !== null && targetLanguage !== sourceLanguage
    const language = isTranslation
      ? targetLanguage
      : sourceLanguage ?? requestedLanguage.replace(/-orig$/, '')
    const subtitleName = toNonEmptyString(subtitle.name)
    const label = subtitleName ?? language
    const manualTracks = manualSubtitles && typeof manualSubtitles === 'object'
      ? manualSubtitles[requestedLanguage]
      : null
    const isManual = Array.isArray(manualTracks) && manualTracks.some(track =>
      track && typeof track === 'object' && track.ext === subtitle.ext && track.url === subtitleUrl
    )
    const caption = {
      url: url.toString(),
      language,
      label,
      mimeType,
      ...(isTranslation
        ? {
            id: `yt-dlp:${requestedLanguage}`,
            translationName: label,
            ...(sourceLanguage === null ? {} : { originalLanguage: sourceLanguage })
          }
        : { isAutoGenerated: !isManual })
    }
    const destination = isTranslation ? captionTranslations : captions
    const existing = destination.get(language)
    const priority = Number(requestedLanguage === language) + Number(subtitleName !== null)

    if (existing === undefined || priority > existing.priority) {
      destination.set(language, { caption, priority })
    }
  }

  return {
    captions: [...captions.values()].map(({ caption }) => caption),
    captionTranslations: [...captionTranslations.values()].map(({ caption }) => caption)
  }
}
