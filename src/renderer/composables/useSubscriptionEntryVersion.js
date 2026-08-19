import { readonly, ref } from 'vue'

import store from '../store/index'

const version = ref(0)

store.subscribe((mutation) => {
  if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
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
