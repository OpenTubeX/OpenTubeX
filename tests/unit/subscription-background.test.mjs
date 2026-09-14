import assert from 'node:assert/strict'
import test from 'node:test'
import { createSubscriptionBackgroundScheduler } from '../../src/main/subscriptionBackgroundScheduler.js'
import { createBackgroundSubscriptionRequests, fetchBackgroundSubscriptionChannel, resolveBackgroundSubscriptionRequest } from '../../src/subscriptionBackgroundRequests.js'
import { createAndroidSubscriptionRefreshConfiguration } from '../../src/renderer/helpers/androidSubscriptionRefreshData.js'

for (const backend of ['local', 'invidious']) {
  for (const useRss of [true, false]) {
    test(`native configuration honors ${backend}, RSS=${useRss}, without backend fallback`, () => {
      const configuration = createAndroidSubscriptionRefreshConfiguration({ backend, useRss, fallback: false, profiles: [], intervals: {}, hiddenFeedTypes: [], instanceUrl: 'https://instance.example', authorization: 'Basic private' })
      for (const [feed, plans] of Object.entries(configuration.requests)) {
        for (const plan of plans) {
          const request = resolveBackgroundSubscriptionRequest(plan, feed, 'UCtest')
          assert.equal(new URL(request.url).hostname, backend === 'local' ? 'www.youtube.com' : 'instance.example')
          assert.equal(request.authorization, backend === 'local' ? undefined : 'Basic private')
          assert.ok(!request.url.includes('%CHANNEL%'))
        }
        assert.equal(plans[0].format, feed === 'posts' ? backend : (useRss || feed === 'shorts' ? 'rss' : backend))
      }
    })
  }
}

test('fallback tries the other backend only when enabled and does not leak authorization', async () => {
  const requests = createBackgroundSubscriptionRequests({ backend: 'invidious', useRss: false, fallback: true, instanceUrl: 'https://instance.example', authorization: 'secret' })
  const urls = []
  const result = await fetchBackgroundSubscriptionChannel({ requests }, 'videos', 'UCtest', new AbortController().signal, async request => {
    urls.push(request.url)
    if (request.url.startsWith('https://instance.example')) throw new Error('Offline instance')
    assert.equal(request.authorization, undefined)
    return JSON.stringify({ contents: {} })
  })
  assert.equal(result.backgroundFormat, 'local')
  assert.equal(urls.length, 3)
})

test('malformed responses try the next source instead of saving an empty successful feed', async () => {
  const requests = createBackgroundSubscriptionRequests({ backend: 'local' })
  await assert.rejects(fetchBackgroundSubscriptionChannel({ requests }, 'videos', 'UCtest', new AbortController().signal, async () => '<html>error</html>'))
})

function configuration(interval = 100) {
  return { intervals: { videos: interval }, profiles: [
    { id: 'all', channels: { videos: ['UC1', 'UC2'] } },
    { id: 'custom', channels: { videos: ['UC1'] } }
  ] }
}

test('background scheduling respects deadlines, deduplicates channels, and excludes foreground work', async () => {
  let now = 0
  const fetched = []
  const saved = []
  const scheduler = createSubscriptionBackgroundScheduler({ now: () => now, fetchChannel: async (_, feed, id) => { fetched.push(id); return { videos: [] } }, saveResult: async result => saved.push(result) })
  scheduler.configure(configuration())
  now = 100
  await scheduler.tick()
  assert.equal(fetched.length, 0)
  await scheduler.setBackground(true)
  await scheduler.tick()
  assert.deepEqual(fetched, ['UC1', 'UC2'])
  assert.equal(saved.filter(result => result.kind === 'channel').length, 3)
  assert.equal(saved.filter(result => result.kind === 'completion').length, 2)
  await scheduler.tick()
  assert.equal(fetched.length, 2)
  scheduler.completed('all', 'videos', 1000)
  now = 200
  await scheduler.tick()
  assert.equal(fetched.length, 3)
})

test('reopening waits for cancellation and does not save an aborted response or completion', async () => {
  let now = 0
  const resolveFetches = []
  const saved = []
  let calls = 0
  const scheduler = createSubscriptionBackgroundScheduler({ now: () => now, fetchChannel: () => { calls++; return new Promise(resolve => { resolveFetches.push(resolve) }) }, saveResult: async result => saved.push(result) })
  scheduler.configure(configuration())
  await scheduler.setBackground(true)
  now = 100
  const running = scheduler.tick()
  await scheduler.tick()
  assert.equal(calls, 2)
  let stopped = false
  const stopping = scheduler.setBackground(false).then(() => { stopped = true })
  await Promise.resolve()
  assert.equal(stopped, false)
  resolveFetches.forEach(resolve => resolve({ videos: [] }))
  await Promise.all([running, stopping])
  assert.deepEqual(saved, [])
})

test('disabling all intervals cancels current work and prevents future scheduled fetches', async () => {
  let now = 0
  let calls = 0
  const scheduler = createSubscriptionBackgroundScheduler({ now: () => now, fetchChannel: async () => { calls++; return {} }, saveResult: async () => {} })
  scheduler.configure(configuration())
  await scheduler.setBackground(true)
  scheduler.configure(configuration(0))
  now = 1000
  await scheduler.tick()
  assert.equal(calls, 0)
})

test('saved results survive restart and stale acknowledgements cannot remove a newer refresh', async () => {
  const { mkdtemp, rm, readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createSubscriptionBackgroundResults } = await import('../../src/main/subscriptionBackgroundResults.js')
  const directory = await mkdtemp(join(tmpdir(), 'background-results-test-'))
  try {
    const store = createSubscriptionBackgroundResults(directory)
    const first = { kind: 'channel', profileId: 'all', feedType: 'videos', channelId: 'UC1', timestamp: 100, payload: { entries: [{ videoId: 'old' }] } }
    await store.save(first)
    const previous = await store.next()
    await store.save({ ...first, timestamp: 200, payload: { entries: [{ videoId: 'new' }] } })
    await store.acknowledge(previous.id)
    assert.equal((await readdir(directory)).length, 1)
    const reopened = createSubscriptionBackgroundResults(directory)
    const next = await reopened.next()
    assert.equal(next.payload.entries[0].videoId, 'new')
    await reopened.acknowledge(next.id)
    assert.equal(await reopened.next(), null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('RSS parsing handles namespaces, escaped titles and CDATA, and rejects malformed feeds', async () => {
  const { parseBackgroundFeed } = await import('../../src/renderer/helpers/api/background-feed-parser.js')
  const text = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><author><name>Channel &amp; friends</name></author><entry><yt:videoId>test</yt:videoId><title><![CDATA[A < B]]></title><published>2026-09-14T08:00:00Z</published><media:statistics views="42"/></entry></feed>'
  const [video] = parseBackgroundFeed({ backgroundFormat: 'rss', text }, 'shorts', 'UCtest', '')
  assert.equal(video.title, 'A < B')
  assert.equal(video.author, 'Channel & friends')
  assert.equal(video.authorId, 'UCtest')
  assert.equal(video.viewCount, 42)
  assert.equal(video.isShort, true)
  assert.equal(video.published, Date.parse('2026-09-14T08:00:00Z'))
  assert.throws(() => parseBackgroundFeed({ backgroundFormat: 'rss', text: '<feed><entry></feed>' }, 'videos', 'UCtest', ''))
})

test('the process parser normalizes a recorded Local API channel response without a DOM or store', async () => {
  const { readFile } = await import('node:fs/promises')
  const { gunzipSync } = await import('node:zlib')
  const { parseBackgroundFeed } = await import('../../src/renderer/helpers/api/background-feed-parser.js')
  const data = JSON.parse(gunzipSync(await readFile(new URL('../../e2e/fixtures/innertube/channel/shows-channel-info-and-videos/browse-43cf009333cb.0.json.gz', import.meta.url))))
  const videos = parseBackgroundFeed({ backgroundFormat: 'local', data }, 'videos', 'UCtest', '')
  assert.equal(videos.length, 30)
  assert.ok(videos.every(video => typeof video.videoId === 'string' && video.author === 'Blender'))
  assert.ok(videos.some(video => Number.isFinite(video.published)))
})

test('empty Live pages follow continuations before saving a result', async () => {
  const requests = createBackgroundSubscriptionRequests({ backend: 'local', useRss: false })
  const bodies = []
  const payload = await fetchBackgroundSubscriptionChannel({ requests }, 'live', 'UCtest', new AbortController().signal, async request => {
    const body = JSON.parse(request.body)
    bodies.push(body)
    return JSON.stringify(body.continuation
      ? { onResponseReceivedActions: [{ videoRenderer: { videoId: 'live' } }] }
      : { contents: { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } } })
  })
  assert.equal(bodies.length, 2)
  assert.equal(bodies[1].continuation, 'next')
  assert.equal(bodies[1].browseId, undefined)
  assert.ok(payload.continuation)
})

test('closing the last window leaves process shutdown to Quit, including macOS reactivation', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const source = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
  const start = source.indexOf("app.on('window-all-closed', ") + "app.on('window-all-closed', ".length
  const end = source.indexOf('\n  })', start) + '\n  }'.length
  const calls = []
  const closed = vm.runInNewContext(`(${source.slice(start, end)})`, {
    mainWindow: {}, trayWindows: [], keepRefreshingInBackground: false, isQuitting: false,
    backgroundSubscriptions: { stop: () => calls.push('stop') },
    handleQuit: () => calls.push('cleanup'),
  })
  closed()
  assert.deepEqual(calls, ['cleanup'])
})

test('background RSS enrichment distinguishes ordinary low-view uploads from scheduled premieres', async () => {
  const { parseAndEnrichBackgroundFeed } = await import('../../src/renderer/helpers/api/background-feed-parser.js')
  const text = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><author><name>Channel</name></author>' + ['ordinary', 'premiere'].map(id => `<entry><yt:videoId>${id}</yt:videoId><title>${id}</title><published>2026-09-14T08:00:00Z</published><media:statistics views="1"/></entry>`).join('') + '</feed>'
  const requested = []
  const entries = await parseAndEnrichBackgroundFeed({ backgroundFormat: 'rss', text }, 'videos', 'UCtest', '', async request => {
    requested.push(request)
    return request.url.endsWith('ordinary')
      ? 'var ytInitialPlayerResponse = {"videoDetails":{"isLive":false}};'
      : 'var ytInitialPlayerResponse = {"videoDetails":{"isLive":true,"isLiveContent":false},"isUpcoming":true,"scheduledStartTime":"1800000000"};'
  }, new AbortController().signal)
  assert.equal(entries[0].isUpcoming, false)
  assert.equal(entries[1].isUpcoming, true)
  assert.equal(entries[1].isPremiere, true)
  assert.equal(entries[1].published, 1800000000000)
  assert.equal(requested.length, 2)
  assert.ok(requested.every(request => request.authorization === undefined))
})

test('failed RSS enrichment remains retryable and cancellation prevents a completed result', async () => {
  const { parseAndEnrichBackgroundFeed } = await import('../../src/renderer/helpers/api/background-feed-parser.js')
  const text = '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><author><name>Channel</name></author><entry><yt:videoId>upload</yt:videoId><title>Upload</title><published>2026-09-14T08:00:00Z</published><media:statistics views="0"/></entry></feed>'
  const payload = { backgroundFormat: 'rss', text }
  const controller = new AbortController()
  const [entry] = await parseAndEnrichBackgroundFeed(payload, 'videos', 'UCtest', '', async () => { throw new Error('offline') }, controller.signal)
  assert.equal(entry.isUpcoming, undefined)
  await assert.rejects(parseAndEnrichBackgroundFeed(payload, 'videos', 'UCtest', '', async () => {
    controller.abort()
    throw controller.signal.reason
  }, controller.signal), { name: 'AbortError' })
})
