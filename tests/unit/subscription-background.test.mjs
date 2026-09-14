import assert from 'node:assert/strict'
import test from 'node:test'
import { createSubscriptionBackgroundScheduler } from '../../src/main/subscriptionBackgroundScheduler.js'
import { createBackgroundSubscriptionRequests, fetchBackgroundSubscriptionChannel, parseBackgroundSubscriptionResponse, resolveBackgroundSubscriptionRequest } from '../../src/subscriptionBackgroundRequests.js'
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
        assert.equal(plans[0].format, feed === 'posts' ? backend : (useRss ? 'rss' : backend))
      }
    })
  }
}

test('fallback tries the other backend only when enabled and does not leak authorization', async () => {
  const requests = createBackgroundSubscriptionRequests({ backend: 'invidious', useRss: false, fallback: true, instanceUrl: 'https://instance.example', authorization: 'secret' })
  const urls = []
  const result = await fetchBackgroundSubscriptionChannel({ requests }, 'videos', 'UCtest', new AbortController().signal, async request => {
    urls.push(request.url)
    if (new URL(request.url).hostname === 'instance.example') throw new Error('Offline instance')
    assert.equal(request.authorization, undefined)
    return JSON.stringify({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: {} } }] } } })
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
      : { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } } } }] } } })
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
  const marker = "app.on('window-all-closed', "
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, 'window-all-closed handler must exist')
  const start = markerIndex + marker.length
  const closingIndex = source.indexOf('\n  })', start)
  assert.ok(closingIndex > start, 'window-all-closed handler must have a closing boundary')
  const end = closingIndex + '\n  }'.length
  for (const [enabled, quitting, expected] of [
    [false, false, ['cleanup']], [true, false, ['tray', 'background']], [true, true, ['cleanup']]
  ]) {
    const calls = []
    const closed = vm.runInNewContext(`(${source.slice(start, end)})`, {
      mainWindow: {}, trayWindows: [], keepRefreshingInBackground: enabled, isQuitting: quitting,
      backgroundSubscriptions: {
        stop: () => calls.push('stop'),
        setBackground: async value => { assert.equal(value, true); calls.push('background') }
      },
      ensureBackgroundTray: () => calls.push('tray'),
      handleQuit: () => calls.push('cleanup'),
    })
    closed()
    assert.deepEqual(calls, expected)
  }
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

test('Shorts date enrichment preserves known dates and validates fetched video identity', async () => {
  const { enrichShortPublicationDates } = await import('../../src/renderer/helpers/api/short-publication.js')
  const requested = []
  const entries = await enrichShortPublicationDates([
    { videoId: 'known', published: 123 }, { videoId: 'cached' }, { videoId: 'fresh' }
  ], async id => {
    requested.push(id)
    return `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: id }, microformat: { playerMicroformatRenderer: { publishDate: '2026-09-14T08:00:00Z' } } })};`
  }, [{ videoId: 'cached', published: 456 }])
  assert.deepEqual(requested, ['fresh'])
  assert.deepEqual(entries.map(entry => entry.published), [123, 456, Date.parse('2026-09-14T08:00:00Z')])
  await assert.rejects(enrichShortPublicationDates([{ videoId: 'fresh' }], async () => 'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"other"},"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-09-14"}}}'), /publication date/)
})

test('utility completes missing Local Shorts dates without forwarding backend credentials', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const { enrichShortPublicationDates } = await import('../../src/renderer/helpers/api/short-publication.js')
  const { mapConcurrently } = await import('../../src/renderer/helpers/concurrent-map.js')
  const source = await readFile(new URL('../../src/renderer/helpers/api/background-feed-parser.js', import.meta.url), 'utf8')
  const context = vm.createContext({
    enrichShortPublicationDates, mapConcurrently,
    parseBackgroundFeed: () => [{ videoId: 'short', isShort: true }]
  })
  vm.runInContext(source.slice(source.indexOf('export async function parseAndEnrichBackgroundFeed')).replace('export ', ''), context)
  const requests = []
  const [entry] = await context.parseAndEnrichBackgroundFeed({ backgroundFormat: 'local' }, 'shorts', 'UCtest', 'https://instance.example', async request => {
    requests.push(request)
    return 'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"short"},"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-09-14"}}};'
  }, new AbortController().signal)
  assert.equal(entry.published, Date.parse('2026-09-14'))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://www.youtube.com/watch?v=short')
  assert.equal(requests[0].authorization, undefined)
})

test('a disabled configuration stops due work before its persistence finishes', async () => {
  let now = 0
  let calls = 0
  const scheduler = createSubscriptionBackgroundScheduler({ now: () => now, fetchChannel: async () => { calls++; return {} }, saveResult: async () => {} })
  scheduler.configure(configuration())
  await scheduler.setBackground(true)
  now = 100
  scheduler.configure({ ...configuration(), enabled: false })
  await scheduler.tick()
  assert.equal(calls, 0)
})

test('a failed retention is retried for an identical worker configuration', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const source = await readFile(new URL('../../src/main/subscriptionBackgroundWorker.js', import.meta.url), 'utf8')
  let attempts = 0
  const context = vm.createContext({
    scheduler: { configure() {} },
    results: { async retain() { if (++attempts === 1) throw new Error('temporary disk failure') } }
  })
  vm.runInContext('let configurationJson = null;\n' + source.slice(source.indexOf('const methods = {'), source.indexOf('\nfunction tick()')) + '\nglobalThis.configure = methods.configure', context)
  await assert.rejects(context.configure(configuration()), /temporary disk failure/)
  await context.configure(configuration())
  assert.equal(attempts, 2)
})


test('invalid Local browse shapes fall back without treating malformed responses as empty feeds', async () => {
  const valid = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: {} } }] } } }
  for (const contents of [{}, [], '', { unrecognizedRenderer: {} }, { twoColumnBrowseResultsRenderer: { tabs: [] } }]) {
    assert.throws(() => parseBackgroundSubscriptionResponse('local', JSON.stringify({ contents }), 'videos'))
  }
  assert.equal(parseBackgroundSubscriptionResponse('local', JSON.stringify(valid), 'videos').backgroundFormat, 'local')
  const requests = createBackgroundSubscriptionRequests({ backend: 'local', useRss: false, fallback: true, instanceUrl: 'https://instance.example' })
  const urls = []
  const result = await fetchBackgroundSubscriptionChannel({ requests }, 'videos', 'UCtest', new AbortController().signal, async request => {
    urls.push(request.url)
    return new URL(request.url).hostname === 'www.youtube.com' ? '{"contents":{}}' : '{"videos":[]}'
  })
  assert.deepEqual(result, { videos: [] })
  assert.ok(urls.some(url => new URL(url).hostname === 'instance.example'))
})

test('delayed playlist imports anchor relative dates to fetch time while preserving upcoming dates', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const source = await readFile(new URL('../../src/renderer/helpers/api/local-feed-parsers.js', import.meta.url), 'utf8')
  const start = source.indexOf('  function normalizeLocalSubscriptionFeed(')
  const end = source.indexOf('\n  return {\n    normalizeLocalSubscriptionFeed,', start)
  assert.ok(start >= 0 && end > start)
  const now = Date.now()
  const context = vm.createContext({
    Date: { now: () => now },
    YT: { Playlist: class { constructor(client, { data }) { this.items = data } } },
    parseLocalPlaylistVideos: entries => entries
  })
  vm.runInContext(source.slice(start, end), context)
  const entries = context.normalizeLocalSubscriptionFeed('shorts', {
    backgroundFormat: 'localPlaylist',
    data: [{ published: now - 3600000 }, { published: now + 3600000, isUpcoming: true }]
  }, 'UCtest', now - 86400000)
  assert.equal(entries[0].published, now - 3600000 - 86400000)
  assert.equal(entries[1].published, now + 3600000)
})

test('a failed completion write retries after five minutes instead of the normal interval', async () => {
  let now = 0
  let fetches = 0
  let fail = true
  const scheduler = createSubscriptionBackgroundScheduler({ now: () => now,
    fetchChannel: async () => { fetches++; return {} },
    saveResult: async result => { if (result.kind === 'completion' && fail) throw new Error('disk full') }
  })
  scheduler.configure({ intervals: { videos: 3600000 }, profiles: [{ id: 'all', channels: { videos: ['UC1'] } }] })
  await scheduler.setBackground(true)
  now = 3600000
  await scheduler.tick().catch(() => {})
  fail = false
  now += 300000
  await scheduler.tick()
  assert.equal(fetches, 2)
})

for (const kind of ['channel', 'completion']) {
  test(`configuration cancellation stops remaining ${kind} writes`, async () => {
    let now = 0
    const saved = []
    let scheduler
    scheduler = createSubscriptionBackgroundScheduler({ now: () => now, fetchChannel: async () => ({}), saveResult: async result => {
      saved.push(result)
      if (result.kind === kind) scheduler.configure({ profiles: [], intervals: {} })
    } })
    scheduler.configure({ intervals: { videos: 100 }, profiles: ['all', 'custom'].map(id => ({ id, channels: { videos: ['UC1'] } })) })
    await scheduler.setBackground(true)
    now = 100
    await scheduler.tick()
    assert.equal(saved.filter(result => result.kind === kind).length, 1)
  })
}

test('topic channels accept the selected videos tab in either browse layout', () => {
  for (const layout of ['singleColumnBrowseResultsRenderer', 'twoColumnBrowseResultsRenderer']) {
    const data = { metadata: { channelMetadataRenderer: { musicArtistName: 'Artist' } }, contents: { [layout]: { tabs: [{ tabRenderer: {
      selected: true, content: {}, endpoint: { commandMetadata: { webCommandMetadata: { url: '/channel/UCtest/videos' } } }
    } }] } } }
    assert.equal(parseBackgroundSubscriptionResponse('local', JSON.stringify(data), 'videos').backgroundFormat, 'local')
  }
})
