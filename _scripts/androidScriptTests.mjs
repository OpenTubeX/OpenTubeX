import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
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
 * and clears its data, so that every run starts from the same state. Each
 * file starts with a restarted app, so that no page, stub or session state
 * of an earlier file leaks into it. Needs ffmpeg for the media fixtures.
 *
 * Usage: node _scripts/androidScriptTests.mjs [<test file>... | <shard> <shards> | api37 | cast-receiver]
 */

const METADATA = 'android/app/build/outputs/apk/debug/output-metadata.json'
// rotation-fullscreen runs an instrumentation test from the androidTest APK.
const TEST_METADATA = 'android/app/build/outputs/apk/androidTest/debug/output-metadata.json'
const PERMISSIONS = ['android.permission.POST_NOTIFICATIONS']

// The scripts to run, with their seconds on a local emulator, which balance
// the shards. These scripts in tests/android stay out:
// - chromecast-receiver needs a debug APK whose sender trusts a test root, and
//   openchromecast and mpv. _scripts/androidCastReceiverTest.mjs prepares them
//   and runs it with `cast-receiver`.
// - large-screen-fullscreen and local-network-permission need Android 17, so
//   they run in their own list on an API 37 emulator.
// - mobile-performance runs in a desktop Chromium, not on the device, and the
//   E2E workflow runs it on every pull request.
const SCRIPTS = [
  ['always-show-scrollbars', 9],
  ['audio-player-surfaces', 4],
  ['audio-player-tap', 20],
  ['background-tab-toast', 17],
  ['channel-banner-recovery', 7],
  ['chromecast-settings', 38],
  ['comments-startup', 46],
  ['control-bar-buttons', 19],
  ['fullscreen-actions', 18],
  ['fullscreen-controls', 19],
  ['fullscreen-docks', 11],
  ['fullscreen-portrait-panels', 10],
  ['fullscreen-seek-gesture', 83],
  ['fullscreen-status-bar', 28],
  ['fullscreen-transition', 53],
  ['header-organizer-swipe', 88],
  ['header-page-swipe', 76],
  ['header-page-swipe-scroll', 24],
  ['image-timeout-recovery', 5],
  ['material-you', 18],
  ['mini-player-navigation', 36],
  ['mobile-mini-player', 390],
  ['notification-center', 64],
  ['offline-mini-player', 18],
  ['offline-queue-playback', 82],
  ['offline-recommendations', 5],
  ['organizer-animation', 9],
  ['organizer-native-tap', 3],
  ['picture-in-picture-lifecycle', 90],
  ['picture-in-picture-rendering', 8],
  ['playback-speed-hold', 29],
  ['player-controls-rendering', 6],
  ['rotation-fullscreen', 30],
  ['sabr-background-start', 214],
  ['sync-custom-themes', 3],
  ['sync-device-position', 19],
  ['sync-device-removal', 165],
  ['sync-device-stats', 18],
  ['tab-swipe-rendering', 9],
  ['thumbnail-swipe', 66],
  ['watch-scroll-range', 7],
]

// Scripts that need Android 17. Pass `api37` to run them.
const API_37_SCRIPTS = [
  ['large-screen-fullscreen', 30],
  ['local-network-permission', 15],
]

const CAST_RECEIVER_SCRIPTS = [['chromecast-receiver', 115]]

/** @param {[string, number]} script */
const scriptFile = ([name]) => `tests/android/${name}.test.mjs`

/**
 * Splits the scripts into shards of similar duration, longest first.
 * @param {number} shard
 * @param {number} shards
 */
function shardScripts(shard, shards) {
  const totals = Array(shards).fill(0)
  const assigned = Array.from({ length: shards }, () => [])
  for (const script of [...SCRIPTS].sort((a, b) => b[1] - a[1])) {
    const index = totals.indexOf(Math.min(...totals))
    totals[index] += script[1]
    assigned[index].push(scriptFile(script))
  }
  return assigned[shard].sort()
}

const args = process.argv.slice(2)
const shardArgs = args.length === 2 && args.every(arg => /^\d+$/.test(arg)) ? args.map(Number) : null
const files = (shardArgs
  ? shardScripts(...shardArgs)
  : args.length === 1 && args[0] === 'api37'
    ? API_37_SCRIPTS.map(scriptFile)
    : args.length === 1 && args[0] === 'cast-receiver'
      ? CAST_RECEIVER_SCRIPTS.map(scriptFile)
      : args.length > 0 ? args : SCRIPTS.map(scriptFile))
  .map(file => resolve(file))
if (shardArgs && files.length === 0) throw new Error(`Shard ${shardArgs[0]} of ${shardArgs[1]} has no scripts`)

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

/** @param {string} metadata */
function apkPath(metadata) {
  const { applicationId, elements } = JSON.parse(readFileSync(metadata, 'utf8'))
  return { applicationId, apk: resolve(metadata, '..', elements[0].outputFile) }
}

const { applicationId, apk } = apkPath(METADATA)
process.env.ANDROID_SERIAL = serial
process.env.ANDROID_APP_ID = applicationId
let forwardedPort = null

/** Starts the app from scratch and points the tests at its WebView. */
async function startApp() {
  // A file stopped for hanging skipped its cleanup, which may have left the
  // device asleep or locked.
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  adb('shell', 'wm', 'dismiss-keyguard')
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

/**
 * Skips the first-run tutorial, which makes the rest of the app inert, and
 * stops the app from offering yt-dlp updates, whose toast covers controls
 * the tests tap. The app checks for updates when it starts, so restart it.
 */
async function prepareProfile() {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  try {
    const page = appPage(browser)
    const tutorial = page.locator('.tutorialOverlay')
    await tutorial.locator('.tutorialSkip button').click({ timeout: 120000 })
    await tutorial.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => localStorage.getItem('opentubex.tutorial.audience') === 'completed')
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .dispatch('updateExternalSoftwareUpdateMode', 'manual'))
  } finally {
    await browser.close()
  }
  await startApp()
}

/**
 * Copies the downloaded-audio fixtures into the app's files, where the app's
 * own file loader reads them. A queue test needs a first track of at least
 * 20 seconds, longer than the demo clip.
 */
function prepareMedia() {
  const directory = mkdtempSync(join(tmpdir(), 'opentubex-script-media-'))
  try {
    const long = join(directory, 'long-audio.mp3')
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', '-ac', '1', '-q:a', '9', long])
    const files = { 'demo-audio.mp3': resolve('e2e/fixtures/media/demo-audio.mp3'), 'long-audio.mp3': long }
    adb('shell', 'run-as', applicationId, 'mkdir', '-p', 'files/script-tests')
    for (const [name, path] of Object.entries(files)) {
      // adb cannot write to the app's private files, but the app's user can copy there.
      adb('push', path, `/data/local/tmp/${name}`)
      adb('shell', 'run-as', applicationId, 'cp', `/data/local/tmp/${name}`, `files/script-tests/${name}`)
      adb('shell', 'rm', `/data/local/tmp/${name}`)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  const media = `/data/user/0/${applicationId}/files/script-tests`
  process.env.ANDROID_OFFLINE_MEDIA_PATH = `${media}/demo-audio.mp3`
  process.env.ANDROID_OFFLINE_FIRST_MEDIA_PATH = `${media}/long-audio.mp3`
}

/**
 * How long a file may take before it counts as hung: several times its local
 * duration, since CI runs the emulator with software rendering.
 * @param {string} file
 */
function fileTimeout(file) {
  const seconds = [...SCRIPTS, ...API_37_SCRIPTS, ...CAST_RECEIVER_SCRIPTS].find(script => file === resolve(scriptFile(script)))?.[1] ?? 60
  return (120 + seconds * 6) * 1000
}

/**
 * Runs the tests of one file and returns its top-level tests that failed. A
 * file that hangs is stopped and fails as a whole.
 * @param {string} file
 * @param {RegExp[] | undefined} testNamePatterns
 */
async function runTests(file, testNamePatterns) {
  const failed = new Map()
  // A connection that a failed test left open would keep the file's process
  // alive after its tests finished, so exit once they have.
  const stream = run({ files: [file], testNamePatterns, concurrency: 1, forceExit: true, signal: AbortSignal.timeout(fileTimeout(file)) })
  stream.on('test:fail', ({ name, nesting, file, line, details }) => {
    // A skipped or todo test reports no failure.
    if (nesting !== 0 || !details.error) return
    const hung = name === file
    if (hung) name = `${relative(process.cwd(), file)} timed out`
    failed.set(`${file}\0${name}`, { name, file, line, hung })
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
  if (existsSync(TEST_METADATA)) adb('install', '-r', '-t', apkPath(TEST_METADATA).apk)
  // Start from a fresh profile, like the CI emulator, which always shows the tutorial.
  adb('shell', 'pm', 'clear', applicationId)
  for (const permission of PERMISSIONS) adb('shell', 'pm', 'grant', applicationId, permission)
  prepareMedia()
  await startApp()
  await prepareProfile()
  const failed = []
  for (const [index, file] of files.entries()) {
    // prepareProfile has just started the app for the first file.
    if (index > 0) await startApp()
    const started = Date.now()
    failed.push(...(await runTests(file)).failed)
    console.log(`${relative(process.cwd(), file)} took ${Math.round((Date.now() - started) / 1000)} s`)
  }
  if (failed.length === 0) return true

  console.log(`Retrying ${failed.length} failed tests once with a restarted app:\n  ${failed.map(test => test.name).join('\n  ')}`)
  const retry = { failed: [], passed: new Set() }
  for (const file of new Set(failed.map(test => test.file))) {
    await startApp()
    const tests = failed.filter(test => test.file === file)
    // A hung file runs again in full, and passes when all its tests do.
    const hung = tests.find(test => test.hung)
    const result = await runTests(file, hung ? undefined : tests.map(test => new RegExp(`^${escape(test.name)}$`)))
    if (hung && result.failed.length === 0) result.passed.add(`${file}\0${hung.name}`)
    retry.failed.push(...result.failed)
    for (const key of result.passed) retry.passed.add(key)
  }
  const passedOnRetry = failed.filter(test => retry.passed.has(`${test.file}\0${test.name}`))
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
  return retry.failed.length === 0 && passedOnRetry.length === failed.length
}

// The first fullscreen of a fresh emulator shows Android's immersive mode
// hint, which takes Back presses and native touches from the app.
const immersiveConfirmations = adb('shell', 'settings', 'get', 'secure', 'immersive_mode_confirmations')
adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed')
try {
  process.exitCode = await main() ? 0 : 1
} finally {
  // A restarted adb server has dropped the forward already.
  if (forwardedPort) spawnSync('adb', ['-s', serial, 'forward', '--remove', `tcp:${forwardedPort}`])
  if (immersiveConfirmations === 'null') adb('shell', 'settings', 'delete', 'secure', 'immersive_mode_confirmations')
  else adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', `'${immersiveConfirmations}'`)
}
