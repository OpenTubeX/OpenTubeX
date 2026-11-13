// @ts-check
import odysee from './odysee.js'
import peertube from './peertube.js'
import rumble from './rumble.js'
import soundcloud from './soundcloud.js'
import twitch from './twitch.js'

/**
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 */

/**
 * PeerTube comes last, as it recognizes channel paths on any host.
 * @type {Platform[]}
 */
export const PLATFORMS = [twitch, soundcloud, odysee, rumble, peertube]

/** @type {Record<string, string[]>} */
export const PLATFORM_ICONS = {
  twitch: ['fab', 'twitch'],
  soundcloud: ['fab', 'soundcloud'],
  odysee: ['fab', 'odysee'],
  rumble: ['fab', 'rumble'],
  peertube: ['fab', 'peertube']
}

/**
 * @param {unknown} id
 * @returns {Platform | null}
 */
export function getPlatform(id) {
  return PLATFORMS.find(platform => platform.id === id) ?? null
}

/**
 * The platform and ID of the channel a web page belongs to.
 * @param {unknown} url
 * @returns {{ platform: string, id: string } | null}
 */
export function findPlatformChannel(url) {
  if (typeof url !== 'string') return null
  for (const platform of PLATFORMS) {
    const id = platform.parseChannelUrl(url)
    if (id) return { platform: platform.id, id }
  }
  return null
}

/**
 * The in-app page of a channel.
 * @param {string} platform
 * @param {string} id
 */
export function getPlatformChannelRoute(platform, id) {
  return { path: '/external-channel', query: { platform, id } }
}

/**
 * @param {string} platform
 * @param {string} id
 */
export function getPlatformPlaylistRoute(platform, id) {
  return { path: '/external-playlist', query: { platform, id } }
}

/**
 * Identifies a followed channel across platforms.
 * @param {{ platform: string, id: string }} channel
 */
export function getPlatformChannelKey({ platform, id }) {
  return `${platform}:${id}`
}

/**
 * Identifies an item for its seen mark, which syncs with those of RSS feed items.
 * @param {PlatformItem} item
 */
export function getPlatformItemKey(item) {
  return `${item.platform}:${item.channelId}\n${item.id}`
}
