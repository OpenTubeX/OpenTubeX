import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundExternalLinkOpener, releaseForegroundLock } from '../../src/main/backgroundExternalLink.js'

function fixture(platform) {
  const calls = []
  const open = createBackgroundExternalLinkOpener({
    platform,
    openExternal: async (url, options) => { calls.push(['open', url, options]) },
    loadWindowsNative: () => ({ lockForeground: locked => calls.push(['lock', locked]) })
  })
  return { open, calls }
}

for (const platform of ['darwin', 'linux']) {
  test(`${platform} opens the link without activating the browser and without a foreground lock`, async () => {
    const f = fixture(platform)
    await f.open('https://example.org/')
    assert.deepEqual(f.calls, [['open', 'https://example.org/', { activate: false }]])
  })
}

test('Windows locks the foreground before launching the browser and releases it later', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture('win32')

  await f.open('https://example.org/one')
  t.mock.timers.tick(3000)
  await f.open('https://example.org/two')
  t.mock.timers.tick(4999)
  assert.deepEqual(f.calls, [
    ['lock', true],
    ['open', 'https://example.org/one', { activate: false }],
    ['lock', true],
    ['open', 'https://example.org/two', { activate: false }]
  ])

  // A second link extends the lock instead of releasing it early.
  t.mock.timers.tick(1)
  assert.deepEqual(f.calls.at(-1), ['lock', false])
  assert.equal(f.calls.filter(([type, locked]) => type === 'lock' && locked === false).length, 1)
})

test('a normally opened link releases the foreground lock right away', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture('win32')

  await f.open('https://example.org/background')
  releaseForegroundLock()
  assert.deepEqual(f.calls.at(-1), ['lock', false])

  // The pending timer no longer unlocks, and releasing again is a no-op.
  t.mock.timers.tick(5000)
  releaseForegroundLock()
  assert.equal(f.calls.filter(([type, locked]) => type === 'lock' && locked === false).length, 1)
})

test('releasing without a lock does nothing', () => {
  const f = fixture('win32')
  releaseForegroundLock()
  assert.deepEqual(f.calls, [])
})

test('Windows still opens the link when the native module is unavailable', async t => {
  t.mock.method(console, 'error', () => {})
  const calls = []
  const open = createBackgroundExternalLinkOpener({
    platform: 'win32',
    openExternal: async (url, options) => { calls.push([url, options]) },
    loadWindowsNative: () => { throw new Error('Cannot find module') }
  })

  await open('https://example.org/')

  assert.deepEqual(calls, [['https://example.org/', { activate: false }]])
  assert.equal(console.error.mock.callCount(), 1)
})
