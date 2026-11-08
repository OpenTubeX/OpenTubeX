const runtimes = new Map()

function getOrCreateRuntime(tabId) {
  let runtime = runtimes.get(tabId)
  if (runtime) {
    return runtime
  }

  runtime = {
    root: null,
    mountedRevision: 0,
    mountSucceeded: false,
    mountWaiters: new Set()
  }
  runtimes.set(tabId, runtime)
  return runtime
}

/**
 * Registry for non-serializable logical-tab renderer state.
 */
export const tabRuntimeRegistry = {
  registerRoot(tabId, root) {
    const runtime = getOrCreateRuntime(tabId)
    runtime.root = root

    return () => {
      if (runtime.root === root) {
        runtime.root = null
      }
    }
  },

  getRoot(tabId) {
    return runtimes.get(tabId)?.root ?? null
  },

  markMounted(tabId, mountRevision) {
    const runtime = getOrCreateRuntime(tabId)
    if (mountRevision >= runtime.mountedRevision) {
      runtime.mountedRevision = mountRevision
      runtime.mountSucceeded = true
    }

    for (const waiter of runtime.mountWaiters) {
      if (waiter.mountRevision <= runtime.mountedRevision) {
        runtime.mountWaiters.delete(waiter)
        waiter.resolve(runtime.mountSucceeded)
      }
    }
  },

  markMountFailed(tabId, mountRevision) {
    const runtime = getOrCreateRuntime(tabId)
    if (mountRevision >= runtime.mountedRevision) {
      runtime.mountedRevision = mountRevision
      runtime.mountSucceeded = false
    }

    for (const waiter of runtime.mountWaiters) {
      if (waiter.mountRevision <= runtime.mountedRevision) {
        runtime.mountWaiters.delete(waiter)
        waiter.resolve(false)
      }
    }
  },

  waitForMount(tabId, mountRevision) {
    const runtime = getOrCreateRuntime(tabId)
    if (runtime.mountedRevision >= mountRevision) {
      return Promise.resolve(runtime.mountSucceeded)
    }

    return new Promise(resolve => {
      runtime.mountWaiters.add({ mountRevision, resolve })
    })
  },

  dispose(tabId) {
    const runtime = runtimes.get(tabId)
    if (!runtime) {
      return
    }

    for (const waiter of runtime.mountWaiters) {
      waiter.resolve(false)
    }
    runtime.mountWaiters.clear()
    runtimes.delete(tabId)
  }
}

export default tabRuntimeRegistry
