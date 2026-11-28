import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createInvidiousHttpError,
  formatApiFetchError,
  isFetchTypeError,
} from '../../src/renderer/helpers/api/invidiousErrors.js'
import { classifyRequestFailure } from '../../src/renderer/helpers/api/requestDiagnostics.js'
import {
  isRecoverableNetworkError,
  markNonNetworkError,
} from '../../src/renderer/helpers/networkRecovery.js'

const t = (key, params = {}) => `${key}:${JSON.stringify(params)}`

test('detects browser fetch TypeErrors across engines without matching unrelated errors', () => {
  assert.equal(isFetchTypeError(new TypeError('Failed to fetch')), true)
  assert.equal(isFetchTypeError(new TypeError('NetworkError when attempting to fetch resource.')), true)
  assert.equal(isFetchTypeError(new TypeError('Load failed')), true)

  assert.equal(isFetchTypeError(new TypeError('Cannot read properties of undefined')), false)
  assert.equal(isFetchTypeError(new DOMException('The operation was aborted.', 'AbortError')), false)
  assert.equal(isFetchTypeError(Object.assign(new Error('Permission denied'), { code: 'LOCAL_ACCESS_DENIED' })), false)
  assert.equal(isFetchTypeError(new Error('Video unavailable')), false)
})

test('formats unreachable Invidious and Yattee fetch errors with platform-specific guidance', () => {
  const fetchError = new TypeError('Failed to fetch')

  const webInvidious = formatApiFetchError(fetchError, {
    instanceUrl: 'https://invidious.example',
    isYattee: false,
    isWeb: true,
    t,
  })
  assert.equal(webInvidious instanceof Error, true)
  assert.equal(webInvidious.cause, fetchError)
  assert.equal(webInvidious.message, 'Invidious.Errors.Unreachable Web:{"instance":"https://invidious.example"}')

  const desktopInvidious = formatApiFetchError(fetchError, {
    instanceUrl: 'https://invidious.example',
    isYattee: false,
    isWeb: false,
    t,
  })
  assert.equal(desktopInvidious.message, 'Invidious.Errors.Unreachable:{"instance":"https://invidious.example"}')

  const yattee = formatApiFetchError(fetchError, {
    instanceUrl: 'https://yattee.example',
    isYattee: true,
    isWeb: true,
    t,
  })
  assert.equal(yattee.message, 'Yattee Server.Errors.Unreachable:{"instance":"https://yattee.example"}')

  const abortError = new DOMException('The operation was aborted.', 'AbortError')
  assert.equal(formatApiFetchError(abortError, { instanceUrl: 'https://invidious.example', isYattee: false, isWeb: true, t }), abortError)
})

test('builds HTTP errors for non-JSON Invidious error pages with status classification', () => {
  const error = createInvidiousHttpError(502, { instanceUrl: 'https://invidious.example', t })
  assert.equal(error.status, 502)
  assert.equal(error.message, 'Invidious.Errors.Server error:{"instance":"https://invidious.example","status":502}')
  assert.equal(classifyRequestFailure(error), 'http')
})

test('preserves recoverable vs non-network status across wrapped fetch errors', () => {
  const recoverable = new TypeError('Failed to fetch')
  const wrappedRecoverable = new Error('Die Instanz ist nicht erreichbar.', { cause: recoverable })
  assert.equal(isRecoverableNetworkError(wrappedRecoverable), true)

  const blocked = new TypeError('Failed to fetch')
  markNonNetworkError(blocked)
  const wrappedBlocked = new Error('Could not reach the instance. Check your connection.', { cause: blocked })
  markNonNetworkError(wrappedBlocked)
  assert.equal(isRecoverableNetworkError(wrappedBlocked), false)
})
