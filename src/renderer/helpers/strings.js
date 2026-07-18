import i18n from '../i18n/index'

const WINDOW_TITLE_TRANSLATION_KEYS = {
  Subscriptions: 'Subscriptions.Subscriptions',
  Channels: 'Channels.Title',
  Trending: 'Trending.Trending',
  'Most Popular': 'Most Popular',
  'Your Playlists': 'User Playlists.Your Playlists',
  History: 'History.History',
  Stats: 'Stats.Stats',
  Settings: 'Settings.Settings',
  About: 'About.About',
  'Profile Settings': 'Profile.Profile Settings',
  Playlist: 'Playlist.Playlist'
}

/**
 * This will return true if a string is null, undefined or empty.
 * @param {string|null|undefined} _string the string to process
 * @returns {boolean} whether the string is empty or not
 */
export function isNullOrEmpty(_string) {
  return _string == null || _string === ''
}

/**
 * Is KeyboardEvent.key a printable char
 * @param {string} eventKey the string from KeyboardEvent.key to process
 * @returns {boolean} whether the string from KeyboardEvent.key is a printable char or not
 */
export function isKeyboardEventKeyPrintableChar(eventKey) {
  // Most printable chars are all strings with length 1 (except Unicode)
  // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
  // https://www.w3.org/TR/DOM-Level-3-Events-key/
  if (eventKey.length === 1) { return true }
  // Emoji
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape
  if (/\p{Emoji_Presentation}/u.test(eventKey)) { return true }

  return false
}

/**
 * @param {string} title
 */
export function translateWindowTitle(title) {
  const translationKey = WINDOW_TITLE_TRANSLATION_KEYS[title]

  if (!translationKey) {
    return null
  }

  // Locale messages load asynchronously during startup. Returning null keeps
  // the restored tab title intact until its translation is available.
  const locale = i18n.global.locale.value
  if (!i18n.global.te(translationKey, locale)) {
    return null
  }

  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  return i18n.global.t(translationKey)
}

/**
 * Returns the first user-perceived character,
 * respecting language specific rules and
 * emojis made up of multiple codepoints
 * like flags, families and skin tone modifiers.
 * @param {string} text
 * @param {string} locale
 * @returns {string}
 */
export function getFirstCharacter(text, locale) {
  if (text.length === 0) {
    return ''
  }

  const segmenter = new Intl.Segmenter([locale, 'en'], { granularity: 'grapheme' })

  // Use iterator directly as we only need the first segment
  const firstSegment = segmenter.segment(text)[Symbol.iterator]().next().value
  return firstSegment.segment
}
