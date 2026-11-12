// @ts-check

const MAX_PAGE_LENGTH = 10_000_000
const TIMEOUT_MS = 15_000

/**
 * Loads a Rumble page for the renderer. Rumble's Cloudflare front sets a cookie
 * that the app's pages can't keep, as a third-party cookie there, so its pages
 * load in the main process, with the session's cookies.
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetch
 * @param {unknown} url
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function fetchRumblePage(fetch, url) {
  const target = typeof url === 'string' && URL.canParse(url) ? new URL(url) : null
  if (!target || target.protocol !== 'https:' || target.username || target.password || target.port ||
    !/^(?:[a-z\d-]+\.)?rumble\.com$/.test(target.hostname)) {
    throw new Error('Not a Rumble page')
  }
  const response = await fetch(target.href, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (Number(response.headers.get('content-length')) > MAX_PAGE_LENGTH) throw new Error('Rumble page is too large')
  const text = await response.text()
  if (text.length > MAX_PAGE_LENGTH) throw new Error('Rumble page is too large')
  return { status: response.status, text }
}
