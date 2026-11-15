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

/** @type {Map<string, RecentChannel>} oldest first */
const recent = new Map()

/**
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 * @returns {RecentChannel | null}
 */
export function getRecentChannel(platform, id) {
  const key = `${platform}:${id}`
  const entry = recent.get(key)
  if (entry && Date.now() - entry.savedAt <= MAX_AGE_MS) return entry
  recent.delete(key)
  return null
}

/**
 * Keeps the loaded pages of a channel, which stay as old as its first load.
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 * @param {PlatformChannel} channel
 * @param {Record<string, PlatformPage>} pages
 */
export function rememberChannel(platform, id, channel, pages) {
  const key = `${platform}:${id}`
  const savedAt = getRecentChannel(platform, id)?.savedAt ?? Date.now()
  // Moves it to the end, as the most recent
  recent.delete(key)
  recent.set(key, { channel, pages, savedAt })
  if (recent.size > MAX_CHANNELS) recent.delete(/** @type {string} */ (recent.keys().next().value))
}

/**
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 */
export function forgetChannel(platform, id) {
  recent.delete(`${platform}:${id}`)
}
