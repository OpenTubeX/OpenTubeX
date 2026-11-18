// @ts-check
/**
 * Sync server error types and the predicates that classify them.
 *
 * Kept in its own module so the classification logic can be unit tested; the
 * main sync-server helper pulls in bundler-resolved imports that a plain Node
 * test runner cannot load.
 */

export class SyncServerError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'SyncServerError'
    this.status = status
  }
}

export const SYNC_SERVER_RESTORED_DEVICE_MESSAGE =
  'Sync was signed out because this app data was restored from a backup or another device.'

export const SYNC_SERVER_UPDATE_REQUIRED_MESSAGE =
  'This server must be updated to support encrypted live sync.'

export class SyncServerUnsupportedError extends Error {
  constructor() {
    super(SYNC_SERVER_UPDATE_REQUIRED_MESSAGE)
    this.name = 'SyncServerUnsupportedError'
  }
}

export class SyncServerCancelledError extends Error {
  constructor() {
    super('Sync cancelled')
    this.name = 'SyncServerCancelledError'
  }
}

export class SyncServerTabRevocationPendingError extends Error {}

export class SyncServerDataLossError extends Error {
  /**
   * @param {object} details
   * @param {string} details.collection
   * @param {string | null} [details.scope] The playlist or profile ID of a nested list
   * @param {string | null} [details.scopeName]
   * @param {number} details.deleted
   * @param {number} details.previous
   * @param {{ id: string, name: string }[]} details.items
   */
  constructor({ collection, scope = null, scopeName = null, deleted, previous, items }) {
    super(
      `Sync stopped because it would delete ${deleted} of ${previous} previously synced ${scopeName ?? collection} items`
    )
    this.name = 'SyncServerDataLossError'
    this.collection = collection
    this.scope = scope
    this.scopeName = scopeName
    this.deleted = deleted
    this.previous = previous
    this.items = items
  }

  /** The details the review prompt needs, without the error itself. */
  get details() {
    const { collection, scope, scopeName, deleted, previous, items } = this
    return { collection, scope, scopeName, deleted, previous, items }
  }
}

/**
 * The message for a failed sync server response. The server answers with
 * short plain text, but proxies in front of it, such as Cloudflare, answer
 * gateway errors with whole HTML or JSON pages.
 * @param {number} status
 * @param {string} body
 */
export function syncServerResponseErrorMessage(status, body) {
  const text = body.trim()
  if (text && text.length <= 300 && !/^[<{[]/.test(text)) return text
  return status >= 500
    ? `Sync server is temporarily unavailable (HTTP ${status}). Sync will try again later.`
    : `Sync server returned HTTP ${status}`
}

export const SYNC_SERVER_SESSION_EXPIRED_MESSAGE =
  'Sync server session expired. Sign in again to resume syncing.'

/**
 * Whether the server answered that the token's account no longer exists.
 * @param {unknown} error
 */
export function isAccountDeletedError(error) {
  return error instanceof SyncServerError && error.status === 404 &&
    error.message === "account doesn't exist"
}

/**
 * Whether an error means the stored token is no longer accepted.
 *
 * Only 401 qualifies, and the 404 servers answer when the token's account was
 * deleted. The server answers 403 for wrong credentials and for resources owned
 * by someone else, and 404 for plenty of ordinary misses, so treating those as
 * an expired session would sign people out for unrelated reasons.
 * @param {unknown} error
 */
export function isSessionExpiredError(error) {
  return (error instanceof SyncServerError && error.status === 401) || isAccountDeletedError(error)
}

/**
 * Whether authentication is recovering the same expired sync session.
 * @param {object} session
 * @param {boolean} session.expired
 * @param {string} session.savedServerUrl
 * @param {string} session.savedUsername
 * @param {string} session.serverUrl
 * @param {string} session.username
 */
export function isExpiredSessionReauthentication({
  expired,
  savedServerUrl,
  savedUsername,
  serverUrl,
  username,
}) {
  return expired &&
    serverUrl === savedServerUrl &&
    username === savedUsername
}
