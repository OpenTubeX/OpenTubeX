/**
 * Invidious and Yattee servers share the Invidious-compatible API.
 * @param {string} backend
 * @returns {boolean}
 */
export function usesInvidiousApi(backend) {
  return backend === 'invidious' || backend === 'yattee'
}

/**
 * Whether an Invidious instance serves requests as the preferred or fallback backend.
 * @param {string} backend
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function usesInvidiousInstance(backend, fallback) {
  return backend === 'invidious' || (fallback && backend === 'local')
}
