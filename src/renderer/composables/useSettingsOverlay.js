import { inject, ref, watch } from 'vue'

import { settingsSubpageKey } from '../components/FtSettingsSubpage/settingsSubpage'

/**
 * Dismiss settings-owned overlays when their window closes or locks.
 * @param {() => void} dismiss
 */
export function useSettingsOverlay(dismiss) {
  const settingsWindow = inject(settingsSubpageKey, null)
  const active = settingsWindow?.isActive ?? ref(true)
  watch(active, value => {
    if (!value) dismiss()
  }, { flush: 'sync' })
  return active
}
