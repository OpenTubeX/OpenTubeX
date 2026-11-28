// @ts-check
import { classifyRequestFailure } from './requestDiagnostics.js'

/**
 * Returns true when `fetch` rejected with a browser transport/CORS TypeError
 * (such as "Failed to fetch", "NetworkError when attempting to fetch resource.",
 * or "Load failed").
 * @param {unknown} error
 */
export function isFetchTypeError(error) {
  return error != null &&
    typeof error === 'object' &&
  /** @type {{ name?: unknown }} */ (error).name === 'TypeError' &&
    classifyRequestFailure(error) === 'network'
}

/**
 * Formats an unreachable Invidious or Yattee API fetch failure into a readable
 * error message while preserving the original error as `cause`.
 * @param {unknown} error
 * @param {object} options
 * @param {string} options.instanceUrl
 * @param {boolean} options.isYattee
 * @param {boolean} options.isWeb
 * @param {(key: string, params?: Record<string, unknown>) => string} options.t
 * @returns {unknown}
 */
export function formatApiFetchError(error, { instanceUrl, isYattee, isWeb, t }) {
  if (!isFetchTypeError(error)) return error

  const message = isYattee
    ? t('Yattee Server.Errors.Unreachable', { instance: instanceUrl })
    : isWeb
      ? t('Invidious.Errors.Unreachable Web', { instance: instanceUrl })
      : t('Invidious.Errors.Unreachable', { instance: instanceUrl })

  return new Error(message, { cause: error })
}

/**
 * Builds an error for a non-OK Invidious response that did not return a JSON
 * error payload (for example an HTML 403/502/503 page from a reverse proxy).
 * @param {number} status
 * @param {object} options
 * @param {string} options.instanceUrl
 * @param {(key: string, params?: Record<string, unknown>) => string} options.t
 */
export function createInvidiousHttpError(status, { instanceUrl, t }) {
  return Object.assign(
    new Error(t('Invidious.Errors.Server error', { instance: instanceUrl, status })),
    { status }
  )
}
