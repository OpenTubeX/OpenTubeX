const MAX_TAB_AVATAR_DOWNLOAD_BYTES = 2 * 1024 * 1024
const TAB_AVATAR_FETCH_TIMEOUT_MS = 5000

/**
 * Download an avatar inside the sandboxed renderer, where normal web-origin
 * and CORS restrictions apply, before passing only its bytes to main.
 * @param {string} avatarUrl
 * @returns {Promise<ArrayBuffer | null>}
 */
export async function fetchTabAvatarBytes(avatarUrl) {
  let url
  try {
    url = new URL(avatarUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const response = await fetch(url.href, {
    signal: AbortSignal.timeout(TAB_AVATAR_FETCH_TIMEOUT_MS)
  })
  const contentLength = Number(response.headers.get('content-length'))
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('image/') ||
    (Number.isFinite(contentLength) && contentLength > MAX_TAB_AVATAR_DOWNLOAD_BYTES)
  ) {
    return null
  }

  if (response.body == null) return null

  const reader = response.body.getReader()
  const chunks = []
  let byteLength = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    byteLength += value.byteLength
    if (byteLength > MAX_TAB_AVATAR_DOWNLOAD_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  if (byteLength === 0) return null

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}
