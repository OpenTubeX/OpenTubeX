import { onBeforeUnmount, provide, shallowRef } from 'vue'

export const tabTooltipKey = Symbol('tabTooltip')

export function provideTabTooltip() {
  const active = shallowRef(null)
  let pending = null
  let showTimer = null
  let hideTimer = null
  let capturePromise = Promise.resolve()

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
      active.value = tooltip
    } else {
      pending = tooltip
      showTimer = setTimeout(async () => {
        // Finish any capture from an earlier anchor before showing its successor.
        // Live captures hide overlays, so prepare previews before mounting one.
        capturePromise = capturePromise.then(async () => {
          if (pending !== tooltip || !tooltip.props.showPreview) return
          const tabs = tooltip.props.isGroup ? tooltip.props.tabs.slice(0, 6) : tooltip.props.tabs.slice(0, 1)
          await Promise.all(tabs.map(tab => window.ftElectron.tabs.capturePreview(tab.id)))
        }).catch(() => {})
        await capturePromise
        if (pending !== tooltip) return
        active.value = tooltip
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
