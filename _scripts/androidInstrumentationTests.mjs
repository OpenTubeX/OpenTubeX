import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Runs one shard of the Android instrumentation tests and reruns failed tests
 * once, like Playwright's retry for the E2E tests. The orchestrator clears the
 * app data before every test, so a retry starts from a fresh profile too.
 * Tests that pass only on the retry are written to ANDROID_FLAKY_REPORT for
 * the flaky-test issue.
 *
 * Usage: node _scripts/androidInstrumentationTests.mjs <shard index> <shard count> [extra Gradle arguments]
 */

const RESULTS = 'android/app/build/outputs/androidTest-results/connected/debug'
const REPORT = 'android/app/build/reports/androidTests/connected'
// Inside the uploaded results, so the first attempt's failures stay visible.
const FIRST_ATTEMPT = 'android/app/build/outputs/androidTest-results/connected/first-attempt'
const SOURCES = 'android/app/src/androidTest/java'

const [shardIndex, shardCount, ...extraArgs] = process.argv.slice(2)
const runnerArgument = (name, value) => `-Pandroid.testInstrumentationRunnerArguments.${name}=${value}`

function runTests(args) {
  const gradle = spawnSync('./android/gradlew', [
    '--project-dir', 'android', ':app:connectedDebugAndroidTest', '-PtestAbi=x86_64',
    // A hung test fails after ten minutes instead of using up the shard.
    runnerArgument('timeout_msec', 600000),
    runnerArgument('listener', 'org.opentubex.app.FailureDiagnostics'),
    // Gradle keeps the last value of a property, so the retry's test filter wins.
    ...extraArgs,
    ...args
  ], { stdio: 'inherit' })
  return gradle.status === 0
}

function emulatorRunning() {
  return spawnSync('adb', ['get-state'], { stdio: 'inherit' }).status === 0
}

function attribute(attributes, name) {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1] ?? ''
}

/** Reads the test cases of the last Gradle run from its JUnit reports. */
function testCases() {
  if (!existsSync(RESULTS)) return []
  return readdirSync(RESULTS)
    .filter(name => name.startsWith('TEST-') && name.endsWith('.xml'))
    .flatMap(name => [...readFileSync(join(RESULTS, name), 'utf8')
      .matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)]
      .map(([, attributes, body = '']) => {
        // AGP reports a test that skips on an assumption as a failure.
        const assumption = /<failure\b[^>]*>\s*org\.junit\.(?:internal\.)?AssumptionViolatedException/.test(body)
        return {
          className: attribute(attributes, 'classname'),
          name: attribute(attributes, 'name'),
          failed: !assumption && /<(?:failure|error)\b/.test(body),
          skipped: assumption || /<skipped\b/.test(body)
        }
      }))
}

/** Finds the test method's source file and line for the issue and annotations. */
function location({ className, name }) {
  for (const extension of ['java', 'kt']) {
    const file = `${SOURCES}/${className.replaceAll('.', '/')}.${extension}`
    if (!existsSync(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    // Parameterized tests append "[index]" to the method name.
    const method = name.replace(/\[.*$/, '')
    const index = lines.findIndex(line => new RegExp(`\\b(?:void|fun)\\s+${method}\\s*\\(`).test(line))
    return { file, line: index + 1 || 1 }
  }
  return { file: `${SOURCES}/${className.replaceAll('.', '/')}.java`, line: 1 }
}

function adb(...args) {
  return spawnSync('adb', args, { encoding: 'utf8' })
}

/** Runs `adb root` or `adb unroot` and waits until the shell has that user. */
function switchAdbUser(command, uid) {
  for (let attempt = 0; attempt < 30 && adb(command).status !== 0; attempt++) spawnSync('sleep', ['2'])
  adb('wait-for-device')
  for (let attempt = 0; attempt < 30 && !adb('shell', 'id').stdout?.includes(`uid=${uid}(`); attempt++) spawnSync('sleep', ['1'])
}

/**
 * Keeps why Android ended the app's processes during the first attempt. A
 * test whose process is killed, for example after an ANR that the hidden error
 * dialogs turn into a silent kill, otherwise only reports that the
 * instrumentation process crashed. The ANR traces hold every thread's stack.
 */
function saveExitDiagnostics() {
  const metadata = 'android/app/build/outputs/apk/debug/output-metadata.json'
  const { applicationId } = JSON.parse(readFileSync(metadata, 'utf8'))
  writeFileSync(join(FIRST_ATTEMPT, 'exit-info.txt'), adb('shell', 'dumpsys', 'activity', 'exit-info', applicationId).stdout ?? '')
  // The traces are only readable as root, and the tests run without it.
  switchAdbUser('root', 0)
  const traces = adb('shell', 'ls /data/system/procexitstore/ | grep ^anr_').stdout?.split('\n').map(name => name.trim()).filter(Boolean) ?? []
  mkdirSync(join(FIRST_ATTEMPT, 'anr'), { recursive: true })
  for (const trace of traces) adb('pull', `/data/system/procexitstore/${trace}`, join(FIRST_ATTEMPT, 'anr', trace))
  switchAdbUser('unroot', 2000)
}

/**
 * Restores emulator Wi-Fi if the guest dropped its wlan0 route mid-shard (for
 * example after missed virtual AP beacons on a busy runner), so retries of
 * network-dependent tests do not fail on the same broken network state.
 */
function ensureEmulatorWifi() {
  const hasRoute = () => /default via .* dev wlan0 table/.test(adb('shell', 'ip', 'route', 'show', 'table', 'all').stdout ?? '')
  if (hasRoute()) return
  console.log('Emulator Wi-Fi lost its wlan0 default route; reconnecting before retry')
  // The Wi-Fi state machine's history records why the network disconnected.
  const wifi = join(FIRST_ATTEMPT, 'wifi')
  mkdirSync(wifi, { recursive: true })
  for (const [name, ...command] of [
    ['wifi.txt', 'dumpsys', 'wifi'],
    ['connectivity.txt', 'dumpsys', 'connectivity'],
    ['addresses.txt', 'ip', 'address'],
    ['routes.txt', 'ip', 'route', 'show', 'table', 'all']
  ]) {
    writeFileSync(join(wifi, name), adb('shell', ...command).stdout ?? '')
  }
  adb('shell', 'cmd', 'wifi', 'set-wifi-enabled', 'disabled')
  for (let attempt = 0; attempt < 30 && !(adb('shell', 'cmd', 'wifi', 'status').stdout ?? '').includes('Wifi is disabled'); attempt++) {
    spawnSync('sleep', ['1'])
  }
  adb('shell', 'cmd', 'wifi', 'set-wifi-enabled', 'enabled')
  for (let attempt = 0; attempt < 30 && !(adb('shell', 'cmd', 'wifi', 'status').stdout ?? '').includes('Wifi is enabled'); attempt++) {
    spawnSync('sleep', ['1'])
  }
  // Re-enabling Wi-Fi alone does not rejoin a network that Android disabled
  // after a failed internet check, so connect to the emulator's access point
  // like a user would.
  adb('shell', 'cmd', 'wifi', 'connect-network', 'AndroidWifi', 'open')
  for (let attempt = 0; attempt < 120 && !hasRoute(); attempt++) {
    spawnSync('sleep', ['1'])
  }
  console.log(hasRoute() ? 'Emulator Wi-Fi is back' : 'Emulator Wi-Fi is still missing its wlan0 default route')
}

// Gradle can report success after the emulator has crashed and skipped the
// remaining tests, or after test discovery crashed before any test ran, so
// also require the emulator to still run and the shard to report tests.
if (runTests([runnerArgument('numShards', shardCount), runnerArgument('shardIndex', shardIndex)])) {
  process.exit(emulatorRunning() && testCases().length > 0 ? 0 : 1)
}

const failed = testCases().filter(test => test.failed)
// Without failed tests, the build, the installation, or the emulator failed;
// a rerun of the job handles those.
if (failed.length === 0 || !emulatorRunning()) process.exit(1)

rmSync(FIRST_ATTEMPT, { recursive: true, force: true })
cpSync(RESULTS, join(FIRST_ATTEMPT, 'results'), { recursive: true })
if (existsSync(REPORT)) cpSync(REPORT, join(FIRST_ATTEMPT, 'report'), { recursive: true })
try {
  saveExitDiagnostics()
} catch (error) {
  console.log(`Could not save the app's exit diagnostics: ${error}`)
}
ensureEmulatorWifi()

const ids = failed.map(test => `${test.className}#${test.name}`)
console.log(`Retrying ${ids.length} failed tests once:\n  ${ids.join('\n  ')}`)
// Gradle runs only the first test of a comma-separated "class" filter, so
// select the tests with a regex. The device shell receives the arguments
// unquoted; Java names contain no single quotes.
const pattern = ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const retryPassed = runTests([runnerArgument('tests_regex', `'^(${pattern})$'`)])
const retried = testCases()

// A retry that skips on an assumption does not show that the test passes.
const passedOnRetry = failed.filter(test => retried.some(retry =>
  retry.className === test.className && retry.name === test.name && !retry.failed && !retry.skipped))
const flaky = passedOnRetry.map(test => ({ project: 'instrumentation', title: `${test.className.split('.').pop()} › ${test.name}`, ...location(test) }))
if (flaky.length > 0) {
  if (process.env.ANDROID_FLAKY_REPORT) writeFileSync(process.env.ANDROID_FLAKY_REPORT, JSON.stringify(flaky))
  for (const { title, file, line } of flaky) {
    console.log(`::warning file=${file},line=${line},title=Flaky test::${title} passed only on retry`)
  }
}

process.exit(retryPassed && emulatorRunning() && passedOnRetry.length === failed.length ? 0 : 1)
