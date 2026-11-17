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
 * @returns {Promise<{ status: number, text: string, challenge: boolean }>}
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
        resolve({
          status: response.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
          // Cloudflare wants a browser to pass its check first
          challenge: String(response.headers['cf-mitigated']) === 'challenge'
        })
      })
      response.on('error', fail)
    })
    request.on('error', fail)
    request.setHeader('Accept', 'text/html')
    request.end()
  })
}

/** @type {Promise<void> | null} */
let pendingChallenge = null

/**
 * Opens a Rumble page in a window of the app's session, so the user can pass
 * Cloudflare's check there. Cloudflare then sets a cookie, tied to the user
 * agent and IP address, that also lets `fetchRumblePage` through. Settles once
 * the window loads the page itself, which closes it, or once the user closes
 * it. Cloudflare only accepts the cookie after its check loaded the page again,
 * so the cookie alone doesn't mean the user passed. The window may only show
 * Rumble pages and can't open others.
 * @param {{ BrowserWindow: typeof Electron.BrowserWindow, parent: Electron.BrowserWindow | null }} options
 * @param {unknown} url
 * @returns {Promise<void>}
 */
export function passRumbleChallenge({ BrowserWindow, parent }, url) {
  const target = rumblePageUrl(url)
  // Requests that hit the check at once share one window
  pendingChallenge ??= new Promise((resolve) => {
    const window = new BrowserWindow({
      ...(parent ? { parent } : {}),
      width: 520,
      height: 680,
      title: 'Rumble',
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        safeDialogs: true,
        spellcheck: false
      }
    })
    // Keeps saying which site the window shows, as it has no address bar
    window.on('page-title-updated', event => event.preventDefault())
    window.once('closed', () => {
      pendingChallenge = null
      resolve()
    })

    const { webContents } = window
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    /** @param {Electron.Event<Electron.WebContentsWillNavigateEventParams>} event */
    const guard = (event) => {
      try {
        rumblePageUrl(event.url)
      } catch {
        event.preventDefault()
      }
    }
    webContents.on('will-navigate', guard)
    webContents.on('will-redirect', guard)
    // Cloudflare answers with 403 while it checks, and other errors stay
    // open for the user to read
    webContents.on('did-navigate', (_event, _url, status) => {
      if (status < 400) window.close()
    })
    webContents.loadURL(target.href).catch(() => {
      // The window shows the error, and the user closes it
    })
  })
  return pendingChallenge
}
