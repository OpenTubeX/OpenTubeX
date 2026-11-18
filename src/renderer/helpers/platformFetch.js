import { PlatformBrowserCheckError } from '../../platforms/browserCheck'
import { appFetch } from './rssHub'

/**
 * Loads a Rumble page outside the renderer: Rumble's Cloudflare front sets a
 * cookie that the app's pages can't keep, as a third-party cookie there, and
 * that the stateless native HTTP client of the mobile apps doesn't keep either.
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchRumblePage(url, init) {
  const signal = init?.signal
  const load = process.env.IS_ELECTRON
    ? window.ftElectron.fetchRumblePage
    : (await import('./ytDlp')).fetchMobileRumblePage
  // Also when it aborted while the module loaded
  signal?.throwIfAborted()
  // The main process and the mobile helpers can't cancel a page they load,
  // and give up on it after their own time limit. An aborted request stops
  // waiting for it right away.
  const page = await new Promise((resolve, reject) => {
    const abort = () => reject(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    load(url).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
  })
  // Responses without content, like 204, can't have a body
  return new Response(page.text || null, {
    status: page.status,
    headers: { 'Content-Type': 'text/html', ...(page.challenge ? { 'cf-mitigated': 'challenge' } : {}) }
  })
}

/**
 * Whether the user can pass the browser check that failed a request, in a
 * browser of the app.
 * @param {unknown} error
 * @returns {error is PlatformBrowserCheckError}
 */
export function canPassBrowserCheck(error) {
  return !!(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) &&
    error instanceof PlatformBrowserCheckError && error.platform === 'rumble'
}

/** @type {Promise<void> | null} */
let pendingBrowserCheck = null

/**
 * Lets the user pass the check in a browser of the app. Settles once they
 * passed it or closed the browser. Pages that hit the check meanwhile share it.
 * @param {PlatformBrowserCheckError} error
 * @returns {Promise<void>}
 */
export function passBrowserCheck(error) {
  pendingBrowserCheck ??= (async () => {
    try {
      if (process.env.IS_ELECTRON) {
        await window.ftElectron.passRumbleChallenge(error.url)
      } else {
        await (await import('./ytDlp')).passMobileRumbleChallenge(error.url)
      }
    } finally {
      pendingBrowserCheck = null
    }
  })()
  return pendingBrowserCheck
}

/**
 * How the app requests the pages and APIs of a platform.
 * @param {string} platform
 * @returns {import('../../platforms/types').PlatformFetch}
 */
export function getPlatformFetch(platform) {
  return platform === 'rumble' && (process.env.IS_ELECTRON || process.env.IS_CAPACITOR)
    ? fetchRumblePage
    : appFetch
}
