import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Runs tests/android/chromecast-receiver.test.mjs, in which the app casts MP4,
 * DASH and HLS to openchromecast, an open source Cast receiver that plays them
 * with mpv on this host.
 *
 * Senders accept only receivers whose device certificate chains to a Cast
 * root, so the test needs a debug APK whose sender also trusts a temporary
 * root, which `prepare` generates with a device certificate for the receiver.
 * Release and nightly builds refuse that root.
 *
 *   node _scripts/androidCastReceiverTest.mjs prepare DIR
 *   ./android/gradlew --project-dir android :app:assembleDebug :app:assembleDebugAndroidTest -PcastTestRoot=DIR/root.pem
 *   node _scripts/androidCastReceiverTest.mjs run DIR
 *
 * `run` installs the APKs on ANDROID_SERIAL, or the only device, starts the
 * receiver, in xvfb-run without a display, and runs the test with
 * androidScriptTests.mjs, which retries a failure once. Needs openssl and
 * ffmpeg for `prepare`, and openchromecast and mpv for `run`. The receiver
 * logs to ANDROID_ARTIFACT_DIR, if set, or DIR.
 */

const RECEIVER_PORT = 18009
const [command, directory] = process.argv.slice(2)
if (!['prepare', 'run'].includes(command) || !directory) {
  throw new Error('Usage: node _scripts/androidCastReceiverTest.mjs prepare|run DIR')
}
const dir = resolve(directory)
const fixtures = join(dir, 'fixtures')

function run(file, args, options = {}) {
  execFileSync(file, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options })
}

function prepare() {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(fixtures, { recursive: true })
  // Valid for the run only. The root's key is deleted once it has signed the
  // device certificate, so nothing else can be issued from it.
  const rootKey = join(dir, 'root.key')
  run('openssl', ['req', '-quiet', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', rootKey, '-out', join(dir, 'root.pem'),
    '-days', '2', '-subj', '/CN=OpenTubeX Cast receiver test root',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign'])
  run('openssl', ['req', '-quiet', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'device.key'), '-out', join(dir, 'device.csr'),
    '-subj', '/CN=OpenTubeX Cast test receiver'])
  const extensions = join(dir, 'device.ext')
  writeFileSync(extensions, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n')
  run('openssl', ['x509', '-req', '-in', join(dir, 'device.csr'), '-CA', join(dir, 'root.pem'), '-CAkey', rootKey,
    '-set_serial', '2', '-days', '2', '-extfile', extensions, '-out', join(dir, 'device.pem')])
  for (const file of [rootKey, join(dir, 'device.csr'), extensions]) rmSync(file)

  // 30 seconds, since the test seeks 10 seconds ahead of the playback position.
  const ffmpeg = (...args) => run('ffmpeg', ['-v', 'error', '-y', ...args], { cwd: fixtures })
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart', 'video.mp4')
  // The fixture server serves flat file names, and the test checks for DASH's chunk- segments.
  ffmpeg('-i', 'video.mp4', '-c', 'copy', '-f', 'dash', '-seg_duration', '4', 'manifest.mpd')
  ffmpeg('-i', 'video.mp4', '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', 'segment%03d.ts', 'manifest.m3u8')
  console.log(`Build the APKs with -PcastTestRoot=${join(dir, 'root.pem')}, then run: node _scripts/androidCastReceiverTest.mjs run ${directory}`)
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

async function runTest() {
  const serial = process.env.ANDROID_SERIAL || execFileSync('adb', ['get-serialno'], { encoding: 'utf8' }).trim()
  if (await portOpen(RECEIVER_PORT)) throw new Error(`Port ${RECEIVER_PORT} is in use`)
  const receiverArgs = ['--port', String(RECEIVER_PORT), '--no-tray', '--friendly-name', 'OpenTubeX Test Receiver',
    '--cert', join(dir, 'device.pem'), '--key', join(dir, 'device.key')]
  // mpv opens a window for video.
  const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
  // CI uploads ANDROID_ARTIFACT_DIR with the test reports.
  const logFile = join(process.env.ANDROID_ARTIFACT_DIR || dir, 'openchromecast.log')
  const log = createWriteStream(logFile)
  const receiver = spawn(headless ? 'xvfb-run' : 'openchromecast', headless ? ['-a', 'openchromecast', ...receiverArgs] : receiverArgs,
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  receiver.stdout.pipe(log)
  receiver.stderr.pipe(log)
  let exited = false
  receiver.once('exit', () => { exited = true })
  const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' })
  try {
    for (const deadline = Date.now() + 30_000; !(await portOpen(RECEIVER_PORT));) {
      if (exited || Date.now() > deadline) throw new Error(`The receiver did not start, see ${logFile}`)
      await delay(200)
    }
    // The app connects to the receiver at its own loopback address.
    adb('reverse', `tcp:${RECEIVER_PORT}`, `tcp:${RECEIVER_PORT}`)
    try {
      const result = spawnSync(process.execPath, ['_scripts/androidScriptTests.mjs', 'cast-receiver'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          ANDROID_SERIAL: serial,
          OPENTUBEX_CAST_RECEIVER_FIXTURES: fixtures,
          OPENTUBEX_CAST_RECEIVER_PORT: String(RECEIVER_PORT)
        }
      })
      process.exitCode = result.status ?? 1
    } finally {
      spawnSync('adb', ['-s', serial, 'reverse', '--remove', `tcp:${RECEIVER_PORT}`])
    }
  } finally {
    // xvfb-run starts the receiver in its own process group, with mpv.
    if (!exited) process.kill(-receiver.pid, 'SIGTERM')
  }
}

if (command === 'prepare') prepare()
else await runTest()
