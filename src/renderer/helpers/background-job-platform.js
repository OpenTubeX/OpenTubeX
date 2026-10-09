import { BackgroundJobClient } from './background-job-client.js'

const jobs = new BackgroundJobClient(() => new Worker(
  new URL('./background-job-worker.js', import.meta.url),
  { name: 'sync-processing' }
))

export function runWorkerJob(operation, input) {
  return jobs.run(operation, input)
}
