import { readonly, ref } from 'vue'

import store from '../store/index'

const version = ref(0)
const seenMutationTypes = new Set([
  'markSubscriptionEntriesAsSeenInCache',
  'markSubscriptionPostAsSeenByChannel',
  'markSubscriptionVideoAsSeenByChannel'
])

store.subscribe((mutation) => {
  if (seenMutationTypes.has(mutation.type)) {
    version.value++
  }
})

/**
 * Returns one shared cache-mutation signal for every subscription panel.
 * Paused KeepAlive scopes consume the latest version when reactivated.
 */
export function useSubscriptionEntryVersion() {
  return readonly(version)
}
