import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const watchSource = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = watchSource.indexOf('    handlePlayerError: async function (error) {')
const end = watchSource.indexOf('\n    /**', start)
const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

for (const message of ['Failed to fetch', 'Load failed', 'The Internet connection appears to be offline.', undefined]) {
  test(`offline HTTP failure preserves the stream for ${message ?? 'an absent message'}`, async () => {
    const handle = vm.runInNewContext(`({${watchSource.slice(start, end)}}).handlePlayerError`, {
      navigator: { onLine: false }, shaka: { util: { Error: { Code: { HTTP_ERROR: 1002 } } } }
    })
    let retries = 0
    const view = {
      isLoading: false,
      isAndroidTransientHttpRecoveryEnabled: () => true,
      retryAndroidTransientHttpError: async () => { retries++; return true }
    }
    const error = { code: 1002, data: ['https://example.invalid/segment', { message }] }
    await handle.call(view, error)
    await handle.call(view, error)
    assert.equal(retries, 0, 'offline errors must not spend the transient retry or reach format fallback')
  })
}

test('online HTTP failures still use the bounded transient recovery', async () => {
  const handle = vm.runInNewContext(`({${watchSource.slice(start, end)}}).handlePlayerError`, {
    navigator: { onLine: true }, shaka: { util: { Error: { Code: { HTTP_ERROR: 1002 } } } }
  })
  let retries = 0
  await handle.call({
    isLoading: false,
    isAndroidTransientHttpRecoveryEnabled: () => true,
    retryAndroidTransientHttpError: async () => { retries++; return true }
  }, { code: 1002, data: ['https://example.invalid/segment', { message: 'Load failed' }] })
  assert.equal(retries, 1)
})

test('offline errors do not suppress later failures from the retained player', () => {
  const start = playerSource.indexOf('    function handleError(error, context, details) {')
  const source = playerSource.slice(start, playerSource.indexOf('    // #region seek bar markers', start))
  const Code = { HTTP_ERROR: 1002, BAD_HTTP_STATUS: 1001 }
  const Category = { NETWORK: 1, TEXT: 2 }
  const emitted = []
  const context = {
    navigator: { onLine: false },
    ignoreErrors: false,
    shortsNavigationSuspended: { value: false },
    ErrorCode: Code,
    ErrorCategory: Category,
    ErrorSeverity: { RECOVERABLE: 1 },
    shaka: { util: { Error: { Code, Category } } },
    logShakaError () {},
    props: { videoId: 'test' },
    emit: (...args) => emitted.push(args),
    tabMediaCoordinator: { setPlaybackState () {} },
    mediaTabId: 'test',
    process: { env: {} }
  }
  const handle = vm.runInNewContext(`${source}\nhandleError`, context)
  const error = { code: 1002, severity: 2, category: 1, data: ['https://example.invalid/segment', new TypeError('Load failed')] }
  handle(error, 'shaka error handler')
  assert.equal(emitted.length, 0, 'offline failure must not trigger watch-page fallback')
  assert.equal(context.ignoreErrors, false)
  context.navigator.onLine = true
  handle(error, 'shaka error handler')
  assert.equal(emitted.length, 1, 'later online failures must remain actionable')
  assert.equal(context.ignoreErrors, true)
})
