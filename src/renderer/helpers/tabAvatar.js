const MAX_TAB_AVATAR_DOWNLOAD_BYTES = 2 * 1024 * 1024

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

  const response = await fetch(url.href)
  const contentLength = Number(response.headers.get('content-length'))
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('image/') ||
    (Number.isFinite(contentLength) && contentLength > MAX_TAB_AVATAR_DOWNLOAD_BYTES)
  ) {
    return null
  }

  const buffer = await response.arrayBuffer()
  return buffer.byteLength > 0 && buffer.byteLength <= MAX_TAB_AVATAR_DOWNLOAD_BYTES
    ? buffer
    : null
}
