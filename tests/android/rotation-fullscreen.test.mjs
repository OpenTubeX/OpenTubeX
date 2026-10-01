import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)

// Install current debug and androidTest APKs and hold the emulator's lab lock.
// Run with ANDROID_ROTATION_SERIAL=emulator-<port> node --test <this file>.
test('Android fullscreen follows display rotation by default and physical rotation with the opt-in', {
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
  let logcat
  let rotateBack
  try {
    await adb('emu', 'sensor', 'set', 'acceleration', '9.8:0:0')
    await adb('logcat', '-c')
    logcat = spawn('adb', ['-s', serial, 'logcat', '-v', 'brief', 'OpenTubeXRotationTest:I', '*:S'])
    let logs = ''
    logcat.stdout.on('data', chunk => {
      logs += chunk.toString()
      if (!rotateBack && logs.includes('physical-fullscreen')) {
        rotateBack = adb('emu', 'sensor', 'set', 'acceleration', '0:9.8:0')
      }
    })
    const result = await adb('shell', 'am', 'instrument', '-w',
      '-e', 'class', 'org.opentubex.app.RotationFullscreenTest',
      '-e', 'physicalRotationTest', 'true',
      'org.opentubex.app.dev.test/androidx.test.runner.AndroidJUnitRunner')
    assert.match(result, /OK \(2 tests\)/, result)
    assert.ok(rotateBack, 'The physical sensor must trigger fullscreen before rotating back')
    await rotateBack
  } finally {
    logcat?.kill()
    await rotateBack
    await adb('emu', 'sensor', 'set', 'acceleration', acceleration)
  }
})
