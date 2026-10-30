import { session, WebContentsView } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'

import { isAttestedPoToken, mintAttestedPoToken } from './attestedPoToken'
import { withTimeout } from './promiseTimeout'

// #region queue

/**
 * This is the internal Promise object which resolves when all the tasks of the queue are done.
 * It will change any time {@linkcode enqueueAsyncFunction} is called.
 */
let queueGuardian = Promise.resolve()

/**
 * Enqueues an asynchronous function to be executed after the previous ones in the queue have finished.
 * That way the promises/asynchronous functions are executed sequentially rather than in parallel.
 *
 * @template T
 * @param {T} func
 * @param {Parameters<T>} args
 * @returns {ReturnType<T>}
 */
function enqueueAsyncFunction(func, ...args) {
  queueGuardian = queueGuardian.then(() => {
    return func(...args)
      .then(result => ({ error: false, result }), result => ({ error: true, result }))
  })

  return queueGuardian.then(({ error, result }) => {
    if (error) return Promise.reject(result)
    else return Promise.resolve(result)
  })
}

// #endregion queue

let firstTime = true

/**
 * Generates a content-bound poToken (proof of origin token) using `bgutils-js`.
 * The script to generate it is `src/botGuardScript.js`
 *
 * This is intentionally split out into it's own thing, with it's own in-memory session,
 * as the BotGuard stuff accesses the global `document` and `window` objects and also requires making some requests.
 * So we definitely don't want it running in the same places as the rest of the FreeTube code with the user data.
 * @param {string} videoId
 * @param {string} context
 * @param {string} initialAttestationData
 * @param {string} ytConfig
 * @param {string|undefined} proxyUrl
 * @returns {Promise<string>}
 */
export function generatePoToken(videoId, context, initialAttestationData, ytConfig, proxyUrl) {
  if (firstTime) {
    firstTime = false
    enqueueAsyncFunction(sharedInit)
  }

  // We use a promise queue instead of running the `mintPoToken` function directly
  // so that we can reuse the same session by clearing all data
  // associated with the session before the next attestation.

  // Electron's session objects stick around for the entire lifetime of the Electron main process,
  // holding onto OS resources such as the OS DNS resolver, so if we created a new session for each PO token generation
  // the OS will eventually complain about the resources being exhausted (e.g. too many inotify instances on Linux)

  // References
  // - https://github.com/FreeTubeApp/FreeTube/issues/8640
  // - https://github.com/electron/electron/pull/46131
  // - https://github.com/electron/electron/commit/bac2f46ba981cc1763c0485cec44813c1d07fa18
  return mintAttestedPoToken(() => enqueueAsyncFunction(mintPoToken, videoId, context, initialAttestationData, ytConfig, proxyUrl))
}

/** @type {import('electron').Session} */
let theSession
/** @type {string} */
let cachedScript

async function sharedInit() {
  // setup session

  theSession = session.fromPartition('potoken', { cache: false })

  theSession.setPermissionCheckHandler(() => false)
  // eslint-disable-next-line n/no-callback-literal
  theSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false))

  theSession.setUserAgent(session.defaultSession.getUserAgent())

  theSession.webRequest.onBeforeSendHeaders({
    urls: ['https://www.google.com/js/*', 'https://www.youtube.com/youtubei/*']
  }, ({ requestHeaders, url }, callback) => {
    if (url.startsWith('https://www.youtube.com/youtubei/')) {
      // make InnerTube requests work with the fetch function
      // InnerTube rejects requests if the referer isn't YouTube or empty
      requestHeaders.Referer = 'https://www.youtube.com/'
      requestHeaders.Origin = 'https://www.youtube.com'

      requestHeaders['Sec-Fetch-Site'] = 'same-origin'
      requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
      requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
    } else {
      requestHeaders['Sec-Fetch-Dest'] = 'script'
      requestHeaders['Sec-Fetch-Site'] = 'cross-site'
      requestHeaders['Accept-Language'] = '*'
    }

    // eslint-disable-next-line n/no-callback-literal
    callback({ requestHeaders })
  })

  theSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, ({ responseHeaders }, callback) => {
    if (responseHeaders) {
      // eslint-disable-next-line n/no-callback-literal
      callback({
        responseHeaders: {
          ...responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Methods': ['GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH']
        }
      })
    }
  })

  theSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'], types: ['cspReport', 'ping'] }, (details, callback) => {
    // eslint-disable-next-line n/no-callback-literal
    callback({ cancel: true })
  })

  // load script file

  const pathToScript = process.env.NODE_ENV === 'development'
    ? join(__dirname, '../../dist/botGuardScript.js')
    : join(__dirname, 'botGuardScript.js')

  const scriptContent = await readFile(pathToScript, 'utf-8')

  const scriptExportMatch = scriptContent.match(/export{(\w+) as default};/)

  cachedScript = scriptContent.replace(scriptExportMatch[0], `;${scriptExportMatch[1]}(FT_PARAMS)`)
}

// bgutils-js 4 can leave its callback-backed snapshot pending forever.
const GENERATE_TIMEOUT_MS = 30 * 1000

/**
 * The BotGuard view of the current attestation. A full BotGuard run takes a
 * second or more, while minting from an attestation takes milliseconds.
 * @type {{ view: WebContentsView, proxyUrl: string | undefined, expiresAt: number, expiryTimer: ReturnType<typeof setTimeout> } | null}
 */
let attestation = null

/**
 * @param {string} videoId
 * @param {string} context
 * @param {string} initialAttestationData
 * @param {string} ytConfig
 * @param {string|undefined} proxyUrl
 * @returns {Promise<string>}
 */
async function mintPoToken(videoId, context, initialAttestationData, ytConfig, proxyUrl) {
  if (attestation && (attestation.proxyUrl !== proxyUrl || Date.now() >= attestation.expiresAt)) {
    await discardAttestation()
  }

  let token
  if (attestation) {
    try {
      token = await withTimeout(
        attestation.view.webContents.executeJavaScript(`window.ftMintPoToken(${JSON.stringify(videoId)})`),
        GENERATE_TIMEOUT_MS,
        `PO token minting timed out after ${GENERATE_TIMEOUT_MS}ms`
      )
    } catch (error) {
      console.error('Failed to mint a PO token from the current attestation, attesting again', error)
      await discardAttestation()
    }
  }
  token ??= await attest(videoId, context, initialAttestationData, ytConfig, proxyUrl)

  // Every token from an untrusted attestation is pending attestation too
  if (!isAttestedPoToken(token)) {
    await discardAttestation()
  }
  return token
}

async function discardAttestation() {
  if (!attestation) return
  clearTimeout(attestation.expiryTimer)
  if (!attestation.view.webContents.isDestroyed()) {
    attestation.view.webContents.close({ waitForBeforeUnload: false })
  }
  attestation = null
  await cleanupSession()
}

/**
 * @param {string} videoId
 * @param {string} context
 * @param {string} initialAttestationData
 * @param {string} ytConfig
 * @param {string|undefined} proxyUrl
 * @returns {Promise<string>}
 */
async function attest(videoId, context, initialAttestationData, ytConfig, proxyUrl) {
  let webContentsView
  let keepView = false

  try {
    if (proxyUrl) {
      await theSession.setProxy({
        proxyRules: proxyUrl
      })
    }

    webContentsView = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        safeDialogs: true,
        sandbox: true,
        contextIsolation: true,
        v8CacheOptions: 'none',
        session: theSession,
        offscreen: true,
        disableBlinkFeatures: 'ElectronCSSCornerSmoothing'
      }
    })

    webContentsView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    webContentsView.webContents.setAudioMuted(true)
    webContentsView.setBounds({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })

    webContentsView.webContents.debugger.attach()

    await webContentsView.webContents.loadURL('data:text/html,<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
      baseURLForDataURL: 'https://www.youtube.com/'
    })

    await webContentsView.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1920,
      screenHeight: 1080,
      positionX: 0,
      positionY: 0,
      screenOrientation: {
        type: 'landscapePrimary',
        angle: 0
      }
    })

    const script = cachedScript.replace('FT_PARAMS', () => `"${videoId}",${context},${initialAttestationData},${ytConfig}`)

    // The attestation's lifetime starts during this run, so count it from before
    const startedAt = Date.now()
    const token = await withTimeout(
      webContentsView.webContents.executeJavaScript(script),
      GENERATE_TIMEOUT_MS,
      `PO token generation timed out after ${GENERATE_TIMEOUT_MS}ms`
    )

    const validForSecs = await webContentsView.webContents.executeJavaScript('window.ftPoTokenValidForSecs')
    const expiresAt = startedAt + validForSecs * 1000
    if (expiresAt > Date.now()) {
      // Release the view once it expires, even if no other video needs a token
      const expiryTimer = setTimeout(() => {
        enqueueAsyncFunction(async () => {
          if (attestation?.view === webContentsView) await discardAttestation()
        })
      }, expiresAt - Date.now())
      attestation = { view: webContentsView, proxyUrl, expiresAt, expiryTimer }
      keepView = true
    }
    return token
  } finally {
    if (webContentsView && !keepView) {
      webContentsView.webContents.close({ waitForBeforeUnload: false })
      await cleanupSession()
    }
  }
}

async function cleanupSession() {
  await theSession.closeAllConnections()
  await theSession.clearData()
}
