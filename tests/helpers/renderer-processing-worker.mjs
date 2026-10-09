import { parentPort } from 'node:worker_threads'
import { executeBackgroundJob } from '../../src/renderer/helpers/background-job-operations.js'
import { receiveJobValue, sendJobValue } from '../../src/renderer/helpers/background-job-transfer.js'
import { processSubscriptionFeed } from '../../src/main/subscriptionFeedProcessing.js'

const inputs = new Map()
parentPort.on('message', async message => {
  try {
    if (message.type === 'value' || message.type === 'chunk') {
      if (!inputs.has(message.id)) inputs.set(message.id, {})
      receiveJobValue(inputs.get(message.id), message)
      return
    }
    const input = inputs.get(message.id)?.value
    inputs.delete(message.id)
    const result = message.operation === 'subscriptionFeed'
      ? processSubscriptionFeed(input)
      : await executeBackgroundJob(message.operation, input)
    await sendJobValue(value => parentPort.postMessage(value), message.id, result)
    parentPort.postMessage({ type: 'done', id: message.id })
  } catch (error) {
    parentPort.postMessage({ type: 'error', id: message.id, error: {
      name: error.name, message: error.message,
      collection: error.collection, deleted: error.deleted, previous: error.previous, items: error.items,
    } })
  }
})
