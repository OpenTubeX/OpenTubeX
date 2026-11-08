import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../_scripts/android/test-startup-background.mjs', import.meta.url), 'utf8')

test('startup regression disconnects even when restoring renderer settings fails', async () => {
  const marker = '\n} finally {'
  const cleanup = source.slice(source.lastIndexOf(marker) + marker.length, source.lastIndexOf('\n}'))
  const calls = []
  const error = new Error('Renderer unavailable')
  const run = vm.runInNewContext(`(async () => { ${cleanup} })`, {
    originalNight: 'no',
    originalSettings: { BaseTheme: 'system' },
    adb: (...args) => calls.push(args),
    connect: async () => { throw error },
    settings: async () => assert.fail('No renderer is available'),
    disconnect: async () => calls.push(['disconnect'])
  })
  await assert.rejects(run(), error)
  assert.deepEqual(calls, [['shell', 'cmd', 'uimode', 'night', 'no'], ['disconnect']])
})

test('startup regression removes its ADB forward even when closing CDP fails', async () => {
  const disconnect = source.slice(source.indexOf('async function disconnect()'), source.indexOf('async function connect()'))
  const calls = []
  const error = new Error('Browser disconnected')
  const run = vm.runInNewContext(`${disconnect}\ndisconnect`, {
    browser: { close: async () => { throw error } },
    port: '12345',
    adb: (...args) => calls.push(args)
  })
  await assert.rejects(run(), error)
  assert.deepEqual(calls, [['forward', '--remove', 'tcp:12345']])
})
