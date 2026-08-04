export const DEFAULT_PROXY_SETTINGS = {
  protocol: 'socks5',
  hostname: '127.0.0.1',
  port: '9050'
}

/**
 * Builds a proxy URL from the app's proxy settings,
 * for tools that take the proxy as a single URL (e.g. yt-dlp's `--proxy`).
 *
 * Settings are only written to the database once they get changed,
 * so missing values mean that the default is still in use.
 * @param {{
 *   protocol?: string,
 *   hostname?: string,
 *   port?: string | number,
 *   username?: string,
 *   password?: string
 * }} proxySettings
 * @returns {string}
 */
export function buildProxyUrl({ protocol, hostname, port, username, password }) {
  protocol ||= DEFAULT_PROXY_SETTINGS.protocol
  hostname ||= DEFAULT_PROXY_SETTINGS.hostname
  port ||= DEFAULT_PROXY_SETTINGS.port

  const credentials = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password ?? '')}@`
    : ''

  // IPv6 addresses have to be wrapped in brackets to separate them from the port
  const host = hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname

  return `${protocol}://${credentials}${host}:${port}`
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
