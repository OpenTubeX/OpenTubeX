import { executeBackgroundJob } from './background-job-operations.js'

/** Desktop sync processing stays off the renderer, including collection transfer. */
export async function runBackgroundJob(operation, input) {
  if (!process.env.IS_ELECTRON) return executeBackgroundJob(operation, input)
  const { runWorkerJob } = await import('./background-job-platform.js')
  return runWorkerJob(operation, input)
}
