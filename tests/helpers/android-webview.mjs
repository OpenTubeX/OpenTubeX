import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { appPage } from './android-app-page.mjs'

/** The app's package, read when called, since the script runner sets it from the APK after importing this. */
export const androidAppId = () => process.env.ANDROID_APP_ID || 'org.opentubex.app.dev'

const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8' }).trim()

function appProcess() {
  try {
    return adb('shell', 'pidof', androidAppId())
  } catch {
    // pidof fails when the app isn't running.
    return ''
  }
}

/**
 * Points ANDROID_CDP_URL's local port at the app's current WebView DevTools
 * socket, starting the app if it isn't running, and waits for the app page.
 *
 * The socket is named after the app's process, so a forward goes stale when
 * the app restarts, and a restarted adb server drops it. Without
 * ANDROID_SERIAL, this only waits for the page.
 * @param {number} [timeout]
 */
export async function forwardAndroidWebView(timeout = 120000) {
  const url = process.env.ANDROID_CDP_URL
  const deadline = Date.now() + timeout
  let forwarded = null
  for (;;) {
    try {
      if (process.env.ANDROID_SERIAL) {
        let pid = appProcess()
        if (!pid) {
          adb('shell', 'am', 'start', '-W', '-n', `${androidAppId()}/org.opentubex.app.MainActivity`)
          pid = appProcess()
        }
        const socket = `webview_devtools_remote_${pid}`
        if (pid && pid !== forwarded && new RegExp(`@${socket}$`, 'm').test(adb('shell', 'cat', '/proc/net/unix'))) {
          // Forwarding a local port again replaces its earlier target.
          adb('forward', `tcp:${new URL(url).port}`, `localabstract:${socket}`)
          forwarded = pid
        }
      }
      const targets = await (await fetch(`${url}/json`)).json()
      if (targets.some(target => target.url.startsWith('https://localhost/'))) return
    } catch {
      // The app or its WebView isn't ready yet, or a restarted adb server
      // dropped the forward, so forward the port again on the next try.
      forwarded = null
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the app's WebView at ${url}`)
    await delay(500)
  }
}

/**
 * Connects to the app's WebView, forwarding its DevTools socket again first,
 * since an earlier test may have restarted the app or the adb server.
 * ANDROID_CPU_THROTTLE=4 slows the WebView down like a busy CI emulator for
 * as long as the connection stays open.
 */
export async function connectAndroidApp() {
  await forwardAndroidWebView()
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = appPage(browser)
  const rate = Number(process.env.ANDROID_CPU_THROTTLE)
  if (rate > 1) {
    const session = await browser.contexts()[0].newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate })
  }
  return { browser, page }
}

/**
 * Takes the app offline, except for its own files. On Android, the app
 * requests through native plugins rather than fetch, so both are blocked.
 * Set `window.__androidTestNetwork.respond` in the page to a function that
 * returns a JSON response body for a URL, or undefined to block it. Undo it
 * all with `window.__androidTestNetwork?.restore()`.
 * @param {import('@playwright/test').Page} page
 */
export function blockAppNetwork(page) {
  return page.evaluate(() => {
    if (window.__androidTestNetwork) return
    const { fetch } = window
    const { nativePromise } = window.Capacitor
    const network = {
      respond: () => undefined,
      restore() {
        window.fetch = fetch
        window.Capacitor.nativePromise = nativePromise
        delete window.__androidTestNetwork
      }
    }
    window.__androidTestNetwork = network
    window.fetch = (input, options) => {
      const url = input instanceof Request ? input.url : String(input)
      if (/^(https:\/\/localhost\/|data:|blob:)/.test(url)) return fetch(input, options)
      const body = network.respond(url)
      return body === undefined
        ? Promise.reject(new TypeError('Offline Android test'))
        : Promise.resolve(Response.json(body))
    }
    window.Capacitor.nativePromise = function (plugin, method, options, ...args) {
      if ((plugin === 'CapacitorHttp' || plugin === 'AndroidHttp') && method === 'request') {
        const body = network.respond(options.url)
        return body === undefined
          ? Promise.reject(new Error('Offline Android test'))
          : Promise.resolve({ status: 200, headers: { 'content-type': 'application/json' }, data: JSON.stringify(body), url: options.url })
      }
      return nativePromise.call(this, plugin, method, options, ...args)
    }
  })
}

/**
 * Measures where the page's origin lies on the screen, in physical pixels,
 * for native input. Sends a native touch to the middle of the screen and
 * cancels it before it can tap anything. Unlike the window hierarchy, this
 * also works while the page animates or plays a video.
 * @param {import('@playwright/test').Page} page
 * @param {(command: string) => Promise<string>} shell runs an adb shell command and returns its output
 */
export async function measureNativeTouchOrigin(page, shell) {
  await page.evaluate(() => {
    window.__nativeTouchProbe = new Promise((resolve, reject) => {
      window.addEventListener('pointerdown',
        event => resolve([event.clientX, event.clientY]), { capture: true, once: true })
      setTimeout(() => reject(new Error('The native touch probe reached no pointerdown in the page')), 10_000)
    })
  })
  const [width, height] = (await shell('wm size')).match(/(\d+)x(\d+)\s*$/).slice(1).map(Number)
  const x = Math.round(width / 2)
  const y = Math.round(height / 2)
  await shell(`input motionevent DOWN ${x} ${y}; input motionevent CANCEL ${x} ${y}`)
  const [clientX, clientY, scale] = await page.evaluate(async () => {
    const [clientX, clientY] = await window.__nativeTouchProbe
    delete window.__nativeTouchProbe
    return [clientX, clientY, devicePixelRatio * visualViewport.scale]
  })
  return { x: x - clientX * scale, y: y - clientY * scale, scale }
}
