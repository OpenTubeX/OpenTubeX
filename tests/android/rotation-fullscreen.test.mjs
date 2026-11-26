import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { androidAppId } from '../helpers/android-webview.mjs'

const run = promisify(execFile)
const serial = process.env.ANDROID_SERIAL

// Drives RotationFullscreenTest's physical rotation test, whose device turns
// only through the emulator's accelerometer from the host. The instrumentation
// shards run the class's other tests. Install current debug and androidTest
// APKs on an emulator and set ANDROID_SERIAL to it; the script runner does both.
for (const swipeExit of [false, true]) {
  test(swipeExit ? 'A swipe exits Android rotation fullscreen while the device remains sideways' : 'Android fullscreen follows physical rotation with the opt-in', {
    skip: !serial?.startsWith('emulator-'),
    timeout: 180000,
  }, async () => {
    const adb = async (...args) => (await run('adb', ['-s', serial, ...args], {
      timeout: 150000, maxBuffer: 4 * 1024 * 1024,
    })).stdout
    const testPackage = `${androidAppId()}.test`
    assert.match(await adb('shell', 'pm', 'list', 'instrumentation'), new RegExp(`instrumentation:${testPackage.replaceAll('.', '\\.')}/`),
      'Install the androidTest APK too')
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
        '-e', 'class', 'org.opentubex.app.RotationFullscreenTest#physicalRotationCanOverrideTheSystemLockWhenEnabled',
        '-e', 'physicalRotationTest', 'true',
        '-e', 'swipeExit', String(swipeExit),
        `${testPackage}/androidx.test.runner.AndroidJUnitRunner`)
      assert.match(result, /OK \(1 test\)/, result)
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
}
