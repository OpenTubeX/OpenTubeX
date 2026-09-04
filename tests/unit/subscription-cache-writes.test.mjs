import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'

// The handlers module imports the platform datastore singleton through webpack.
// Run the actual cache class with an isolated real NeDB for each interleaving.
const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const start = source.indexOf('class SubscriptionCache {')
const cacheSource = source.slice(start, source.indexOf('\nclass ', start + 1))

for (const enrichmentFirst of [false, true]) {
  test(`Shorts refresh preserves new entries when enrichment starts ${enrichmentFirst ? 'first' : 'second'}`, async () => {
    const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
    const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db })
    await Cache.updateShortsByChannelId('channel', [{ videoId: 'old', title: 'Old title' }], new Date(1000))

    const refresh = () => Cache.updateShortsByChannelId('channel', [
      { videoId: 'old', title: 'Refreshed title' },
      { videoId: 'new', title: 'New title' },
    ], new Date(2000))
    const enrich = () => Cache.updateShortsWithChannelPageShortsByChannelId('channel', [
      { videoId: 'old', title: 'Enriched title', viewCount: 2000 },
    ])
    const first = enrichmentFirst ? enrich() : refresh()
    // Let the first read enter NeDB's queue before starting the other writer.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.all([first, enrichmentFirst ? refresh() : enrich()])

    const result = await db.subscriptionCache.findOneAsync({ _id: 'channel' })
    assert.deepEqual(result.shorts.map(video => video.videoId), ['old', 'new'])
    assert.equal(new Date(result.shortsTimestamp).getTime(), 2000)
    assert.equal(result.shorts[0].title, enrichmentFirst ? 'Refreshed title' : 'Enriched title')
  })
}
