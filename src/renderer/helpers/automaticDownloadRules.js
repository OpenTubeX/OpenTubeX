export const DEFAULT_AUTOMATIC_DOWNLOAD_RULE = Object.freeze({
  template: 'video:best',
  enabledAt: null,
  includeVideos: true,
  includeShorts: false,
  includeLivestreams: false,
  minDurationSeconds: null,
  maxDurationSeconds: null,
  minFileSizeMb: null,
  maxFileSizeMb: null,
  maxAgeDays: null,
  titleIncludes: '',
  titleExcludes: ''
})

/**
 * @param {string} value
 * @returns {Record<string, object>}
 */
export function parseAutomaticDownloadRules(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    console.error('Failed to parse automatic download rules:', error)
    return {}
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * @param {object} rule
 */
export function normalizeAutomaticDownloadRule(rule = {}) {
  return {
    ...DEFAULT_AUTOMATIC_DOWNLOAD_RULE,
    ...rule,
    template: typeof rule.template === 'string' && rule.template !== ''
      ? rule.template
      : DEFAULT_AUTOMATIC_DOWNLOAD_RULE.template,
    enabledAt: optionalPositiveNumber(rule.enabledAt),
    includeVideos: rule.includeVideos !== false,
    includeShorts: rule.includeShorts === true,
    includeLivestreams: rule.includeLivestreams === true,
    minDurationSeconds: optionalPositiveNumber(rule.minDurationSeconds),
    maxDurationSeconds: optionalPositiveNumber(rule.maxDurationSeconds),
    minFileSizeMb: optionalPositiveNumber(rule.minFileSizeMb),
    maxFileSizeMb: optionalPositiveNumber(rule.maxFileSizeMb),
    maxAgeDays: optionalPositiveNumber(rule.maxAgeDays),
    titleIncludes: typeof rule.titleIncludes === 'string' ? rule.titleIncludes : '',
    titleExcludes: typeof rule.titleExcludes === 'string' ? rule.titleExcludes : ''
  }
}

function getDurationSeconds(video) {
  if (Number.isFinite(Number(video.lengthSeconds)) && Number(video.lengthSeconds) > 0) {
    return Number(video.lengthSeconds)
  }

  if (typeof video.lengthSeconds === 'string' && /^\d+(?::[0-5]?\d){1,2}$/.test(video.lengthSeconds)) {
    const seconds = video.lengthSeconds.split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return seconds > 0 ? seconds : null
  }

  return null
}

function getTerms(value) {
  return value.split(',').map(term => term.trim().toLocaleLowerCase()).filter(Boolean)
}

/**
 * @param {object} video
 * @param {'videos' | 'shorts' | 'live'} source
 * @param {object} rawRule
 * @param {number} [now]
 */
export function matchesAutomaticDownloadRule(video, source, rawRule, now = Date.now()) {
  if (video?.isNewInSubscriptionFeed !== true || typeof video.videoId !== 'string') {
    return false
  }

  const rule = normalizeAutomaticDownloadRule(rawRule)
  const isLivestream = source === 'live' || video.liveNow === true || video.isUpcoming === true || video.premiere === true

  // An upcoming stream has no complete file yet. It can be picked up by a
  // later live-feed refresh after it starts.
  if (video.isUpcoming === true || video.premiere === true) {
    return false
  }
  if (source === 'shorts' ? !rule.includeShorts : isLivestream ? !rule.includeLivestreams : !rule.includeVideos) {
    return false
  }

  const duration = getDurationSeconds(video)
  // RSS feeds do not provide a usable duration. Keep the candidate so yt-dlp
  // can apply the same min/max constraints after it extracts real metadata.
  if (duration !== null && (
    (rule.minDurationSeconds !== null && duration < rule.minDurationSeconds) ||
    (rule.maxDurationSeconds !== null && duration > rule.maxDurationSeconds)
  )) {
    return false
  }

  const published = Number(video.subscriptionFeedPublished ?? video.published)
  if (rule.enabledAt !== null && (!Number.isFinite(published) || published < rule.enabledAt)) {
    return false
  }
  if (rule.maxAgeDays !== null && Number.isFinite(published) &&
    published < now - rule.maxAgeDays * 24 * 60 * 60 * 1000) {
    return false
  }

  const title = String(video.title ?? '').toLocaleLowerCase()
  const includedTerms = getTerms(rule.titleIncludes)
  const excludedTerms = getTerms(rule.titleExcludes)

  return (includedTerms.length === 0 || includedTerms.some(term => title.includes(term))) &&
    !excludedTerms.some(term => title.includes(term))
}
