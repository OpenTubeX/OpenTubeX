import { inject } from 'vue'

import { showToast } from '../helpers/utils'
import { tabPresentedKey } from '../tabs/TabContext'

/**
 * Returns a {@link showToast} wrapper that swallows toasts fired from a
 * background (non-presented) tab. Background tabs stay mounted and keep loading,
 * so toasts triggered automatically (API errors, fallbacks, reloads) would
 * otherwise pop up in whatever tab happens to be on screen. Use it for those
 * automatic toasts; user-triggered toasts always run in the presented tab and
 * don't need it. Must be called from a component's `setup()` so it can read the
 * injected tab context.
 *
 * @returns {(message: Parameters<typeof showToast>[0], time?: number | null, action?: Function | null, abortSignal?: AbortSignal | null) => void}
 */
export function useTabToast() {
  const isTabPresented = inject(tabPresentedKey, null)

  return (message, time = null, action = null, abortSignal = null) => {
    // No provider (web build, single view) means there are no background tabs.
    if (process.env.IS_ELECTRON && isTabPresented != null && !isTabPresented.value) {
      return
    }

    showToast(message, time, action, abortSignal)
  }
}
