import { BlockList, isIP } from 'node:net'

export const DEFAULT_PROXY_SETTINGS = {
  protocol: 'socks5',
  hostname: '127.0.0.1',
  port: '9050'
}

const NON_PUBLIC_NETWORK_ADDRESSES = new BlockList()

for (const [address, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6']
]) {
  NON_PUBLIC_NETWORK_ADDRESSES.addSubnet(address, prefix, family)
}

/**
 * Rejects addresses which must not be reachable through an untrusted URL.
 * Unknown address formats are rejected as well.
 *
 * @param {string} address
 */
export function isNonPublicNetworkAddress(address) {
  let normalizedAddress = address.startsWith('[') && address.endsWith(']')
    ? address.slice(1, -1)
    : address
  const family = isIP(normalizedAddress)

  if (family === 0) return true
  if (family === 6) {
    normalizedAddress = new URL(`http://[${normalizedAddress}]/`).hostname.slice(1, -1)
    const mappedAddress = normalizedAddress.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i)
    if (mappedAddress) {
      const high = Number.parseInt(mappedAddress[1], 16)
      const low = Number.parseInt(mappedAddress[2], 16)
      return isNonPublicNetworkAddress([
        high >> 8,
        high & 0xff,
        low >> 8,
        low & 0xff
      ].join('.'))
    }
  }
  return NON_PUBLIC_NETWORK_ADDRESSES.check(normalizedAddress, family === 4 ? 'ipv4' : 'ipv6')
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
    const devServerPort = process.env.OPENTUBEX_DEV_SERVER_PORT ?? '9080'
    return url_ !== null && url_.protocol === 'http:' && url_.host === `localhost:${devServerPort}` && (url_.pathname === '/' || url_.pathname === '/index.html')
  } else {
    return url_ !== null && url_.protocol === 'app:' && url_.host === 'bundle' && (url_.pathname === '/' || url_.pathname === '/index.html')
  }
}
