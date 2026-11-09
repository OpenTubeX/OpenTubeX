// @ts-check

/**
 * The URL sync servers redirect to after an OIDC login or account deletion.
 * Server operators must list it in `oidc.allowed_redirect_urls`. iOS nightly
 * builds register their own scheme so they can sit next to the stable app.
 */
export const SYNC_SERVER_OIDC_REDIRECT_URL = `${process.env.APP_URL_SCHEME ?? 'opentubex'}://oidc`

// OIDC accounts have no username, but sync keys its saved state and pairing by
// one. Servers refuse to register names with this prefix, so a password account
// can never share the name.
const OIDC_USERNAME_PREFIX = 'OIDC-ACCOUNT-'

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSyncServerOidcCallbackUrl(value) {
  // Match the text: Android WebViews before Chromium 130 parse no host from
  // URLs with custom schemes and put `//oidc` into the path instead.
  return typeof value === 'string' && /^opentubex(?:-nightly)?:\/\/oidc(?:[/?#]|$)/i.test(value)
}

/**
 * @param {unknown} value
 * @returns {URL | null}
 */
function parseUrl(value) {
  if (typeof value !== 'string') return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * The session token a login callback carries. Deletion callbacks carry none.
 * @param {string} callbackUrl
 * @returns {string}
 */
export function getSyncServerOidcCallbackToken(callbackUrl) {
  return parseUrl(callbackUrl)?.searchParams.get('token') ?? ''
}

/**
 * The saved username of the account a sync server token belongs to.
 * @param {string} token
 * @returns {string}
 */
export function syncServerOidcUsername(token) {
  let accountId
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'))
    accountId = JSON.parse(json).sub
  } catch {
    accountId = null
  }
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('The sync server returned an invalid session')
  }
  return `${OIDC_USERNAME_PREFIX}${accountId}`
}

/**
 * @param {string} username
 * @returns {boolean}
 */
export function isSyncServerOidcUsername(username) {
  return username.startsWith(OIDC_USERNAME_PREFIX)
}

/**
 * The URL that starts an OIDC login in the browser.
 * @param {string} serverUrl normalized sync server URL
 * @param {string} deviceId
 * @returns {string}
 */
export function syncServerOidcLoginUrl(serverUrl, deviceId) {
  const url = new URL(`${serverUrl}/v1/account/oidc/authenticate`)
  url.searchParams.set('redirect_url', SYNC_SERVER_OIDC_REDIRECT_URL)
  url.searchParams.set('device_id', deviceId)
  return url.href
}

/**
 * Hands callbacks to the flow that is waiting for one. Callbacks that arrive
 * while no flow waits are ignored, so a link alone cannot sign the app in.
 */
export class SyncServerOidcCallbacks {
  /** @type {{ resolve: (url: string) => void, reject: (error: Error) => void } | null} */
  #pending = null

  /**
   * Waits for the next callback. Cancel a previous wait first.
   * @returns {Promise<string>}
   */
  wait() {
    return new Promise((resolve, reject) => {
      this.#pending = { resolve, reject }
    })
  }

  /**
   * @param {string} url
   * @returns {boolean} whether a flow was waiting for the callback
   */
  receive(url) {
    const pending = this.#pending
    if (!pending || !isSyncServerOidcCallbackUrl(url)) return false
    this.#pending = null
    pending.resolve(url)
    return true
  }

  /** @param {Error} error */
  cancel(error) {
    const pending = this.#pending
    this.#pending = null
    pending?.reject(error)
  }
}
