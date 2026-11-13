import { appFetch } from './rssHub'

/**
 * Loads a Rumble page outside the renderer: Rumble's Cloudflare front sets a
 * cookie that the app's pages can't keep, as a third-party cookie there, and
 * on Android it rejects the native HTTP client.
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchRumblePage(url, init) {
  const signal = init?.signal
  signal?.throwIfAborted()
  let loading
  if (process.env.IS_ELECTRON) {
    loading = window.ftElectron.fetchRumblePage(url)
  } else {
    const { fetchAndroidRumblePage } = await import('./ytDlp')
    loading = fetchAndroidRumblePage(url)
  }
  // The main process and the Android helper can't cancel a page they load,
  // and give up on it after their own time limit. An aborted request stops
  // waiting for it right away.
  const page = await new Promise((resolve, reject) => {
    const abort = () => reject(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    loading.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
  })
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
