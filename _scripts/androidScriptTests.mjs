import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { run } from 'node:test'
import { spec } from 'node:test/reporters'
import { chromium } from '@playwright/test'
import { appPage } from '../tests/helpers/android-app-page.mjs'
import { forwardAndroidWebView } from '../tests/helpers/android-webview.mjs'

/**
 * Runs the WebView test scripts in tests/android against the debug APK on the
 * connected device, and reruns failed tests once with a freshly started
 * app, like the instrumentation tests. Tests that pass only on the retry are
 * added to ANDROID_FLAKY_REPORT for the flaky-test issue.
 *
 * The instrumentation tests uninstall the app, so this installs it again,
 * and clears its data, so that every run starts from the same state.
 *
 * Usage: node _scripts/androidScriptTests.mjs <test file>...
 */

const METADATA = 'android/app/build/outputs/apk/debug/output-metadata.json'
const PERMISSIONS = ['android.permission.POST_NOTIFICATIONS']

const files = process.argv.slice(2).map(file => resolve(file))
if (files.length === 0) throw new Error('Pass the test files to run')

// CI has one device. Locally, ANDROID_SERIAL selects one of several.
const serial = process.env.ANDROID_SERIAL || spawnSync('adb', ['get-serialno'], { encoding: 'utf8' }).stdout.trim()

function adb(...args) {
  const result = spawnSync('adb', ['-s', serial, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`adb ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

async function waitFor(description, check, timeout = 120000) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      const value = await check()
      if (value) return value
    } catch {
      // Not ready yet.
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`)
    await delay(1000)
  }
}

const { applicationId, elements } = JSON.parse(readFileSync(METADATA, 'utf8'))
const apk = resolve('android/app/build/outputs/apk/debug', elements[0].outputFile)
process.env.ANDROID_SERIAL = serial
process.env.ANDROID_APP_ID = applicationId
let forwardedPort = null

/** Starts the app from scratch and points the tests at its WebView. */
async function startApp() {
  adb('shell', 'am', 'force-stop', applicationId)
  adb('shell', 'am', 'start', '-W', '-n', `${applicationId}/org.opentubex.app.MainActivity`)
  if (!forwardedPort) {
    // tcp:0 picks a free local port. The tests forward it to the app's current
    // socket again, since the app's process or the adb server can restart.
    const pid = await waitFor('the app process', () => adb('shell', 'pidof', applicationId))
    forwardedPort = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
    process.env.ANDROID_CDP_URL = `http://127.0.0.1:${forwardedPort}`
  }
  await forwardAndroidWebView()
}

/** Skips the first-run tutorial, which makes the rest of the app inert. */
async function skipTutorial() {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  try {
    const page = appPage(browser)
    const tutorial = page.locator('.tutorialOverlay')
    await tutorial.locator('.tutorialSkip button').click({ timeout: 120000 })
    await tutorial.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => localStorage.getItem('opentubex.tutorial.audience') === 'completed')
  } finally {
    await browser.close()
  }
}

/**
 * Runs the tests and returns the top-level tests that failed.
 * @param {RegExp[] | undefined} testNamePatterns
 */
async function runTests(testNamePatterns) {
  const failed = new Map()
  const stream = run({ files, testNamePatterns, concurrency: 1 })
  stream.on('test:fail', ({ name, nesting, file, line, details }) => {
    // A skipped or todo test reports no failure.
    if (nesting === 0 && details.error) failed.set(`${file}\0${name}`, { name, file, line })
  })
  const passed = new Set()
  stream.on('test:pass', ({ name, nesting, file, skip }) => {
    if (nesting === 0 && !skip) passed.add(`${file}\0${name}`)
  })
  for await (const chunk of stream.compose(spec)) process.stdout.write(chunk)
  return { failed: [...failed.values()], passed }
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Runs the tests, retries failures once, and returns whether all passed. */
async function main() {
  adb('install', '-r', apk)
  // Start from a fresh profile, like the CI emulator, which always shows the tutorial.
  adb('shell', 'pm', 'clear', applicationId)
  for (const permission of PERMISSIONS) adb('shell', 'pm', 'grant', applicationId, permission)
  await startApp()
  await skipTutorial()
  const first = await runTests()
  if (first.failed.length === 0) return true

  console.log(`Retrying ${first.failed.length} failed tests once with a restarted app:\n  ${first.failed.map(test => test.name).join('\n  ')}`)
  await startApp()
  const retry = await runTests(first.failed.map(test => new RegExp(`^${escape(test.name)}$`)))
  const passedOnRetry = first.failed.filter(test => retry.passed.has(`${test.file}\0${test.name}`))
  const flaky = passedOnRetry.map(test => ({
    project: 'webview-script',
    title: test.name,
    file: relative(process.cwd(), test.file),
    line: test.line ?? 1
  }))
  if (flaky.length > 0) {
    const report = process.env.ANDROID_FLAKY_REPORT
    if (report) {
      // The instrumentation tests of this shard may have written flaky tests already.
      const earlier = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : []
      writeFileSync(report, JSON.stringify([...earlier, ...flaky]))
    }
    for (const { title, file, line } of flaky) {
      console.log(`::warning file=${file},line=${line},title=Flaky test::${title} passed only on retry`)
    }
  }
  // Tests with the same name in several files all run again, so any of them can fail.
  return retry.failed.length === 0 && passedOnRetry.length === first.failed.length
}

try {
  process.exitCode = await main() ? 0 : 1
} finally {
  // A restarted adb server has dropped the forward already.
  if (forwardedPort) spawnSync('adb', ['-s', serial, 'forward', '--remove', `tcp:${forwardedPort}`])
}
