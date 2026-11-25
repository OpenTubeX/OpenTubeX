import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

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
