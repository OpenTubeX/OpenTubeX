/** Build the same yt-dlp options for desktop, Android, and iOS. */
export const ID_REGEX = /^[\w-]{11}$/
export const PLAYLIST_ID_REGEX = /^[\w-]{10,128}$/
export const DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT = 200
const QUALITY_REGEX = /^\d{3,4}$/
const VIDEO_FORMATS = ['mp4', 'mkv', 'webm']
const VIDEO_CODECS = ['h264', 'h265', 'vp9', 'av1']
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac']
export const SUBTITLE_FORMATS = ['srt', 'vtt', 'ass', 'lrc']
export function isYtDlpMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
export function playbackImpersonationArguments(url) {
  const hostname = new URL(url).hostname.toLowerCase()
  return hostname === 'rumble.com' || hostname.endsWith('.rumble.com')
    ? ['--impersonate', 'chrome']
    : []
}
export function playbackSubtitleArguments(isYouTubeVideo) {
  return [
    ...(!isYouTubeVideo ? ['--write-subs'] : []),
    '--write-auto-subs', '--sub-langs', 'all',
    '--sub-format', isYouTubeVideo ? 'vtt' : 'vtt/srt/ttml/dfxp'
  ]
}
/**
 * Lets desktop yt-dlp solve YouTube's JavaScript challenges with Electron's bundled
 * Node.js (run with `ELECTRON_RUN_AS_NODE=1`) when Deno is not installed.
 * Builds before 2025.11.12 reject the option, so skip them and unknown versions.
 * @param {string | null} version
 * @param {string} nodePath
 */
export function jsRuntimeArguments(version, nodePath) {
  const date = /^\d{4}\.\d{2}\.\d{2}/.exec(version ?? '')?.[0]
  return date !== undefined && date >= '2025.11.12' ? ['--js-runtimes', `node:${nodePath}`] : []
}
const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler']
// Keeps local-playlist URLs comfortably below Windows' process command-line limit.
export const MAX_LOCAL_PLAYLIST_VIDEOS = 500
// Options that run programs, load configs or inputs, replace yt-dlp, or write
// files outside the download folder (a written config can carry `--exec`).
// Metadata options can set internal fields such as `__finaldir` and
// `filepath`, which move or write the download anywhere, compatibility
// options can turn off yt-dlp's file extension safety checks, and trimming
// file names can cut a checked folder name down to `..`.
const DENIED_CUSTOM_ARGS = [
  '--alias',
  '--batch-file',
  '--cache-dir',
  '--compat-options',
  '--config-location',
  '--config-locations',
  '--cookies',
  '--download-archive',
  '--downloader',
  '--downloader-args',
  '--exec',
  '--exec-before-download',
  '--external-downloader',
  '--external-downloader-args',
  '--ffmpeg-location',
  '--js-runtimes',
  '--load-info-json',
  '--load-pages',
  '--metadata-from-title',
  '--netrc-cmd',
  '--output',
  '--output-na-placeholder',
  '--parse-metadata',
  '--paths',
  '--plugin-dirs',
  '--postprocessor-args',
  '--ppa',
  '--print-to-file',
  '--remote-components',
  '--replace-in-metadata',
  '--trim-file-names',
  '--trim-filenames',
  '--update',
  '--update-to',
  '--use-postprocessor',
  '--write-pages'
]
// Exact options win over abbreviations, so these prefixes of denied options are safe.
const ALLOWED_PREFIXES = ['--netrc', '--print']
// -U/--update, -a/--batch-file, -P/--paths and -o/--output
const DENIED_SHORT_ARGS = 'UaPo'
// Short options that take a value consume the rest of a combined argument such as `-fbest`.
const SHORT_ARGS_WITH_VALUES = '2INOPRSafoprtu'
/**
 * yt-dlp accepts unambiguous prefixes of long options, so `--exec-befor` runs `--exec-before-download`,
 * and combined short options, so `-xo` is `-x -o`.
 */
export function isDeniedCustomArgument(argument) {
  // Everything after `--` is a URL, including the options OpenTubeX adds later.
  if (argument === '--') return true
  if (/^-[^-]/.test(argument)) {
    for (const option of argument.slice(1)) {
      if (DENIED_SHORT_ARGS.includes(option)) return true
      if (SHORT_ARGS_WITH_VALUES.includes(option)) return false
    }
    return false
  }
  const option = argument.split('=')[0]
  return option.startsWith('--') && option.length > 2 && !ALLOWED_PREFIXES.includes(option) &&
    DENIED_CUSTOM_ARGS.some(denied => denied.startsWith(option))
}
const TIME_REGEX = /^(?:\d+:)?[0-5]?\d:[0-5]\d(?:\.\d+)?$/
export const AUTOMATIC_NUMBER_LIMITS = Object.freeze({
  minDurationSeconds: 31_536_000,
  maxDurationSeconds: 31_536_000,
  minFileSizeMb: 1_000_000,
  maxFileSizeMb: 1_000_000,
  maxAgeDays: 36_500
})
export function splitArguments(argsString) {
  const args = []
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g

  let match
  while ((match = tokenRegex.exec(argsString)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3])
  }

  return args
}

export function automaticNumber(value, maximum) {
  return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= maximum
    ? Number(value)
    : null
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function automaticTitleRegex(includedTerms, excludedTerms) {
  if (includedTerms.length === 0 && excludedTerms.length === 0) {
    return null
  }

  const include = includedTerms.length === 0
    ? ''
    : `(?=.*(?:${includedTerms.map(escapeRegularExpression).join('|')}))`
  const exclude = excludedTerms.length === 0
    ? ''
    : `(?!.*(?:${excludedTerms.map(escapeRegularExpression).join('|')}))`
  return `(?i)^${include}${exclude}.*$`
}

// yt-dlp reads `TYPES:` before an output template as the files it applies to,
// such as `thumbnail:/absolute/path`.
const OUTPUT_TEMPLATE_TYPES = 'chapter|subtitle|thumbnail|description|annotation|infojson|link|pl_video|pl_thumbnail|pl_description|pl_infojson'
const OUTPUT_TEMPLATE_TYPE_PREFIX = new RegExp(`^(?:${OUTPUT_TEMPLATE_TYPES})(?:,(?:${OUTPUT_TEMPLATE_TYPES}))*:`, 'i')
/**
 * Whether a download filename template is a relative path that stays in the
 * download folder. yt-dlp ignores `--paths` for absolute templates and expands
 * `~` and environment variables, so those, drive letters and `..` segments are
 * refused. `%` is refused as well because raw `%(...)` fields with literal
 * defaults can expand to `..`; templates use the `{field}` placeholders.
 * @param {unknown} template
 */
export function isSafeDownloadFilenameTemplate(template) {
  // Anything else falls back to the default template.
  if (typeof template !== 'string') return true
  const value = template.trim()
  // A field before a colon in the first segment can form a Windows drive, as in `{author}:/x`.
  return !/[$%]/.test(value) && !/^[^/\\]*\}[^/\\]*:/.test(value) && !leavesDownloadFolder(value)
}
/** @param {string} template */
function leavesDownloadFolder(template) {
  return /^(?:[/\\~]|[a-z]:)/i.test(template) ||
    OUTPUT_TEMPLATE_TYPE_PREFIX.test(template) ||
    template.split(/[/\\]/).some((segment, index, segments) => {
      if (/^\s*\.{2,}\s*$/.test(segment)) return true
      if (index === segments.length - 1) return false
      // A folder's fields can expand to nothing, so its other text must not be dots alone.
      const literal = segment.replaceAll(/\{[^}]*\}|%\([^)]*\)[^a-zA-Z]*[a-zA-Z]/g, '')
      return /^[\s.]*$/.test(literal) && literal.split('.').length > 2
    })
}
// Characters that --restrict-filenames normalizes to dots.
const DOT_LIKE_CHARACTERS = '.\\u2024\\u2025\\u2026\\ufe19\\ufe30\\ufe52\\uff0e'
/**
 * A Python pattern for --replace-in-metadata that matches field values yt-dlp
 * may turn into `.` or `..`. yt-dlp keeps such a value as a directory name, which
 * then leaves the download folder. Sanitizing can drop control characters and,
 * with --restrict-filenames, non-ASCII ones, but never ASCII letters or digits.
 * Titles are cut to 200 bytes, which keeps at least their first 50 characters,
 * so only a letter or digit among those counts.
 */
export const DOT_FIELD_PATTERN = `^(?![\\s\\S]{0,49}[A-Za-z0-9])(?=[\\s\\S]*[${DOT_LIKE_CHARACTERS}])[\\s\\S]*\\Z`
export function buildYtDlpDownloadArguments(payload, globalArguments = '') {
  if (!payload || !['video', 'audio', 'subtitles', 'custom'].includes(payload.mode)) throw new Error('invalid-download')
  const videoIds = payload.videoIds ?? []
  if (!Array.isArray(videoIds) || videoIds.some(id => typeof id !== 'string' || !ID_REGEX.test(id))) throw new Error('invalid-video-ids')
  if (videoIds.length > MAX_LOCAL_PLAYLIST_VIDEOS) throw new Error('too-many-videos')
  const isRemotePlaylist = payload.isPlaylist === true && typeof payload.playlistId === 'string' && PLAYLIST_ID_REGEX.test(payload.playlistId)
  const externalUrl = payload.externalUrl
  if (externalUrl !== undefined && (!isYtDlpMediaUrl(externalUrl) || payload.isPlaylist === true || ID_REGEX.test(payload.videoId ?? '') || videoIds.length > 0 || payload.automatic === true)) {
    throw new Error('invalid-media-url')
  }
  if (externalUrl === undefined && !isRemotePlaylist && !ID_REGEX.test(payload.videoId ?? '') && videoIds.length === 0) throw new Error('invalid-video-id')
  const subtitlesOnly = payload.mode === 'subtitles'
  const subtitleFormat = SUBTITLE_FORMATS.includes(payload.subtitleFormat) ? payload.subtitleFormat : ''
  const customArgs = splitArguments(payload.customArgs || '')
  const globalCustomArgs = splitArguments(globalArguments)
  if ([...globalCustomArgs, ...customArgs].some(isDeniedCustomArgument)) throw new Error('unsupported-custom-argument')
  if (!isSafeDownloadFilenameTemplate(payload.filenameTemplate)) throw new Error('invalid-filename-template')
  const args = [...globalCustomArgs]
  if (!isRemotePlaylist) args.push('--no-playlist')
  let outputTemplate = typeof payload.filenameTemplate === 'string' && payload.filenameTemplate.trim() !== ''
    ? payload.filenameTemplate.trim()
    : '{title} [{id}].{ext}'
  const truncatesLongTitles = outputTemplate.includes('{title}')
  let localPlaylistTitle = typeof payload.title === 'string'
    // yt-dlp expands ~ and $VARIABLES in output templates, which contain this title literally
    ? payload.title.replaceAll(/[<>:"/\\|?*$]/g, '_').replace(/^~/, '_')
      .split('').map(character => {
        if (character.charCodeAt(0) < 32) return '_'
        return character
      }).join('')
      .replace(/[. ]+$/, '').slice(0, 120) || 'Playlist'
    : 'Playlist'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(localPlaylistTitle)) {
    localPlaylistTitle = `_${localPlaylistTitle}`
  }
  localPlaylistTitle = localPlaylistTitle.replaceAll('%', '%%')
  const templateFields = {
    title: `%(title).${DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT}B`,
    author: '%(uploader)s',
    upload_date: '%(upload_date)s',
    id: '%(id)s',
    playlist: isRemotePlaylist ? '%(playlist_title)s' : localPlaylistTitle,
    playlist_index: isRemotePlaylist ? '%(playlist_index)03d' : '%(autonumber)03d',
    ext: '%(ext)s'
  }
  for (const [field, replacement] of Object.entries(templateFields)) {
    outputTemplate = outputTemplate.replaceAll(`{${field}}`, replacement)
  }
  if (!outputTemplate.includes('%(ext)')) {
    outputTemplate += '.%(ext)s'
  }
  if (payload.isPlaylist === true && !outputTemplate.includes('%(playlist') && !outputTemplate.startsWith(`${localPlaylistTitle}/`)) {
    outputTemplate = isRemotePlaylist
      ? `%(playlist_title)s/%(playlist_index)03d - ${outputTemplate}`
      : `${localPlaylistTitle}/%(autonumber)03d - ${outputTemplate}`
  }
  // The playlist title is inserted literally, so check the result as well.
  if (leavesDownloadFolder(outputTemplate)) throw new Error('invalid-filename-template')
  // Text fields that name a folder are checked for dot-only values.
  const directoryFields = [...new Set([...outputTemplate.split(/[/\\]/).slice(0, -1).join('/').matchAll(/%\((\w+)/g)]
    .map(match => match[1]))].filter(field => ['title', 'uploader', 'id', 'playlist_title', 'upload_date', 'ext'].includes(field))
  args.push('--output', outputTemplate)

  switch (payload.mode) {
    case 'video': {
      const formatSorting = []
      if (typeof payload.quality === 'string' && QUALITY_REGEX.test(payload.quality)) {
        formatSorting.push(`res:${payload.quality}`)
      }
      if (typeof payload.videoCodec === 'string' && VIDEO_CODECS.includes(payload.videoCodec)) {
        formatSorting.push(`codec:${payload.videoCodec}`)
      }
      if (formatSorting.length > 0) {
        args.push('-S', formatSorting.join(','))
      }
      if (typeof payload.videoFormat === 'string' && VIDEO_FORMATS.includes(payload.videoFormat)) {
        args.push('--merge-output-format', payload.videoFormat, '--remux-video', payload.videoFormat)
      }
      break
    }
    case 'audio':
      args.push('--extract-audio')
      if (typeof payload.audioFormat === 'string' && AUDIO_FORMATS.includes(payload.audioFormat)) {
        args.push('--audio-format', payload.audioFormat)
      }
      break
    case 'subtitles':
      // `--print` turns on quiet mode, which hides the lines naming the written
      // subtitle files. Nothing else reports them, as only the media file yt-dlp
      // isn't downloading here would reach the `after_move` print below.
      args.push('--skip-download', '--no-quiet')
      break
    case 'custom':
      break
  }

  if (!subtitlesOnly && payload.splitChapters === true) {
    args.push('--split-chapters')
  }
  if (!subtitlesOnly && payload.removeSponsorblock === true) {
    const categories = Array.isArray(payload.sponsorBlockCategories)
      ? payload.sponsorBlockCategories.filter(category => SPONSORBLOCK_CATEGORIES.includes(category))
      : SPONSORBLOCK_CATEGORIES
    if (categories.length > 0) args.push('--sponsorblock-remove', categories.join(','))
  }
  if (subtitlesOnly || payload.includeSubtitles === true) {
    // YouTube advertises a machine translation of every subtitle track into every other
    // language, which multiplies a language selector like `de.*` into dozens of requests
    // and runs into its rate limiting. Custom arguments can override this again.
    args.push('--write-subs', '--write-auto-subs', '--extractor-args', 'youtube:skip=translated_subs')
    if (!subtitlesOnly && payload.embedSubtitles === true) {
      args.push('--embed-subs')
    }
    if (typeof payload.subtitleLanguages === 'string' && payload.subtitleLanguages.trim() !== '') {
      args.push('--sub-langs', payload.subtitleLanguages.trim())
    }
    if (subtitleFormat !== '') {
      // YouTube serves most formats itself, so prefer downloading the requested one directly.
      // The converter only runs once every track has downloaded, so it would otherwise leave
      // the original files behind whenever a download fails partway through.
      args.push('--sub-format', `${subtitleFormat}/best`, '--convert-subs', subtitleFormat)
    }
  }
  if (!subtitlesOnly && payload.embedThumbnail === true) {
    args.push('--embed-thumbnail')
  }
  if (!subtitlesOnly && payload.embedMetadata === true) {
    args.push('--embed-metadata', '--embed-chapters')
  }
  if (payload.automatic === true) {
    const minDurationSeconds = automaticNumber(payload.minDurationSeconds, AUTOMATIC_NUMBER_LIMITS.minDurationSeconds)
    const maxDurationSeconds = automaticNumber(payload.maxDurationSeconds, AUTOMATIC_NUMBER_LIMITS.maxDurationSeconds)
    const minFileSizeMb = automaticNumber(payload.minFileSizeMb, AUTOMATIC_NUMBER_LIMITS.minFileSizeMb)
    const maxFileSizeMb = automaticNumber(payload.maxFileSizeMb, AUTOMATIC_NUMBER_LIMITS.maxFileSizeMb)
    const maxAgeDays = automaticNumber(payload.maxAgeDays, AUTOMATIC_NUMBER_LIMITS.maxAgeDays)
    const titleRegex = automaticTitleRegex(
      Array.isArray(payload.titleIncludes) ? payload.titleIncludes : [],
      Array.isArray(payload.titleExcludes) ? payload.titleExcludes : []
    )
    const durationFilters = [
      `channel_id = ${payload.channelId}`,
      minDurationSeconds === null ? null : `duration >= ${minDurationSeconds}`,
      maxDurationSeconds === null ? null : `duration <= ${maxDurationSeconds}`
    ].filter(Boolean)

    if (durationFilters.length > 0) args.push('--match-filter', durationFilters.join(' & '))
    if (minFileSizeMb !== null) args.push('--min-filesize', `${minFileSizeMb}M`)
    if (maxFileSizeMb !== null) args.push('--max-filesize', `${maxFileSizeMb}M`)
    if (maxAgeDays !== null) args.push('--dateafter', `now-${Math.ceil(maxAgeDays)}days`)
    if (titleRegex !== null) args.push('--match-title', titleRegex)
    args.push('--no-overwrites')
  }
  const startTime = !subtitlesOnly && typeof payload.startTime === 'string' && TIME_REGEX.test(payload.startTime) ? payload.startTime : ''
  const endTime = !subtitlesOnly && typeof payload.endTime === 'string' && TIME_REGEX.test(payload.endTime) ? payload.endTime : ''
  if (startTime !== '' || endTime !== '') {
    args.push('--download-sections', `*${startTime || '0'}-${endTime || 'inf'}`, '--force-keyframes-at-cuts')
  }
  args.push(
    ...customArgs,
    '--no-simulate',
    '--print', 'video:__OPENTUBEX_PREPARING__:%(id)s',
    '--progress-template', 'download:__OPENTUBEX_DOWNLOAD__:%(progress.status)s\t%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s',
    '--progress-template', 'postprocess:__OPENTUBEX_PROCESSING__'
  )

  if (externalUrl !== undefined) {
    args.push(new URL(externalUrl).href)
  } else if (isRemotePlaylist) {
    args.push(`https://www.youtube.com/playlist?list=${payload.playlistId}`)
  } else if (videoIds.length > 0) {
    args.push(...videoIds.map(videoId => `https://www.youtube.com/watch?v=${videoId}`))
  } else {
    args.push(`https://www.youtube.com/watch?v=${payload.videoId}`)
  }

  return { args, truncatesLongTitles, directoryFields }
}
