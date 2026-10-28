// @ts-check
import { getApiOrder } from '../../../apiBackends'
import { showInvidiousFallbackToast } from '../utils'

/**
 * Requests data from the preferred API and, if the user allows it, retries a
 * failed request once on the other one. Before falling back from an
 * Invidious instance or Yattee server to the local API, which contacts
 * YouTube directly, it warns on all tabs.
 * @template T
 * @param {Record<import('../../../apiBackends').Api, () => Promise<T>>} requests
 * @param {object} options
 * @param {string} options.backend the backendPreference setting
 * @param {boolean} options.fallback the backendFallback setting
 * @param {AbortSignal} [options.signal] a cancelled request does not fall back
 * @param {(error: unknown) => boolean} [options.canFallBack] false for errors the other API would repeat
 * @returns {Promise<{ api: import('../../../apiBackends').Api, result: T }>}
 */
export async function requestWithFallback(requests, { backend, fallback, signal, canFallBack = () => true }) {
  const [preferred, alternative] = getApiOrder(backend, fallback, !!process.env.SUPPORTS_LOCAL_API)
  try {
    return { api: preferred, result: await requests[preferred]() }
  } catch (error) {
    if (!alternative || signal?.aborted || !canFallBack(error)) throw error
    if (alternative === 'local') showInvidiousFallbackToast(backend)
    return { api: alternative, result: await requests[alternative]() }
  }
}
