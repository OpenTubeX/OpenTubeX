import { computed, ref, watch } from 'vue'

import store from '../store/index'

/**
 * Automatic loading requests the next page when the end of a list comes into
 * view. A page too short to move it out of view, or one whose items were all
 * left out, leaves it in view, so a key for the next page wrapper changes with
 * each new continuation to check again. An unchanged continuation keeps the
 * key, so a source repeating it doesn't load the same page in a loop.
 * @param {() => string | null} continuation
 * @returns {import('vue').ComputedRef<number>} 0 while automatic loading is off,
 * so the wrapper's button keeps focus
 */
export function useAutoLoadRevision(continuation) {
  const revision = ref(0)
  watch(continuation, () => { revision.value++ })
  return computed(() => store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled ? revision.value : 0)
}
