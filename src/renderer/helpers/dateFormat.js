export const DEFAULT_DATE_FORMAT = 'locale'
export const DEFAULT_TIME_FORMAT = 'locale'

export const DATE_FORMAT_OPTIONS = Object.freeze([
  DEFAULT_DATE_FORMAT,
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD.MM.YYYY',
  'MM.DD.YYYY',
])

export const TIME_FORMAT_OPTIONS = Object.freeze([
  DEFAULT_TIME_FORMAT,
  '12-hour',
  '24-hour',
])

const CUSTOM_DATE_FORMATS = Object.freeze({
  'MM/DD/YYYY': { order: ['month', 'day', 'year'], separator: '/' },
  'DD/MM/YYYY': { order: ['day', 'month', 'year'], separator: '/' },
  'YYYY-MM-DD': { order: ['year', 'month', 'day'], separator: '-' },
  'YYYY/MM/DD': { order: ['year', 'month', 'day'], separator: '/' },
  'DD.MM.YYYY': { order: ['day', 'month', 'year'], separator: '.' },
  'MM.DD.YYYY': { order: ['month', 'day', 'year'], separator: '.' },
})

const formatterCache = new Map()

/**
 * @param {string} dateFormat
 * @returns {string}
 */
export function normalizeDateFormat(dateFormat) {
  return DATE_FORMAT_OPTIONS.includes(dateFormat) ? dateFormat : DEFAULT_DATE_FORMAT
}

/**
 * @param {string} timeFormat
 * @returns {string}
 */
export function normalizeTimeFormat(timeFormat) {
  return TIME_FORMAT_OPTIONS.includes(timeFormat) ? timeFormat : DEFAULT_TIME_FORMAT
}

/**
 * @param {string} timeFormat
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {Intl.DateTimeFormatOptions}
 */
function resolveTimeOptions(timeFormat, options) {
  const normalizedFormat = normalizeTimeFormat(timeFormat)
  const resolvedOptions = { ...options }

  if (normalizedFormat !== DEFAULT_TIME_FORMAT) {
    delete resolvedOptions.hour12
    resolvedOptions.hourCycle = normalizedFormat === '12-hour' ? 'h12' : 'h23'
  }

  return resolvedOptions
}

/**
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {Intl.DateTimeFormat}
 */
function getFormatter(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = formatterCache.get(key)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat([locale, 'en'], options)
    formatterCache.set(key, formatter)
  }

  return formatter
}

/**
 * @param {Date | number} date
 * @param {string} locale
 * @param {string} dateFormat
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {string}
 */
export function formatDate(date, locale, dateFormat = DEFAULT_DATE_FORMAT, options = {}) {
  const normalizedFormat = normalizeDateFormat(dateFormat)
  if (normalizedFormat === DEFAULT_DATE_FORMAT) {
    return getFormatter(locale, options).format(date)
  }

  const numericOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  for (const key of ['calendar', 'numberingSystem', 'timeZone']) {
    if (options[key] !== undefined) numericOptions[key] = options[key]
  }

  const values = Object.fromEntries(
    getFormatter(locale, numericOptions)
      .formatToParts(date)
      .filter(part => ['year', 'month', 'day'].includes(part.type))
      .map(part => [part.type, part.value])
  )
  const { order, separator } = CUSTOM_DATE_FORMATS[normalizedFormat]
  return order.map(part => values[part]).join(separator)
}

/**
 * @param {Date | number} date
 * @param {string} locale
 * @param {string} timeFormat
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {string}
 */
export function formatTime(date, locale, timeFormat = DEFAULT_TIME_FORMAT, options = {}) {
  return getFormatter(locale, resolveTimeOptions(timeFormat, options)).format(date)
}

/**
 * @param {Date | number} date
 * @param {string} locale
 * @param {string} dateFormat
 * @param {Intl.DateTimeFormatOptions} dateOptions
 * @param {Intl.DateTimeFormatOptions} timeOptions
 * @param {string} timeFormat
 * @returns {string}
 */
export function formatDateTime(
  date,
  locale,
  dateFormat = DEFAULT_DATE_FORMAT,
  dateOptions = {},
  timeOptions = {},
  timeFormat = DEFAULT_TIME_FORMAT
) {
  const normalizedFormat = normalizeDateFormat(dateFormat)
  const normalizedTimeFormat = normalizeTimeFormat(timeFormat)
  if (normalizedFormat === DEFAULT_DATE_FORMAT) {
    const resolvedOptions = { ...dateOptions, ...resolveTimeOptions(normalizedTimeFormat, timeOptions) }
    return getFormatter(locale, resolvedOptions).format(date)
  }

  return `${formatDate(date, locale, normalizedFormat, dateOptions)}, ${formatTime(date, locale, normalizedTimeFormat, timeOptions)}`
}

/**
 * @param {Date | number} date
 * @param {string} locale
 * @param {string} dateFormat
 * @param {string} timeFormat
 * @returns {string}
 */
export function formatShortDateTime(
  date,
  locale,
  dateFormat = DEFAULT_DATE_FORMAT,
  timeFormat = DEFAULT_TIME_FORMAT
) {
  return formatDateTime(
    date,
    locale,
    dateFormat,
    { dateStyle: 'short' },
    { timeStyle: 'short' },
    timeFormat
  )
}
