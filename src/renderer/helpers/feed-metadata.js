export const CHANNEL_HANDLE_REGEX = /^@[\w.-]{3,30}$/

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
  } else if (timeFrame.startsWith('minute') || timeFrame === 'm') {
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
