import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { calculatePublishedDate } from '../../src/renderer/helpers/feed-metadata.js'
import { createSubscriptionBackgroundResults } from '../../src/main/subscriptionBackgroundResults.js'

for (const label of ['unknown publication', '2 fortnights ago']) {
  test(`an unrecognized publication label stays unknown: ${label}`, () => {
    assert.equal(calculatePublishedDate(label), undefined)
  })
}

test('publication labels recognize capitalized time units', () => {
  const before = Date.now()
  const published = calculatePublishedDate('2 Hours ago')
  assert.ok(published >= before - 7200000 && published <= Date.now() - 7200000)
})

test('restart removes abandoned temporary slots without deleting committed results', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'background-temp-cleanup-'))
  try {
    await createSubscriptionBackgroundResults(directory).save({ kind: 'channel', profileId: 'all', feedType: 'videos', channelId: 'UCtest', timestamp: 100, payload: { entries: [] } })
    const [committed] = await readdir(directory)
    await writeFile(path.join(directory, committed + '.tmp'), 'incomplete')
    assert.equal((await createSubscriptionBackgroundResults(directory).next()).channelId, 'UCtest')
    assert.deepEqual(await readdir(directory), [committed])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('desktop transport supports a configured HTTP instance and rejects non-HTTP schemes', async () => {
  const source = (await readFile(new URL('../../src/main/subscriptionBackground.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace('export function', 'function')
  let receive
  class Worker extends EventEmitter {
    postMessage(message) {
      if (message.method) queueMicrotask(() => this.emit('message', { id: message.id, value: null }))
      else if (message.type === 'response') receive(message)
    }
    kill() { this.emit('exit') }
  }
  const worker = new Worker()
  const requests = []
  const context = vm.createContext({
    path, existsSync: () => false, __dirname: '/fixture',
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
    URL, AbortController, AbortSignal, Buffer, console,
    utilityProcess: { fork: () => worker },
    net: { isOnline: () => true, fetch: async url => { requests.push(url); return { ok: true, body: [Buffer.from('feed')] } } }
  })
  vm.runInContext(source, context)
  const service = context.createSubscriptionBackgroundService('/fixture/data')
  try {
    await service.configure({ enabled: true })
    for (const url of ['http://127.0.0.1:3000/api/v1/channels/UCtest/videos', 'https://instance.example/feed', 'file:///etc/passwd']) {
      const response = new Promise(resolve => { receive = resolve })
      worker.emit('message', { type: 'fetch', id: url, request: { url } })
      const result = await response
      if (url.startsWith('file:')) assert.ok(result.error)
      else assert.equal(result.text, 'feed', result.error)
    }
    assert.equal(requests.length, 2)
  } finally { service.stop() }
})

async function serviceFixture(timers = { setTimeout, clearTimeout }) {
  const source = (await readFile(new URL('../../src/main/subscriptionBackground.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace('export function', 'function')
  const children = []
  class Worker extends EventEmitter {
    messages = []
    postMessage(message) {
      this.messages.push(message)
      queueMicrotask(() => this.emit('message', { id: message.id, value: null }))
    }
    kill() { this.killed = true; this.emit('exit') }
  }
  const context = vm.createContext({
    path, existsSync: () => true, __dirname: '/fixture', setInterval: () => 0, clearInterval() {},
    ...timers, console,
    utilityProcess: { fork() { const child = new Worker(); children.push(child); return child } },
    net: { isOnline: () => true }
  })
  vm.runInContext(source, context)
  return { service: context.createSubscriptionBackgroundService('/fixture/data'), children }
}

test('foreground processing releases its idle utility after a background-state notification', async () => {
  const timers = new Map()
  const { service, children } = await serviceFixture({
    setTimeout(callback, delay) { const handle = {}; timers.set(handle, { callback, delay }); return handle },
    clearTimeout: handle => timers.delete(handle),
  })
  try {
    await service.processFeed({ format: 'rss', text: '<feed/>' })
    await service.setBackground(false)
    assert.equal(timers.size, 1)
    const [idle] = timers.values()
    assert.equal(idle.delay, 15_000)
    idle.callback()
    assert.equal(children[0].killed, true)
    await service.processFeed({ format: 'rss', text: '<feed/>' })
    assert.equal(children.length, 2)
  } finally { service.stop() }
})

test('draining results after a worker crash restores configuration before any concurrent operations', async () => {
  const { service, children } = await serviceFixture()
  try {
    const configuration = { enabled: true, profiles: [], intervals: {} }
    await service.configure(configuration)
    await service.setBackground(true)
    children[0].emit('exit')
    await Promise.all([service.next(), service.completed({ profileId: 'all' })])
    assert.equal(children.length, 2)
    assert.deepEqual(children[1].messages.slice(0, 2).map(message => message.method), ['configure', 'background'])
    assert.deepEqual(children[1].messages[0].value, configuration)
    assert.equal(children[1].messages[1].value, true)
  } finally { service.stop() }
})

test('the upload channel set reaches the worker and is restored after a crash', async () => {
  const { service, children } = await serviceFixture()
  try {
    const uploads = { enabled: true, channels: { UCtest: { feedTypes: ['videos'] } } }
    await service.configureUploads(uploads)
    assert.equal(children.length, 0, 'The configuration alone does not start a worker')
    await service.configure({ enabled: true, profiles: [], intervals: {} })
    assert.deepEqual(children[0].messages.slice(0, 3).map(message => message.method), ['configureUploads', 'configure', 'background'])
    assert.equal(children[0].messages[0].value, uploads)
    await service.configureUploads({ enabled: false })
    assert.equal(children[0].messages.at(-1).method, 'configureUploads')
    children[0].emit('exit')
    await service.next()
    assert.deepEqual(children[1].messages.slice(0, 3).map(message => message.method), ['configureUploads', 'configure', 'background'])
    assert.deepEqual(children[1].messages[0].value, { enabled: false })
  } finally { service.stop() }
})

test('a worker started by feed processing before the scheduler configuration still gets the upload channels', async () => {
  const { service, children } = await serviceFixture()
  try {
    const uploads = { enabled: true, channels: { UCtest: { feedTypes: ['videos'] } } }
    await service.configureUploads(uploads)
    await service.processFeed({ format: 'rss', text: '<feed/>' })
    assert.deepEqual(children[0].messages.map(message => message.method), ['configureUploads', 'processFeed'])
    assert.equal(children[0].messages[0].value, uploads)
    await service.configure({ enabled: true, profiles: [], intervals: {} })
    assert.deepEqual(children[0].messages.slice(2).map(message => message.method), ['configure', 'background'])
    assert.equal(children.length, 1)
  } finally { service.stop() }
})

test('the worker reports uploads only for feeds with notifications turned on', async () => {
  const source = await readFile(new URL('../../src/main/subscriptionBackgroundWorker.js', import.meta.url), 'utf8')
  const messages = []
  let options
  const context = vm.createContext({
    process: { parentPort: { postMessage: message => messages.push(message) } },
    createSubscriptionBackgroundScheduler: value => { options = value; return {} },
    fetchBackgroundSubscriptionChannel: async (configuration, feed, channel, signal, fetchText, parse) => parse('<feed/>'),
    parseAndEnrichBackgroundFeed: async () => [{ id: 'video' }],
    normalizeUploadEntries: entries => entries,
    results: {}, processSubscriptionFeed() {}, fetchText() {}, JSON
  })
  vm.runInContext(source.slice(source.indexOf('let uploadChannels'), source.indexOf('\nfunction tick()')) + '\nglobalThis.methods = methods', context)
  const fetch = (feed = 'videos') => options.fetchChannel({ instanceUrl: '' }, feed, 'UCtest', null)
  await fetch()
  context.methods.configureUploads({ enabled: true, channels: { UCtest: { feedTypes: ['videos'] } } })
  await fetch('shorts')
  assert.equal(messages.length, 0)
  await fetch()
  assert.deepEqual(messages.map(message => [message.type, message.channelId, message.feedType, message.entries.length]), [['uploads', 'UCtest', 'videos', 1]])
  context.methods.configureUploads({ enabled: false })
  await fetch()
  assert.equal(messages.length, 1)
})

test('an already-aborted worker fetch rejects without sending an HTTP request', async () => {
  const source = await readFile(new URL('../../src/main/subscriptionBackgroundWorker.js', import.meta.url), 'utf8')
  const messages = []
  const context = vm.createContext({ requests: new Map(), randomUUID: () => 'id', process: { parentPort: { postMessage: message => messages.push(message) } } })
  vm.runInContext(source.slice(source.indexOf('function fetchText('), source.indexOf('\nconst scheduler')), context)
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const result = context.fetchText({ url: 'https://example.com' }, controller.signal)
  assert.equal(messages.length, 0)
  await assert.rejects(result, /cancelled/)
})
