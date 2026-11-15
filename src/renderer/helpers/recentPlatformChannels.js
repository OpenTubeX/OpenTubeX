// @ts-check

/**
 * The channel pages of other platforms that the app showed lately, so going
 * back to one shows it at once, with the pages it had loaded and where it was
 * scrolled to, instead of loading it again.
 *
 * @typedef {import('../../platforms/types').PlatformChannel} PlatformChannel
 * @typedef {import('../../platforms/types').PlatformPage} PlatformPage
 * @typedef {{ order: number, savedAt: number }} ChannelLoad a load of a channel, in the order loads started
 * @typedef {ChannelLoad & { channel: PlatformChannel, pages: Record<string, PlatformPage> }} RecentChannel
 */

const MAX_CHANNELS = 10
/** Long enough to go back from what the channel's page led to */
const MAX_AGE_MS = 5 * 60_000

/** @type {Map<string, RecentChannel>} oldest first */
const recent = new Map()
/**
 * The last reload of each channel, which keeps the pages of loads that started
 * before it from coming back, until those loads have expired.
 * @type {Map<string, ChannelLoad>}
 */
const reloads = new Map()
let lastOrder = 0

/**
 * @returns {ChannelLoad}
 */
export function startChannelLoad() {
  return { order: ++lastOrder, savedAt: Date.now() }
}

/**
 * @param {number} savedAt
 */
const isExpired = savedAt => Date.now() - savedAt > MAX_AGE_MS

/**
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 * @returns {RecentChannel | null}
 */
export function getRecentChannel(platform, id) {
  const entry = recent.get(`${platform}:${id}`)
  return entry && !isExpired(entry.savedAt) ? entry : null
}

/**
 * Keeps the loaded pages of a channel, unless they are too old or the channel
 * was loaded again or reloaded since.
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 * @param {PlatformChannel} channel
 * @param {Record<string, PlatformPage>} pages
 * @param {ChannelLoad} load the load that showed the channel
 */
export function rememberChannel(platform, id, channel, pages, { order, savedAt }) {
  const key = `${platform}:${id}`
  if (isExpired(savedAt) || Math.max(recent.get(key)?.order ?? 0, reloads.get(key)?.order ?? 0) > order) return
  // Moves it to the end, as the most recent
  recent.delete(key)
  recent.set(key, { channel, pages, order, savedAt })
  if (recent.size > MAX_CHANNELS) recent.delete(/** @type {string} */ (recent.keys().next().value))
}

/**
 * Forgets a channel that reloads, before it loads again.
 * @param {string} platform
 * @param {string} id the ID the page was opened with
 */
export function forgetChannel(platform, id) {
  const key = `${platform}:${id}`
  recent.delete(key)
  for (const [other, reload] of reloads) {
    if (isExpired(reload.savedAt)) reloads.delete(other)
  }
  reloads.set(key, startChannelLoad())
}
