export function downloadFormats(download) {
  const paths = download.destinations?.length ? download.destinations : [download.destination]
  const fileFormats = download.files?.map(file => file.extension).filter(Boolean) ?? []
  return [...new Set([...fileFormats, ...paths.map(path => path?.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1])]
    .filter(Boolean).map(format => format.toLowerCase()))]
}

export function filterCompletedDownloads(downloads, { query, format, period, sort }, now = Date.now()) {
  const search = query.trim().toLocaleLowerCase()
  const today = new Date(now)
  const start = new Date(today.getFullYear(), period === 'year' ? 0 : today.getMonth(), period === 'week' ? today.getDate() - ((today.getDay() + 6) % 7) : 1).getTime()
  return downloads.filter(download => {
    if (search && ![download.title, ...(download.files?.flatMap(file => [file.title, file.author]) ?? [])]
      .some(value => value?.toLocaleLowerCase().includes(search))) return false
    if (format && !downloadFormats(download).includes(format)) return false
    if (period && (!Number.isFinite(download.completedAt) || download.completedAt < start)) return false
    return true
  }).sort((a, b) => {
    if (sort === 'size-desc') return (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || b.id - a.id
    if (sort === 'size-asc') return (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity) || b.id - a.id
    if (sort === 'date-asc') return (a.completedAt ?? Infinity) - (b.completedAt ?? Infinity) || a.id - b.id
    return (b.completedAt ?? -1) - (a.completedAt ?? -1) || b.id - a.id
  })
}
