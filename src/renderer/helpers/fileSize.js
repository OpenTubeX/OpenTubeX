export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unitIndex)

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0
  }).format(value)} ${units[unitIndex]}`
}
