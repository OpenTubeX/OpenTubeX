import { executeBackgroundJob } from './background-job-operations.js'
import { receiveJobValue, sendJobValue } from './background-job-transfer.js'

const inputs = new Map()
self.addEventListener('message', async ({ data }) => {
  if (!data || !Number.isSafeInteger(data.id)) return
  try {
    if (data.type === 'value' || data.type === 'chunk') {
      if (!inputs.has(data.id)) inputs.set(data.id, {})
      receiveJobValue(inputs.get(data.id), data)
      return
    }
    if (data.type !== 'run') return
    const input = inputs.get(data.id)?.value
    inputs.delete(data.id)
    const result = await executeBackgroundJob(data.operation, input)
    await sendJobValue(message => self.postMessage(message), data.id, result)
    self.postMessage({ type: 'done', id: data.id })
  } catch (error) {
    inputs.delete(data.id)
    self.postMessage({
      type: 'error',
      id: data.id,
      error: {
        name: error.name,
        message: error.message,
        collection: error.collection,
        deleted: error.deleted,
        previous: error.previous,
        items: error.items,
      }
    })
  }
})
