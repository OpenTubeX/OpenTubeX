// @ts-check

/**
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannelTab} PlatformChannelTab
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 */

/**
 * A channel with the first page of a tab, for platforms that load them with
 * separate requests.
 * @param {Pick<Platform, 'getChannel' | 'getChannelPage'>} platform
 * @param {PlatformFetch} fetch
 * @param {string} id
 * @param {PlatformChannelTab} tab
 * @param {AbortSignal | undefined} signal
 * @param {Promise<PlatformPage>} [early] the page, already loading, for IDs
 * that the platform's pages take as they are, so it doesn't wait for the channel
 * @returns {Promise<{ channel: import('./types.js').PlatformChannel, page: Promise<PlatformPage> } | null>}
 */
export async function loadChannelWithPage({ getChannel, getChannelPage }, fetch, id, tab, signal, early) {
  // Unknown channels drop the page
  early?.catch(() => {})
  const channel = await getChannel(fetch, id, signal)
  if (!channel) return null
  const page = early ?? getChannelPage(fetch, channel, tab, null, signal)
  // Callers that moved on to another channel drop it too, and report its errors otherwise
  page.catch(() => {})
  return { channel, page }
}
