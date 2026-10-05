import { onBeforeUnmount, provide, shallowRef } from 'vue'

export const tabTooltipKey = Symbol('tabTooltip')

export function provideTabTooltip() {
  const active = shallowRef(null)
  let pending = null
  let showTimer = null
  let hideTimer = null

  function clearTimers() {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    pending = null
  }

  function dismiss() {
    clearTimers()
    active.value = null
  }

  function show(tooltip) {
    clearTimers()
    if (active.value) {
      active.value = { ...tooltip, captureLive: false }
    } else {
      pending = tooltip
      showTimer = setTimeout(() => {
        active.value = { ...tooltip, captureLive: true }
        pending = null
      }, 80)
    }
  }

  function hide(id) {
    if (active.value?.id === id || pending?.id === id) dismiss()
  }

  function leave(id) {
    if (pending?.id === id) clearTimers()
    if (active.value?.id !== id) return
    // Bridge the small gaps between tabs without replaying the entry fade.
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => hide(id), 120)
  }

  provide(tabTooltipKey, { active, show, hide, leave, dismiss })
  onBeforeUnmount(dismiss)
}
