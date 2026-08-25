import { SYNC_SERVER_VERSION_HEADER } from '../../syncServerUserAgent.js'

/**
 * Build the headers shared by every sync-server request.
 * @param {object} options
 * @param {boolean} [options.hasBody]
 * @param {HeadersInit} [options.headers]
 * @param {string} [options.token]
 * @param {string} options.version
 * @returns {Headers}
 */
export function createSyncServerRequestHeaders({ hasBody = false, headers, token = '', version }) {
  const requestHeaders = new Headers(headers)

  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json')
  }
  if (version) {
    requestHeaders.set(SYNC_SERVER_VERSION_HEADER, version)
  }
  if (hasBody) {
    requestHeaders.set('Content-Type', 'application/json')
  }
  if (token) {
    requestHeaders.set('Authorization', token)
  }

  return requestHeaders
}
