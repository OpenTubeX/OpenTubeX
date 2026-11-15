// @ts-check

/**
 * The channel pages of other platforms that the app showed lately, so going
 * back to one shows it at once, with the pages it had loaded and where it was
 * scrolled to, instead of loading it again.
 *
 * @typedef {import('../../platforms/types').PlatformChannel} PlatformChannel
 * @typedef {import('../../platforms/types').PlatformPage} PlatformPage
 * @typedef {{ channel: PlatformChannel, pages: Record<string, PlatformPage>, savedAt: number }} RecentChannel
 */

const MAX_CHANNELS = 10
/** Long enough to go back from what the channel's page led to */
const MAX_AGE_MS = 5 * 60_000

/**
 * Forgotten channels keep the time they were forgotten, so that pages loaded
 * before that don't come back.
 * @type {Map<string, RecentChannel | { savedAt: number, channel?: undefined }>} oldest first
 */
const recent = new Map()

/**
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 * @returns {RecentChannel | null}
 */
export function getRecentChannel(platform, id) {
  const entry = recent.get(`${platform}:${id}`)
  return entry?.channel && Date.now() - entry.savedAt <= MAX_AGE_MS ? entry : null
}

/**
 * @param {string} key
 * @param {RecentChannel | { savedAt: number }} entry
 */
function save(key, entry) {
  // Moves it to the end, as the most recent
  recent.delete(key)
  recent.set(key, entry)
  if (recent.size > MAX_CHANNELS) recent.delete(/** @type {string} */ (recent.keys().next().value))
}

/**
 * Keeps the loaded pages of a channel, unless they are too old or the channel
 * was loaded again or forgotten since.
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 * @param {PlatformChannel} channel
 * @param {Record<string, PlatformPage>} pages
 * @param {number} savedAt when the channel started loading
 */
export function rememberChannel(platform, id, channel, pages, savedAt) {
  const key = `${platform}:${id}`
  if (Date.now() - savedAt > MAX_AGE_MS || (recent.get(key)?.savedAt ?? 0) > savedAt) return
  save(key, { channel, pages, savedAt })
}

/**
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 */
export function forgetChannel(platform, id) {
  save(`${platform}:${id}`, { savedAt: Date.now() })
}
