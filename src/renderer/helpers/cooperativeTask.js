/** Run CPU work in small batches, allowing input and rendering between them. */
export async function runCooperatively(steps, isCancelled = () => false) {
  let batchStarted = performance.now()
  while (!isCancelled()) {
    const step = steps.next()
    if (step.done) return step.value
    if (performance.now() - batchStarted >= 8) {
      await new Promise(resolve => setTimeout(resolve, 0))
      batchStarted = performance.now()
    }
  }
  return null
}

/** Use the same algorithm for synchronous callers and unit tests. */
export function runSynchronously(steps) {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}
