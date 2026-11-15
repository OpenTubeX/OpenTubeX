// @ts-check
import { isIP } from 'node:net'

import { isNonPublicNetworkAddress } from './utils.js'

/**
 * Whether a link points to this computer or the local network, so opening it
 * from another app or a website could make the app request a local service.
 * A host that does not resolve counts as public, as nothing could reach it.
 * @param {string} url
 * @param {(hostname: string) => Promise<string[]>} resolveHost
 */
export async function pointsToLocalNetwork(url, resolveHost) {
  const parsed = URL.parse(url)
  if (!parsed) return false
  const hostname = parsed.hostname.replaceAll(/^\[|\]$/g, '')
  let addresses
  try {
    addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname)
  } catch {
    return false
  }
  return addresses.some(isNonPublicNetworkAddress)
}
