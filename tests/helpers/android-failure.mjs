import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { androidAppId } from './android-webview.mjs'

/**
 * Adds the page's state to a failed WebView script's error, and saves a
 * screenshot and the app's logcat as `<name>-failure.png` and
 * `<name>-failure-logcat.txt` in ANDROID_ARTIFACT_DIR, which CI uploads with
 * the shard's `android-test-reports-<shard>` artifact.
 * @param {Error} error the test's failure, rethrown with the state appended
 * @param {import('@playwright/test').Page} page
 * @param {string} name file name prefix for the artifacts
 * @param {() => unknown} describePage runs in the page and returns its state
 * @returns {Promise<never>}
 */
export async function rethrowWithAndroidState(error, page, name, describePage) {
  const report = {}
  try {
    report.page = await page.evaluate(describePage)
  } catch (stateError) {
    report.pageError = String(stateError?.message ?? stateError)
  }
  const directory = process.env.ANDROID_ARTIFACT_DIR
  if (directory) {
    await mkdir(directory, { recursive: true })
    await page.screenshot({ path: `${directory}/${name}-failure.png`, timeout: 10000 }).catch(screenshotError => {
      report.screenshotError = String(screenshotError?.message ?? screenshotError)
    })
    if (process.env.ANDROID_SERIAL) {
      try {
        const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        const pid = adb('shell', 'pidof', androidAppId()).trim()
        await writeFile(`${directory}/${name}-failure-logcat.txt`, adb('logcat', '-d', '-v', 'threadtime', ...(pid ? [`--pid=${pid}`] : [])))
      } catch (logcatError) {
        report.logcatError = String(logcatError?.message ?? logcatError)
      }
    }
  }
  if (error instanceof Error) {
    const state = `\nAndroid state: ${JSON.stringify(report, null, 2)}`
    error.message += state
    // node:test prints the stack, which keeps the original message.
    if (error.stack) error.stack += state
  }
  throw error
}
