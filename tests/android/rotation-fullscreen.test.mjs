import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const swipeExit = process.env.ANDROID_ROTATION_SWIPE_EXIT === '1'

// Install current debug and androidTest APKs and hold the emulator's lab lock.
// Run with ANDROID_ROTATION_SERIAL=emulator-<port> node --test <this file>.
// Add ANDROID_ROTATION_SWIPE_EXIT=1 to test exiting with a swipe while still sideways.
test(swipeExit ? 'A swipe exits Android rotation fullscreen while the device remains sideways' : 'Android fullscreen follows display rotation by default and physical rotation with the opt-in', {
  skip: !process.env.ANDROID_ROTATION_SERIAL,
  timeout: 180000,
}, async () => {
  const serial = process.env.ANDROID_ROTATION_SERIAL
  assert.match(serial, /^emulator-\d+$/)
  const adb = async (...args) => (await run('adb', ['-s', serial, ...args], {
    timeout: 150000, maxBuffer: 4 * 1024 * 1024,
  })).stdout
  const acceleration = (await adb('emu', 'sensor', 'get', 'acceleration')).match(/acceleration = ([^\r\n]+)/)?.[1]
  assert.ok(acceleration)
  const immersiveConfirmation = (await adb('shell', 'settings', 'get', 'secure', 'immersive_mode_confirmations')).trim()
  let logcat
  let rotateSideways
  let rotateBack
  try {
    // Android's first-use fullscreen tutorial otherwise consumes the test swipe.
    await adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed')
    await adb('emu', 'sensor', 'set', 'acceleration', '0:9.8:0')
    await adb('logcat', '-c')
    logcat = spawn('adb', ['-s', serial, 'logcat', '-v', 'brief', 'OpenTubeXRotationTest:I', '*:S'])
    let logs = ''
    logcat.stdout.on('data', chunk => {
      logs += chunk.toString()
      if (!rotateSideways && logs.includes('physical-inline')) {
        rotateSideways = adb('emu', 'sensor', 'set', 'acceleration', '9.8:0:0')
          .then(() => adb('shell', 'log', '-t', 'OpenTubeXRotationTest', 'physical-landscape-ready'))
      }
      if (!rotateBack && logs.includes('physical-fullscreen')) {
        rotateBack = adb('emu', 'sensor', 'set', 'acceleration', '0:9.8:0')
      }
    })
    const result = await adb('shell', 'am', 'instrument', '-w',
      '-e', 'class', 'org.opentubex.app.RotationFullscreenTest' + (swipeExit ? '#physicalRotationCanOverrideTheSystemLockWhenEnabled' : ''),
      '-e', 'physicalRotationTest', 'true',
      '-e', 'swipeExit', String(swipeExit),
      'org.opentubex.app.dev.test/androidx.test.runner.AndroidJUnitRunner')
    assert.match(result, swipeExit ? /OK \(1 test\)/ : /OK \(7 tests\)/, result)
    assert.ok(rotateSideways, 'The device must turn sideways with the override disabled first')
    if (!swipeExit) assert.ok(rotateBack, 'The physical sensor must trigger fullscreen before rotating back')
    await rotateBack
  } finally {
    logcat?.kill()
    await rotateSideways
    await rotateBack
    await adb('emu', 'sensor', 'set', 'acceleration', acceleration)
    if (immersiveConfirmation === 'null') {
      await adb('shell', 'settings', 'delete', 'secure', 'immersive_mode_confirmations')
    } else {
      await adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', immersiveConfirmation || "''")
    }
  }
})
