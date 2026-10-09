/**
 * Checks that a manifest is reachable and contains HLS before selecting it.
 * @param {string} url
 */
export async function probeHlsManifest(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
    return response.ok && (await response.text()).trimStart().startsWith('#EXTM3U')
  } catch {
    return false
  }
}
