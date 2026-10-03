import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../_scripts/android/test-navigation-responsiveness.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')

for (const closeFails of [false, true]) {
  test(`Android navigation check releases its port after restoration fails and browser close ${closeFails ? 'fails' : 'succeeds'}`, async () => {
    const calls = []
    const diagnostics = []
    const startupDelays = []
    let pidLookups = 0
    const restoreError = new Error('WebView disconnected')
    const closeError = new Error('Browser already closed')
    let evaluations = 0
    const page = {
      locator: () => ({ isVisible: async () => false }),
      evaluate: async () => {
        calls.push(++evaluations === 1 ? 'setup' : 'restore')
        throw restoreError
      }
    }
    const browser = {
      contexts: () => [{ pages: () => [page] }],
      close: async () => {
        calls.push('browser-close')
        if (closeFails) throw closeError
      }
    }
    const result = vm.runInNewContext(`(async () => {\n${source}\n})()`, {
      assert,
      console: { error: (...args) => diagnostics.push(args) },
      delay: async milliseconds => { startupDelays.push(milliseconds) },
      process: { argv: ['node', 'script', 'emulator-test'] },
      execFileSync: (command, args) => {
        assert.equal(command, 'adb')
        assert.deepEqual(Array.from(args.slice(0, 2)), ['-s', 'emulator-test'])
        if (args.includes('pidof')) {
          if (++pidLookups === 1) throw new Error('Process is still starting')
          return pidLookups === 2 ? '' : '123'
        }
        if (args.includes('tcp:0')) return '4567'
        if (args.includes('--remove')) {
          assert.equal(args.at(-1), 'tcp:4567')
          calls.push('adb-remove')
        }
        return ''
      },
      chromium: { connectOverCDP: async () => browser },
      expect: () => ({ toBeVisible: async () => {} }),
      largeSubscriptionsSeed: { settings: {}, profiles: [], subscriptionCache: [] }
    })
    await assert.rejects(result, closeFails ? closeError : restoreError)
    assert.deepEqual(calls, ['setup', 'restore', 'browser-close', 'adb-remove'])
    assert.equal(pidLookups, 3)
    assert.deepEqual(startupDelays, [100, 100])
    assert.deepEqual(diagnostics, [['Failed to restore Android navigation check state:', restoreError]])
  })
}

test('Android navigation check bounds PID retries and never forwards a missing process', async () => {
  let pidLookups = 0
  const result = vm.runInNewContext(`(async () => {\n${source}\n})()`, {
    assert,
    process: { argv: ['node', 'script', 'emulator-test'] },
    delay: async () => {},
    execFileSync: (command, args) => {
      assert.equal(command, 'adb')
      assert.ok(args.includes('start') || args.includes('pidof'), 'must not forward before a PID exists')
      if (args.includes('pidof')) {
        pidLookups++
        throw new Error('Process is unavailable')
      }
      return ''
    }
  })
  await assert.rejects(result, { message: 'Android app process is available' })
  assert.equal(pidLookups, 50)
})
