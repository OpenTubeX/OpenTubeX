import { BackgroundJobClient } from './background-job-client.js'

const createWorker = () => new Worker(
  new URL('./background-job-worker.js', import.meta.url),
  { name: 'sync-processing' }
)
const jobs = new BackgroundJobClient(createWorker)
// Starting playback can wait for a cold player script, so it runs in its own
// worker instead of queueing behind library-sized sync and import jobs.
const playbackJobs = new BackgroundJobClient(createWorker)

export function runWorkerJob(operation, input) {
  return (operation === 'extractPlayer' ? playbackJobs : jobs).run(operation, input)
}
