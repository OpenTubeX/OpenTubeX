import { onBeforeUnmount, ref } from 'vue'

// Use compact controls when either dimension leaves little room for popups.
export const PHONE_LAYOUT_QUERY = '(max-width: 600px), (max-height: 600px)'

/**
 * Every list card and icon button asks for the same few queries, so each query
 * string shares one MediaQueryList, one ref and one change listener.
 * @type {Map<string, { query: MediaQueryList, matches: import('vue').Ref<boolean>, update: () => void, consumers: number }>}
 */
const sharedQueries = new Map()

/**
 * @param {string} mediaQuery
 * @returns {import('vue').Ref<boolean>}
 */
export function usePhoneLayout(mediaQuery = PHONE_LAYOUT_QUERY) {
  let shared = sharedQueries.get(mediaQuery)

  if (!shared) {
    const query = window.matchMedia(mediaQuery)
    const matches = ref(query.matches)
    shared = { query, matches, update: () => { matches.value = query.matches }, consumers: 0 }
    sharedQueries.set(mediaQuery, shared)
  }

  if (shared.consumers++ === 0) {
    // Nothing listened while no consumer was mounted, so refresh a stale value.
    shared.update()
    shared.query.addEventListener('change', shared.update)
  }

  onBeforeUnmount(() => {
    if (--shared.consumers === 0) {
      shared.query.removeEventListener('change', shared.update)
    }
  })

  return shared.matches
}
