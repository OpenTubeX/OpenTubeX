import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/channel-preferences.js', import.meta.url), 'utf8')

function loadChannelInfo(findChannelTagInfo) {
  return vm.runInNewContext(
    source.slice(source.indexOf('/**\n * @typedef {{ name:')).replaceAll('export ', '') +
      '\n({ fetchChannelInfo, getCachedChannelInfo })',
    {
      checkYoutubeChannelId: id => id.startsWith('UC'),
      findChannelTagInfo,
      console: { error() {} }
    }
  )
}

test('result avatars request at most four unknown channels at once', async () => {
  const pending = []
  let active = 0
  let maxActive = 0
  const api = loadChannelInfo(channelId => {
    active++
    maxActive = Math.max(maxActive, active)
    return new Promise(resolve => pending.push(() => {
      active--
      resolve({ preferredName: channelId, icon: `${channelId}.jpg` })
    }))
  })

  const requests = Array.from({ length: 10 }, (_, index) => api.fetchChannelInfo(`UC${index}`, {}, { throttle: true }))
  while (pending.length > 0 || active > 0) {
    await new Promise(resolve => setImmediate(resolve))
    pending.shift()?.()
  }

  const results = await Promise.all(requests)
  assert.equal(maxActive, 4)
  assert.deepEqual(structuredClone(results.map(result => result.name)), Array.from({ length: 10 }, (_, index) => `UC${index}`))
})

test('a single channel lookup does not wait behind result list lookups', async () => {
  const requested = []
  const api = loadChannelInfo(channelId => {
    requested.push(channelId)
    return channelId === 'UCsingle' ? { preferredName: 'Single', icon: '' } : new Promise(() => {})
  })
  for (let index = 0; index < 4; index++) api.fetchChannelInfo(`UChung${index}`, {}, { throttle: true })
  assert.equal((await api.fetchChannelInfo('UCsingle', {})).name, 'Single')
})

test('a channel that does not exist is not requested again, unlike a failed request', async () => {
  const calls = []
  const api = loadChannelInfo(async channelId => {
    calls.push(channelId)
    return channelId === 'UCmissing' ? { invalidId: true } : { preferredName: '', icon: '', err: new Error('offline') }
  })

  assert.equal(await api.fetchChannelInfo('UCmissing', {}), null)
  assert.equal(await api.fetchChannelInfo('UCmissing', {}), null)
  assert.equal(await api.fetchChannelInfo('UCoffline', {}), null)
  assert.equal(await api.fetchChannelInfo('UCoffline', {}), null)
  assert.deepEqual(calls, ['UCmissing', 'UCoffline', 'UCoffline'])
  assert.equal(api.getCachedChannelInfo('UCmissing', new Map()), null)
})

test('a finished lookup hands its slot to a queued one before a new lookup can take it', async () => {
  const finish = new Map()
  let active = 0
  let maxActive = 0
  const api = loadChannelInfo(channelId => {
    active++
    maxActive = Math.max(maxActive, active)
    return new Promise(resolve => finish.set(channelId, () => {
      active--
      resolve({ preferredName: channelId, icon: '' })
    }))
  })

  for (let index = 0; index < 5; index++) api.fetchChannelInfo(`UC${index}`, {}, { throttle: true })
  await new Promise(resolve => setImmediate(resolve))
  finish.get('UC0')()
  // Start new lookups on every microtask while the queued one resumes.
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve()
    api.fetchChannelInfo(`UClate${tick}`, {}, { throttle: true })
  }
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(maxActive, 4)
  assert.ok(finish.has('UC4'))
})

test('queued lookups for results that are gone are dropped without a request', async () => {
  const finish = new Map()
  const api = loadChannelInfo(channelId => new Promise(resolve => finish.set(channelId, () => {
    resolve({ preferredName: channelId, icon: '' })
  })))
  for (let index = 0; index < 4; index++) api.fetchChannelInfo(`UCbusy${index}`, {}, { throttle: true })

  let staleWanted = true
  const stale = api.fetchChannelInfo('UCstale', {}, { throttle: true, isWanted: () => staleWanted })
  // Another result still shows this channel, so its shared lookup must run.
  const shared = api.fetchChannelInfo('UCshared', {}, { throttle: true, isWanted: () => false })
  api.fetchChannelInfo('UCshared', {}, { throttle: true })
  staleWanted = false

  await new Promise(resolve => setImmediate(resolve))
  finish.get('UCbusy0')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await stale, null)
  assert.ok(!finish.has('UCstale'))
  assert.ok(finish.has('UCshared'))
  finish.get('UCshared')()
  assert.equal((await shared).name, 'UCshared')
})
