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
