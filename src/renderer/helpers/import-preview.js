import { getSearchHistoryEntryKeyFromEntry, DEFAULT_SEARCH_SETTINGS, normalizeSearchSettings } from '../../search-history.js'
import { migrateLegacySettings } from './settings-migrations.js'
import { forEachTakeoutImportEntry, parseCsvRecords } from './youtube-takeout-zip.js'

function countRecords(imported, current, key) {
  const existing = new Set(current.map(key))
  const incoming = new Set(imported.map(key))
  return {
    added: [...incoming].filter(id => !existing.has(id)).length,
    existing: [...incoming].filter(id => existing.has(id)).length,
    skipped: 0,
  }
}

export function previewBackupImport(data, current) {
  const rows = []
  const keys = { profiles: record => record._id, playlists: record => record._id, history: record => record.videoId, searchHistory: getSearchHistoryEntryKeyFromEntry, watchStats: record => record.date }
  for (const category of Object.keys(data)) {
    if (category === 'settings') {
      const settings = migrateLegacySettings(data.settings)
      const accepted = Object.keys(settings).filter(key => Object.hasOwn(current.settings, key))
      rows.push({ category, added: 0, existing: accepted.length, skipped: Object.keys(settings).length - accepted.length, effect: 'Settings effect' })
    } else {
      rows.push({
        category,
        ...countRecords(category === 'watchStats' ? data.watchStats.records : data[category], current[category], keys[category]),
        effect: {
          profiles: 'Details effect', playlists: 'Details effect', history: 'Merge effect', searchHistory: 'Merge effect', watchStats: 'Merge effect',
        }[category]
      })
    }
  }
  if (data.profiles) {
    const memberships = profiles => profiles.flatMap(profile => profile.subscriptions.map(channel => ({ key: JSON.stringify([profile._id, channel.id]) })))
    rows.splice(rows.findIndex(row => row.category === 'profiles') + 1, 0, {
      category: 'profiles',
      unit: 'Subscriptions.Subscriptions',
      ...countRecords(memberships(data.profiles), memberships(current.profiles), record => record.key),
      effect: 'Merge effect',
    })
  }
  return rows
}

/**
 * Find the localized text around watched titles, such as "Watched " in
 * English. Removed videos are titled with their URL, which shows the template
 * exactly; otherwise use the start all titles share.
 */
function findWatchTitleTemplate(records) {
  const templates = new Map()
  for (const { title, titleUrl } of records) {
    const index = title.indexOf(titleUrl)
    if (index === -1) continue
    const prefix = title.slice(0, index)
    const suffix = title.slice(index + titleUrl.length)
    const template = templates.get(`${prefix}\n${suffix}`) ?? { prefix, suffix, count: 0 }
    template.count++
    templates.set(`${prefix}\n${suffix}`, template)
  }
  if (templates.size > 0) {
    return [...templates.values()].reduce((best, template) => template.count > best.count ? template : best)
  }
  if (new Set(records.map(({ title }) => title)).size < 2) return { prefix: '', suffix: '' }
  // Without a template, a shared ending may be part of every title, so keep it.
  const first = records[0].title
  let prefixLength = first.length
  for (const { title } of records.slice(1)) {
    let index = 0
    while (index < prefixLength && title[index] === first[index]) index++
    prefixLength = index
  }
  return { prefix: first.slice(0, prefixLength), suffix: '' }
}

/** Transform the same watch records for both the preview and the actual import. */
export function parseTakeoutWatchHistory(history) {
  let skipped = 0
  const records = history.filter(item => {
    if (!Array.isArray(item?.products) || !item.products.includes('YouTube') || typeof item.titleUrl !== 'string' || !item.titleUrl.includes('www.youtube.com/watch?v') || item.details != null) return false
    if (typeof item.title !== 'string' || !Number.isFinite(Date.parse(item.time))) { skipped++; return false }
    return true
  })
  const { prefix, suffix } = findWatchTitleTemplate(records)
  const getTitle = title => title.length >= prefix.length + suffix.length && title.startsWith(prefix) && title.endsWith(suffix)
    ? title.slice(prefix.length, title.length - suffix.length)
    : title
  const knownKeys = new Set(['header', 'description', 'products', 'details', 'activityControls', 'title', 'titleUrl', 'time', 'subtitles'])
  const unknownKeys = new Set()
  const entries = records.map(record => {
    for (const key of Object.keys(record)) {
      if (!knownKeys.has(key)) unknownKeys.add(key)
    }
    const author = Array.isArray(record.subtitles) ? record.subtitles[0] : null
    const timeWatched = Date.parse(record.time)
    return {
      videoId: record.titleUrl.replaceAll(/https:\/\/www\.youtube\.com\/watch\?v=/gi, ''),
      title: getTitle(record.title),
      timeWatched,
      author: typeof author?.name === 'string' ? author.name : '',
      authorId: typeof author?.url === 'string' ? author.url.replaceAll(/https:\/\/www\.youtube\.com\/channel\//gi, '') : '',
      type: 'video',
      published: timeWatched,
      description: '',
      lengthSeconds: null,
      watchProgress: 1,
      isWatched: true,
      isLive: false,
    }
  })
  return { entries, skipped, unknownKeys: [...unknownKeys] }
}

export function parseTakeoutSearchHistory(history) {
  const entries = []
  let skipped = 0
  for (const entry of history) {
    if (!entry.products?.includes('YouTube') || !entry.titleUrl?.includes('youtube.com/results?search_query') || entry.details != null) continue
    try {
      const query = new URL(entry.titleUrl).searchParams.get('search_query')
      const lastUpdatedAt = Date.parse(entry.time)
      if (!query || !Number.isFinite(lastUpdatedAt)) { skipped++; continue }
      entries.push({ _id: query, query, lastUpdatedAt, searchSettings: entry.searchSettings && typeof entry.searchSettings === 'object' && !Array.isArray(entry.searchSettings) ? normalizeSearchSettings(entry.searchSettings) : DEFAULT_SEARCH_SETTINGS })
    } catch {
      skipped++
    }
  }
  return { entries, skipped }
}

export function parseTakeoutSubscriptions(entry) {
  if (entry.path.toLowerCase().endsWith('.csv')) {
    const rows = parseCsvRecords(entry.content)
    if (!rows) throw new Error('Invalid subscriptions CSV')
    return rows.slice(1).filter(row => row.some(value => value.trim() !== '')).map(fields => {
      if (fields.length !== 3 || !fields[0].trim()) throw new Error('Invalid subscription record')
      return { id: fields[0], name: fields[2], thumbnail: null }
    })
  }
  if (entry.path.toLowerCase().endsWith('.opml')) {
    const parser = new DOMParser()
    let document = parser.parseFromString(entry.content, 'application/xml')
    if (document.querySelector('parsererror')) document = parser.parseFromString(entry.content, 'text/html')
    const feeds = [...document.querySelectorAll('body outline[xmlUrl]')]
    if (!feeds.length) throw new Error('Invalid subscriptions file')
    return feeds.map(feed => {
      const url = new URL(feed.getAttribute('xmlUrl'))
      const id = url.searchParams.get('channel_id') ?? (url.pathname.includes('/feed/channel/') ? url.pathname.split('/').filter(Boolean).at(-1) : null)
      if (!id) throw new Error('Invalid subscription feed')
      return { id, name: feed.getAttribute('title'), thumbnail: null }
    })
  }
  return JSON.parse(entry.content).map(channel => {
    const snippet = channel.snippet
    if (!snippet?.resourceId?.channelId) throw new Error('Invalid subscription record')
    return { id: snippet.resourceId.channelId, name: snippet.title, thumbnail: snippet.thumbnails?.default?.url ?? null }
  })
}

/** Retain only identifiers while streaming the archive, never all decoded contents. */
export async function previewTakeoutImport(file, entries, current) {
  const categories = [...new Set(entries.map(entry => entry.type))]
  const incoming = Object.fromEntries(categories.map(category => [category, new Set()]))
  const skipped = Object.fromEntries(categories.map(category => [category, 0]))
  const failedFiles = Object.fromEntries(categories.map(category => [category, 0]))
  await forEachTakeoutImportEntry(file, new Set(categories), entries, entry => {
    let ids
    if (entry.type === 'subscriptions') {
      ids = parseTakeoutSubscriptions(entry).map(channel => channel.id)
    } else if (entry.type === 'playlists') {
      ids = [entry.playlist.playlistName]
    } else if (entry.type === 'history') {
      const history = JSON.parse(entry.content)
      const parsed = parseTakeoutWatchHistory(history)
      skipped.history += parsed.skipped
      ids = parsed.entries.map(record => record.videoId)
    } else {
      const history = JSON.parse(entry.content)
      const parsed = parseTakeoutSearchHistory(history)
      skipped.searchHistory += parsed.skipped
      ids = parsed.entries.map(getSearchHistoryEntryKeyFromEntry)
    }
    for (const id of ids) incoming[entry.type].add(id)
  }, (_error, category) => { failedFiles[category]++ })
  const keys = { subscriptions: record => record.id, playlists: record => record.playlistName, history: record => record.videoId, searchHistory: getSearchHistoryEntryKeyFromEntry }
  return categories.map(category => {
    const existing = new Set(current[category].map(keys[category]))
    const ids = [...incoming[category]]
    return {
      category,
      added: ids.filter(id => !existing.has(id)).length,
      existing: ids.filter(id => existing.has(id)).length,
      skipped: skipped[category],
      failedFiles: failedFiles[category],
      effect: { subscriptions: 'Subscriptions effect', playlists: 'Details effect', history: 'History replace effect', searchHistory: 'Merge effect' }[category],
    }
  })
}
