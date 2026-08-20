import autolinker from 'autolinker'

const SHORT_NUMERIC_HASHTAG_PATTERN = /^\p{Number}{1,2}$/u

function linkYouTubeMatch(match) {
  if (match.getType() === 'hashtag' && SHORT_NUMERIC_HASHTAG_PATTERN.test(match.getHashtag())) {
    return false
  }

  return true
}

// YouTube only links the `#hashtags` and `@handles` that it recognised itself,
// the rest stays plain text, so we link those ourselves.
// Autolinker skips text inside existing links and HTML attributes,
// so the ones that came linked from the backend are left untouched.
const HASHTAG_AND_HANDLE_OPTIONS = {
  hashtag: 'youtube',
  mention: 'youtube',
  // YouTube treats one- and two-digit `#` sequences as numbering. Numeric
  // hashtags become links once they contain at least three digits.
  replaceFn: linkYouTubeMatch
}

/**
 * Links URLs, e-mail addresses, `#hashtags` and `@handles` in a plain text description.
 * @param {string} description
 * @returns {string}
 */
export function linkifyDescription(description) {
  return autolinker.link(description, HASHTAG_AND_HANDLE_OPTIONS)
}

/**
 * Links only the `#hashtags` and `@handles` in text that is already HTML,
 * e.g. a description where the backend linked everything else already.
 * @param {string} html
 * @returns {string}
 */
export function linkifyHashtagsAndHandles(html) {
  return autolinker.link(html, {
    ...HASHTAG_AND_HANDLE_OPTIONS,
    urls: false,
    email: false,
    phone: false
  })
}
