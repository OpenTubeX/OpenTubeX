import variant from '@jitl/quickjs-wasmfile-release-sync'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'

let modulePromise

/**
 * Interpret player code in a fresh WASM realm. No host objects or functions are
 * exposed, including worker globals, network access and Electron APIs.
 * @param {string} code
 * @param {{timeoutMs?: number, memoryLimitBytes?: number}} [limits]
 * @returns {Promise<unknown>}
 */
export async function evaluatePlayerCode(code, { timeoutMs = 5000, memoryLimitBytes = 64 * 1024 * 1024 } = {}) {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant).catch(error => {
    modulePromise = undefined
    throw error
  })
  const quickjs = await modulePromise
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(memoryLimitBytes)
  // QuickJS must catch stack exhaustion before the host's WASM call stack
  // overflows, which bypasses its cleanup and aborts JS_FreeRuntime.
  runtime.setMaxStackSize(128 * 1024)
  const deadline = Date.now() + timeoutMs
  runtime.setInterruptHandler(() => Date.now() >= deadline)
  let context
  try {
    context = runtime.newContext()
    // youtubei.js supplies a function body, including its final return statement.
    const result = context.unwrapResult(context.evalCode(`(function () {\n${code}\n})()`))
    try {
      return context.dump(result)
    } finally {
      result.dispose()
    }
  } finally {
    // QuickJS may need to allocate while releasing objects after an OOM.
    runtime.setMemoryLimit(-1)
    context?.dispose()
    runtime.dispose()
  }
}
