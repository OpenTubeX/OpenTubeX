import { executeBackgroundJob } from './background-job-operations.js'

/** App sync processing stays off the UI thread, including collection transfer. */
export async function runBackgroundJob(operation, input) {
  if (!process.env.IS_ELECTRON && !process.env.IS_CAPACITOR) return executeBackgroundJob(operation, input)
  const { runWorkerJob } = await import('./background-job-platform.js')
  return runWorkerJob(operation, input)
}
