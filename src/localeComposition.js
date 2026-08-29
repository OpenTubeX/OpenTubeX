/**
 * Return the base-language locale when it is available as a human catalog.
 *
 * @param {string} locale
 * @param {ReadonlyMap<string, unknown>} humanMessages
 * @returns {string | null}
 */
function getBaseLocale(locale, humanMessages) {
  const separatorIndex = locale.indexOf('-')
  if (separatorIndex === -1) return null

  const baseLocale = locale.slice(0, separatorIndex)
  return humanMessages.has(baseLocale) ? baseLocale : null
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isMessageObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Empty translation values must behave like missing values because vue-i18n
 * does not fall back from an empty string.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function hasTranslationValue(value) {
  if (isMessageObject(value)) {
    return Object.keys(value).length > 0
  }

  return value !== '' && value !== null && value !== undefined && value !== false
}

/**
 * Fill missing leaves in target without replacing existing translations.
 *
 * @param {Record<string, unknown>} target
 * @param {unknown} source
 */
function fillMissingMessages(target, source) {
  if (!isMessageObject(source)) return

  for (const [key, sourceValue] of Object.entries(source)) {
    if (!hasTranslationValue(sourceValue)) continue

    const targetValue = target[key]
    if (isMessageObject(sourceValue)) {
      if (!isMessageObject(targetValue)) {
        if (hasTranslationValue(targetValue)) continue
        target[key] = {}
      }

      fillMissingMessages(/** @type {Record<string, unknown>} */ (target[key]), sourceValue)
      if (Object.keys(/** @type {Record<string, unknown>} */ (target[key])).length === 0) {
        delete target[key]
      }
    } else if (!hasTranslationValue(targetValue)) {
      target[key] = structuredClone(sourceValue)
    }
  }
}

/**
 * Compose one locale without mutating any source catalog.
 *
 * Human translations have priority over generated completions. For regional
 * locales with an available base catalog, the base human catalog also has
 * priority over both generated catalogs.
 *
 * @param {{
 *   locale: string,
 *   humanMessages: ReadonlyMap<string, unknown>,
 *   aiMessages?: ReadonlyMap<string, unknown>,
 *   includeAI?: boolean
 * }} options
 * @returns {Record<string, unknown>}
 */
export function composeLocaleMessages({
  locale,
  humanMessages,
  aiMessages = new Map(),
  includeAI = false,
}) {
  const messages = {}
  const baseLocale = getBaseLocale(locale, humanMessages)

  fillMissingMessages(messages, humanMessages.get(locale))
  if (baseLocale) fillMissingMessages(messages, humanMessages.get(baseLocale))

  if (includeAI) {
    fillMissingMessages(messages, aiMessages.get(locale))
    if (baseLocale) fillMissingMessages(messages, aiMessages.get(baseLocale))
  }

  return messages
}
