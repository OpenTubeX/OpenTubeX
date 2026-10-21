// Constructing Intl formatters is expensive and this runs once per download row.
/** @type {Map<number, Intl.NumberFormat>} */
const byteFormatterCache = new Map()

/**
 * @param {number} maximumFractionDigits
 * @returns {Intl.NumberFormat}
 */
function getByteFormatter(maximumFractionDigits) {
  let formatter = byteFormatterCache.get(maximumFractionDigits)

  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits })
    byteFormatterCache.set(maximumFractionDigits, formatter)
  }

  return formatter
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unitIndex)

  return `${getByteFormatter(value < 10 ? 1 : 0).format(value)} ${units[unitIndex]}`
}
