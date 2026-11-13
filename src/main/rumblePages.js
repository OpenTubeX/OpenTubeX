// @ts-check

const MAX_PAGE_LENGTH = 10_000_000
const MAX_REDIRECTS = 10
const TIMEOUT_MS = 15_000

/**
 * @param {unknown} url
 * @returns {URL}
 */
function rumblePageUrl(url) {
  const target = typeof url === 'string' && URL.canParse(url) ? new URL(url) : null
  if (!target || target.protocol !== 'https:' || target.username || target.password || target.port ||
    !/^(?:[a-z\d-]+\.)?rumble\.com$/.test(target.hostname)) {
    throw new Error('Not a Rumble page')
  }
  return target
}

/**
 * Loads a Rumble page for the renderer. Rumble's Cloudflare front sets a cookie
 * that the app's pages can't keep, as a third-party cookie there, so its pages
 * load in the main process, with the session's cookies. Redirects, such as the
 * one back to the page that sets the cookie, may only lead to other Rumble pages.
 * @param {{ request: (options: Electron.ClientRequestConstructorOptions) => Electron.ClientRequest }} net
 * @param {unknown} url
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function fetchRumblePage(net, url) {
  const target = rumblePageUrl(url)
  return new Promise((resolve, reject) => {
    const request = net.request({ url: target.href, redirect: 'manual', useSessionCookies: true })
    let settled = false
    /** @param {Error} error */
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.abort()
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('Rumble page timed out')), TIMEOUT_MS)
    let redirects = 0
    request.on('redirect', (_status, _method, redirectUrl) => {
      try {
        if (++redirects > MAX_REDIRECTS) throw new Error('Too many redirects')
        rumblePageUrl(redirectUrl)
        request.followRedirect()
      } catch (error) {
        fail(/** @type {Error} */ (error))
      }
    })
    request.on('response', (response) => {
      if (Number(response.headers['content-length']) > MAX_PAGE_LENGTH) {
        fail(new Error('Rumble page is too large'))
        return
      }
      /** @type {Buffer[]} */
      const chunks = []
      let length = 0
      response.on('data', (chunk) => {
        length += chunk.length
        if (length > MAX_PAGE_LENGTH) fail(new Error('Rumble page is too large'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') })
      })
      response.on('error', fail)
    })
    request.on('error', fail)
    request.setHeader('Accept', 'text/html')
    request.end()
  })
}
