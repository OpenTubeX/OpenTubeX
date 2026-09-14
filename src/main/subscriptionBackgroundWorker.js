import { createSubscriptionBackgroundResults } from './subscriptionBackgroundResults'
import { randomUUID } from 'node:crypto'
import { createSubscriptionBackgroundScheduler } from './subscriptionBackgroundScheduler'
import { parseAndEnrichBackgroundFeed } from '../renderer/helpers/api/background-feed-parser'
import { fetchBackgroundSubscriptionChannel } from '../subscriptionBackgroundRequests'

const results = createSubscriptionBackgroundResults(process.argv[2])
const requests = new Map()
let configurationJson = null

function fetchText(request, signal) {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const abort = () => {
      requests.delete(id)
      process.parentPort.postMessage({ type: 'abort', id })
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    requests.set(id, {
      resolve: value => { signal.removeEventListener('abort', abort); resolve(value) },
      reject: error => { signal.removeEventListener('abort', abort); reject(error) }
    })
    process.parentPort.postMessage({ type: 'fetch', id, request })
  })
}

const scheduler = createSubscriptionBackgroundScheduler({
  fetchChannel: async (configuration, feed, channel, signal) => {
    return fetchBackgroundSubscriptionChannel(configuration, feed, channel, signal, fetchText, async payload => ({
      backgroundFormat: 'entries', entries: await parseAndEnrichBackgroundFeed(payload, feed, channel, configuration.instanceUrl, fetchText, signal)
    }))
  },
  saveResult: result => results.save(result)
})

const methods = {
  async configure(configuration) {
    const encoded = JSON.stringify(configuration)
    if (encoded === configurationJson) return
    scheduler.configure(configuration)
    await results.retain(configuration)
    configurationJson = encoded
  },
  async background(value) { await scheduler.setBackground(value); tick() },
  completed({ profileId, feedType, timestamp }) { scheduler.completed(profileId, feedType, timestamp) },
  next: () => results.next(),
  acknowledge: id => results.acknowledge(id)
}

function tick() {
  scheduler.tick().catch(error => console.error('Background subscription scheduling failed', error))
}
setInterval(tick, 30000)

process.parentPort.on('message', ({ data }) => {
  if (data.type === 'response') {
    const request = requests.get(data.id)
    requests.delete(data.id)
    if (data.error) request?.reject(new Error(data.error))
    else request?.resolve(data.text)
    return
  }
  Promise.resolve().then(() => {
    if (!Object.hasOwn(methods, data.method)) throw new Error('Unknown background operation')
    return methods[data.method](data.value)
  }).then(value => {
    process.parentPort.postMessage({ id: data.id, value })
  }, error => {
    process.parentPort.postMessage({ id: data.id, error: error.message })
  })
})
