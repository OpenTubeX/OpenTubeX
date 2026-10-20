import { normalizeSubscriptionChannelSettings } from './renderer/helpers/subscription-channels.js'

/**
 * Only channels with notifications turned on are included, limited to the
 * feed types that subscription refreshes fetch.
 * @param {{
 *   enabled: boolean,
 *   subscriptions: object[],
 *   hiddenFeedTypes?: string[],
 *   showMembersOnly: boolean,
 *   titles: Record<string, string>
 * }} input
 */
export function createUploadNotificationConfiguration({ enabled, subscriptions, hiddenFeedTypes = [], showMembersOnly, titles }) {
  const channels = enabled
    ? Object.fromEntries(subscriptions.flatMap(channel => {
        if (typeof channel?.id !== 'string' || channel.id.length === 0) return []
        const settings = normalizeSubscriptionChannelSettings(channel)
        const feedTypes = settings.notificationFeedTypes
          .filter(feedType => settings.feedTypes.includes(feedType) && !hiddenFeedTypes.includes(feedType))
        if (feedTypes.length === 0) return []
        return [[channel.id, {
          name: channel.name ?? '',
          feedTypes,
          membersOnly: showMembersOnly && settings.showMembersOnly
        }]]
      }))
    : {}
  return Object.keys(channels).length === 0 ? { enabled: false } : { enabled: true, titles, channels }
}

const KNOWN_ID_LIMIT = 200
const NOTIFIED_ID_LIMIT = 1000
// Feeds can surface older entries, for example when a video becomes public.
const MAXIMUM_AGE_MS = 7 * 86_400_000

/**
 * Reduces parsed feed entries to the fields notifications need, newest first.
 * @param {unknown} entries
 * @returns {{ id: string, title: string, published: number, live: boolean, upcoming: boolean, membersOnly: boolean }[]}
 */
export function normalizeUploadEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries.flatMap(entry => {
    const id = entry?.videoId ?? entry?.postId
    if (typeof id !== 'string' || id.length === 0) return []
    const title = typeof entry.title === 'string'
      ? entry.title
      : typeof entry.postText === 'string' ? htmlToText(entry.postText) : ''
    return [{
      id,
      title,
      published: Number(entry.published ?? entry.publishedTime) || 0,
      live: entry.liveNow === true,
      upcoming: entry.isUpcoming === true,
      membersOnly: entry.isMembersOnly === true
    }]
  })
}

/**
 * @param {string} html
 */
function htmlToText(html) {
  let text = html.replaceAll(/<br\s*\/?>/gi, '\n')
  // Repeat until stable so removing one tag cannot join the pieces of another.
  let previous
  do {
    previous = text
    text = text.replaceAll(/<[^>]*>/g, '')
  } while (text !== previous)
  return text
    .replaceAll(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (match, decimal, hex, name) => {
      if (name) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' }[name.toLowerCase()]
      const codePoint = decimal ? Number(decimal) : Number.parseInt(hex, 16)
      return codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match
    })
}

/** @returns {{ known: Record<string, string[]>, notified: string[], withheld?: Record<string, string[]> }} */
export function createUploadNotificationState() {
  return { known: {}, notified: [] }
}

/**
 * Drops the baselines of feeds whose notifications are off, so turning them on
 * again does not report what was uploaded in the meantime.
 * @param {{ known: Record<string, string[]>, notified: string[] }} state
 * @param {ReturnType<typeof createUploadNotificationConfiguration>} configuration
 * @returns {boolean} whether any baseline was dropped
 */
export function forgetUnconfiguredFeeds(state, configuration) {
  let changed = false
  for (const key of Object.keys(state.known)) {
    const separator = key.lastIndexOf(':')
    if (configuration.channels?.[key.slice(0, separator)]?.feedTypes.includes(key.slice(separator + 1))) continue
    delete state.known[key]
    changed = true
  }
  for (const channelId of Object.keys(state.withheld ?? {})) {
    if (configuration.channels?.[channelId]?.feedTypes.length > 0) continue
    delete state.withheld[channelId]
    changed = true
  }
  return changed
}

/**
 * Records a channel feed and returns its entries that appeared since the last
 * observation. The first observation of a feed only establishes a baseline,
 * and a response without overlap is treated as a replaced list, not as uploads.
 * Upcoming entries are skipped until they go live or are published.
 * @param {{ known: Record<string, string[]>, notified: string[] }} state
 * @param {string} channelId
 * @param {string} feedType
 * @param {ReturnType<typeof normalizeUploadEntries>} entries
 * @param {number} [now]
 */
export function takeNewUploads(state, channelId, feedType, entries, now = Date.now()) {
  const key = `${channelId}:${feedType}`
  const available = entries.filter(entry => !entry.upcoming)
  const known = state.known[key]
  state.known[key] = [...new Set([...available.map(entry => entry.id), ...(known ?? [])])].slice(0, KNOWN_ID_LIMIT)
  if (!Array.isArray(known)) return []

  const knownIds = new Set(known)
  const firstKnownIndex = known.length === 0
    ? available.length
    : available.findIndex(entry => knownIds.has(entry.id))
  if (firstKnownIndex < 0) return []

  // Shorts and streams can also appear in another feed of the same channel.
  const notifiedIds = new Set(state.notified)
  const uploads = available.slice(0, firstKnownIndex).filter(entry => (
    !notifiedIds.has(entry.id) &&
    (entry.live || entry.published === 0 || now - entry.published <= MAXIMUM_AGE_MS)
  ))
  state.notified = [...uploads.map(entry => entry.id), ...state.notified].slice(0, NOTIFIED_ID_LIMIT)
  return uploads
}

/**
 * Like takeNewUploads, but withholds members-only uploads unless they are shown.
 * The baseline still records them, so turning members-only content on does not
 * report old ones. A withheld upload notifies once it is no longer members-only,
 * as members-first videos do when they become public. Withheld IDs are kept per
 * channel because shorts and streams can move between a channel's feeds.
 * @param {{ known: Record<string, string[]>, notified: string[], withheld?: Record<string, string[]> }} state
 * @param {string} channelId
 * @param {string} feedType
 * @param {ReturnType<typeof normalizeUploadEntries>} entries
 * @param {boolean} showMembersOnly
 * @param {number} [now]
 */
export function takeVisibleUploads(state, channelId, feedType, entries, showMembersOnly, now = Date.now()) {
  // Once members-only content is shown, withheld uploads are already accessible.
  const withheld = showMembersOnly ? [] : state.withheld?.[channelId] ?? []
  const released = entries.filter(entry => !entry.membersOnly && !entry.upcoming && withheld.includes(entry.id))
  const uploads = takeNewUploads(state, channelId, feedType, entries, now)
  const visible = uploads.filter(entry => showMembersOnly || !entry.membersOnly)
  const releasedIds = new Set(released.map(entry => entry.id))
  const nextWithheld = [
    ...uploads.filter(entry => !visible.includes(entry)).map(entry => entry.id),
    ...withheld.filter(id => !releasedIds.has(id))
  ].slice(0, KNOWN_ID_LIMIT)
  state.withheld = { ...state.withheld, [channelId]: nextWithheld }
  if (nextWithheld.length === 0) delete state.withheld[channelId]
  return [...released, ...visible.filter(entry => !releasedIds.has(entry.id))]
}

/**
 * @param {string} feedType
 * @param {string} id
 */
export function getUploadUrl(feedType, id) {
  if (feedType === 'posts') return `https://www.youtube.com/post/${encodeURIComponent(id)}`
  if (feedType === 'shorts') return `https://www.youtube.com/shorts/${encodeURIComponent(id)}`
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}
