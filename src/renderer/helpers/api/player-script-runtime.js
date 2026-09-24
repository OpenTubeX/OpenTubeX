import variant from '@jitl/quickjs-wasmfile-release-sync'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'

let modulePromise
let stackSize = 128 * 1024
const minimumStackSize = 16 * 1024

/**
 * Interpret player code in a fresh WASM realm. No host objects or functions are
 * exposed, including worker globals, network access and Electron APIs.
 * @param {string} code
 * @param {{timeoutMs?: number, memoryLimitBytes?: number}} [limits]
 * @returns {Promise<unknown>}
 */
export async function evaluatePlayerCode(code, { timeoutMs = 5000, memoryLimitBytes = 64 * 1024 * 1024 } = {}) {
  let deadline
  while (true) {
    const pendingModule = modulePromise ??= newQuickJSWASMModuleFromVariant(variant).catch(error => {
      modulePromise = undefined
      throw error
    })
    const quickjs = await pendingModule
    // Another caller awaiting the same initialization may have trapped first.
    if (pendingModule !== modulePromise) continue
    deadline ??= Date.now() + timeoutMs
    if (Date.now() >= deadline) throw new Error('Player-script evaluation timed out')
    const runtime = quickjs.newRuntime()
    runtime.setMemoryLimit(memoryLimitBytes)
    runtime.setMaxStackSize(stackSize)
    runtime.setInterruptHandler(() => Date.now() >= deadline)
    let context
    let result
    let trapped = false
    try {
      context = runtime.newContext()
      // youtubei.js supplies a function body, including its final return statement.
      result = context.unwrapResult(context.evalCode(`(function () {\n${code}\n})()`))
      return context.dump(result)
    } catch (error) {
      const hostStackOverflow = error instanceof RangeError && /Maximum call stack size exceeded/i.test(error.message)
      if (hostStackOverflow || error instanceof WebAssembly.RuntimeError) {
        // A host trap bypasses QuickJS's exception unwinding. Calling its cleanup
        // afterward asserts in JS_FreeRuntime and hides the original error.
        // Abandon this WASM instance entirely; host GC owns its linear memory.
        trapped = true
        modulePromise = undefined
        if (hostStackOverflow && stackSize > minimumStackSize) {
          // Guest bytes do not map to a fixed amount of host stack across CPUs,
          // WebViews and WASM compilation tiers. Adapt to this worker's host.
          // Replaying is safe: the guest cannot perform external side effects.
          stackSize /= 2
          continue
        }
      }
      throw error
    } finally {
      if (!trapped) {
        // QuickJS may need to allocate while releasing objects after an OOM.
        runtime.setMemoryLimit(-1)
        result?.dispose()
        context?.dispose()
        runtime.dispose()
      }
    }
  }
}
