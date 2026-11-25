import autolinker from 'autolinker'

const SHORT_NUMERIC_HASHTAG_PATTERN = /^\p{Number}{1,2}$/u

function linkYouTubeMatch(match) {
  if (match.type === 'hashtag' && SHORT_NUMERIC_HASHTAG_PATTERN.test(match.getHashtag())) {
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

/**
 * @param {string} label
 * @param {string} href
 */
function isShortenedUrl(label, href) {
  const withoutScheme = url => url.replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
  const shortened = withoutScheme(label.trim().replace(/(?:\.\.\.|…)$/, ''))
  // A label without a dot, such as `youtube`, is a word rather than a host.
  return /^https?:\/\//.test(href) && shortened.includes('.') && withoutScheme(href).startsWith(shortened)
}

/**
 * The text of an HTML description, e.g. formatted text runs from the local API.
 * @param {string} description
 * @returns {string}
 */
export function getDescriptionText(description) {
  // Template contents stay inert while extracting text from remote HTML.
  const template = document.createElement('template')
  template.innerHTML = description
  // Links shown as an icon and a label, or as a shortened URL like Invidious
  // shows them, copy as their URL.
  for (const link of template.content.querySelectorAll('a[href]')) {
    // Invidious posts link YouTube pages relative to the app, see `parseInvidiousCommunityData`.
    const href = link.getAttribute('href').replace(/^#?\//, 'https://www.youtube.com/')
    if (link.hasAttribute('data-link-icon') || isShortenedUrl(link.textContent ?? '', href)) {
      link.replaceWith(href)
    }
  }
  // Invidious separates lines with `<br>`, which has no text of its own.
  for (const lineBreak of template.content.querySelectorAll('br')) {
    lineBreak.replaceWith('\n')
  }
  return template.content.textContent ?? ''
}
