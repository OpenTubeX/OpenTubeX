/**
 * A handle as typed: 3 to 30 letters and digits from any script, `_`, `-`, `.`, and `·`.
 * Han and Hangul handles can be 1 character long, and Hiragana, Katakana, and Ethiopic ones 2.
 */
export const CHANNEL_HANDLE_REGEX = /^@(?:[\p{L}\p{M}\p{N}_.·-]{3,30}|[\p{scx=Han}\p{scx=Hangul}]{1,2}|[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Ethiopic}]{2})$/u

/**
 * Servers can send any text in their handle fields, so only handles are kept.
 * @param {unknown} value
 * @returns {string | null} the handle including its leading `@`
 */
export function normalizeChannelHandle(value) {
  if (typeof value !== 'string') return null
  const handle = value.trim()
  return /^@[^\s/?#@]+$/u.test(handle) ? handle : null
}

/**
 * @param {unknown} url a channel URL such as `http://www.youtube.com/@name`
 * @returns {string | null} the handle including its leading `@`
 */
export function getChannelHandleFromUrl(url) {
  if (typeof url !== 'string' || url === '') return null
  try {
    const segment = new URL(url, 'https://www.youtube.com').pathname.split('/')[1]
    return normalizeChannelHandle(decodeURIComponent(segment))
  } catch {
    return null
  }
}

const PUBLISHED_TEXT_REGEX = /(\d+)\s?([a-z]+)/i

/**
 * @param {string} publishedText
 * @param {boolean} isLive
 * @param {boolean} isUpcoming
 * @param {Date|undefined} premiereDate
 */
export function calculatePublishedDate(publishedText, isLive = false, isUpcoming = false, premiereDate = undefined) {
  const now = Date.now()

  if (isLive) {
    return now
  } else if (isUpcoming) {
    if (premiereDate) {
      return premiereDate.getTime()
    } else {
      // should never happen but just to be sure that we always return a number
      return now
    }
  }

  if (!publishedText) {
    return undefined
  }

  const match = publishedText.match(PUBLISHED_TEXT_REGEX)

  if (!match) return undefined

  const timeFrame = match[2].toLowerCase()
  const timeAmount = parseInt(match[1])
  let timeSpan = null

  if (timeFrame.startsWith('second') || timeFrame === 's') {
    timeSpan = timeAmount * 1000
  } else if (timeFrame.startsWith('minute') || timeFrame === 'min' || timeFrame === 'm') {
    timeSpan = timeAmount * 60000
  } else if (timeFrame.startsWith('hour') || timeFrame === 'h') {
    timeSpan = timeAmount * 3600000
  } else if (timeFrame.startsWith('day') || timeFrame === 'd') {
    timeSpan = timeAmount * 86400000
  } else if (timeFrame.startsWith('week') || timeFrame === 'w') {
    timeSpan = timeAmount * 604800000
  } else if (timeFrame.startsWith('month') || timeFrame === 'mo') {
    // 30 day month being used
    timeSpan = timeAmount * 2592000000
  } else if (timeFrame.startsWith('year') || timeFrame === 'y') {
    timeSpan = timeAmount * 31556952000
  }

  return timeSpan === null ? undefined : now - timeSpan
}

export function extractNumberFromString(str) {
  if (typeof str === 'string') {
    return parseInt(str.replaceAll(/\D+/g, ''))
  } else {
    return NaN
  }
}

/**
 * Escapes HTML tags to avoid XSS
 * @param {string} untrusted
 * @returns {string}
 */
export function escapeHTML(untrusted) {
  return untrusted.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}
