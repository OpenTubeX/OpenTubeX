import { createSubscriptionBackgroundResults } from './subscriptionBackgroundResults'
import { randomUUID } from 'node:crypto'
import { createSubscriptionBackgroundScheduler } from './subscriptionBackgroundScheduler'
import { parseAndEnrichBackgroundFeed } from '../renderer/helpers/api/background-feed-parser'
import { fetchBackgroundSubscriptionChannel } from '../subscriptionBackgroundRequests'
import { processSubscriptionFeed } from './subscriptionFeedProcessing.js'
import { normalizeUploadEntries } from '../newUploadNotifications.js'

const results = createSubscriptionBackgroundResults(process.argv[2])
const requests = new Map()
let configurationJson = null

function fetchText(request, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
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

/**
 * Channels with upload notifications turned on, by ID, each with its feed types.
 * Other channels' feeds are not reported, as the notifier would discard them.
 * @type {Record<string, { feedTypes: string[] }> | null}
 */
let uploadChannels = null

const scheduler = createSubscriptionBackgroundScheduler({
  fetchChannel: async (configuration, feed, channel, signal) => {
    const payload = await fetchBackgroundSubscriptionChannel(configuration, feed, channel, signal, fetchText, async payload => ({
      backgroundFormat: 'entries', entries: await parseAndEnrichBackgroundFeed(payload, feed, channel, configuration.instanceUrl, fetchText, signal)
    }))
    if (payload?.backgroundFormat === 'entries' && uploadChannels?.[channel]?.feedTypes.includes(feed)) {
      process.parentPort.postMessage({ type: 'uploads', channelId: channel, feedType: feed, entries: normalizeUploadEntries(payload.entries) })
    }
    return payload
  },
  saveResult: result => results.save(result)
})

const methods = {
  processFeed: processSubscriptionFeed,
  async configure(configuration) {
    const encoded = JSON.stringify(configuration)
    if (encoded === configurationJson) return
    scheduler.configure(configuration)
    await results.retain(configuration)
    configurationJson = encoded
  },
  configureUploads(value) { uploadChannels = value?.enabled === true ? value.channels : null },
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
