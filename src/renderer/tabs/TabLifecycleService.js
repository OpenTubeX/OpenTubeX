const hooksByTabId = new Map()

function getHooks(tabId) {
  let hooks = hooksByTabId.get(tabId)
  if (!hooks) {
    hooks = new Set()
    hooksByTabId.set(tabId, hooks)
  }
  return hooks
}

/**
 * Explicit lifecycle hooks for logical tab content. These replace RouterView-only
 * leave hooks for content that remains mounted while its tab is hidden.
 */
export const tabLifecycleService = {
  register(tabId, hooks) {
    const tabHooks = getHooks(tabId)
    tabHooks.add(hooks)

    return () => {
      tabHooks.delete(hooks)
      if (tabHooks.size === 0) {
        hooksByTabId.delete(tabId)
      }
    }
  },

  async run(tabId, hookName, context = {}) {
    const tabHooks = hooksByTabId.get(tabId)
    if (!tabHooks) {
      return
    }

    for (const hooks of [...tabHooks]) {
      const hook = hooks[hookName]
      if (typeof hook === 'function') {
        // Isolate each hook: a rejection must not prevent the remaining hooks
        // (e.g. player teardown, progress persistence) from running.
        try {
          await hook(context)
        } catch (error) {
          console.error(`Tab lifecycle hook "${hookName}" failed for tab ${tabId}:`, error)
        }
      }
    }
  },

  clear(tabId) {
    hooksByTabId.delete(tabId)
  }
}

export default tabLifecycleService
