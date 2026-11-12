import { appFetch } from './rssHub'

/**
 * Loads a Rumble page outside the renderer: Rumble's Cloudflare front sets a
 * cookie that the app's pages can't keep, as a third-party cookie there, and
 * on Android it rejects the native HTTP client.
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchRumblePage(url, init) {
  // The main process and the Android helper can't cancel a page they load
  init?.signal?.throwIfAborted()
  let page
  if (process.env.IS_ELECTRON) {
    page = await window.ftElectron.fetchRumblePage(url)
  } else {
    const { fetchAndroidRumblePage } = await import('./ytDlp')
    page = await fetchAndroidRumblePage(url)
  }
  init?.signal?.throwIfAborted()
  // Responses without content, like 204, can't have a body
  return new Response(page.text || null, { status: page.status, headers: { 'Content-Type': 'text/html' } })
}

/**
 * How the app requests the pages and APIs of a platform.
 * @param {string} platform
 * @returns {import('../../platforms/types').PlatformFetch}
 */
export function getPlatformFetch(platform) {
  return platform === 'rumble' && (process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS))
    ? fetchRumblePage
    : appFetch
}
