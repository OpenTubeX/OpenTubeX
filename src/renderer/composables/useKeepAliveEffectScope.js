import { getCurrentScope, onActivated, onDeactivated } from 'vue'

/**
 * KeepAlive preserves component state, but Vue continues running the retained
 * component's reactive effects while its DOM is detached. Pause those effects
 * until the component is visible again.
 */
export function useKeepAliveEffectScope() {
  const scope = getCurrentScope()

  onActivated(() => scope?.resume())
  onDeactivated(() => scope?.pause())
}
