/**
 * Builds a proxy URL from the app's proxy settings,
 * for tools that take the proxy as a single URL (e.g. yt-dlp's `--proxy`).
 * @param {{
 *   protocol?: string,
 *   hostname?: string,
 *   port?: string | number,
 *   username?: string,
 *   password?: string
 * }} proxySettings
 * @returns {string | null} null when the settings are incomplete
 */
export function buildProxyUrl({ protocol, hostname, port, username, password }) {
  if (!protocol || !hostname || !port) {
    return null
  }

  const credentials = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password ?? '')}@`
    : ''

  return `${protocol}://${credentials}${hostname}:${port}`
}

/**
 * @param {string | URL} url
 */
export function isOpenTubeXUrl(url) {
  let url_

  if (url instanceof URL) {
    url_ = url
  } else {
    url_ = URL.parse(url)
  }

  if (process.env.NODE_ENV === 'development') {
    return url_ !== null && url_.protocol === 'http:' && url_.host === 'localhost:9080' && (url_.pathname === '/' || url_.pathname === '/index.html')
  } else {
    return url_ !== null && url_.protocol === 'app:' && url_.host === 'bundle' && (url_.pathname === '/' || url_.pathname === '/index.html')
  }
}
