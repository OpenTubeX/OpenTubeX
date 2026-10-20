import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { Player } from 'youtubei.js'
import { createBackgroundPlayer } from '../../src/renderer/helpers/api/background-player.js'
import { executeBackgroundJob } from '../../src/renderer/helpers/background-job-operations.js'

const source = gunzipSync(await readFile(new URL('../../e2e/fixtures/innertube/shared/shared-99c4a5c04897.gz', import.meta.url))).toString()

test('background extraction preserves upstream player data and reuses its cache', async () => {
  const entries = new Map()
  const cache = { get: async key => entries.get(key), set: async (key, value) => entries.set(key, value) }
  const calls = []
  const fetch = async url => {
    calls.push(url.toString())
    return new Response(source)
  }
  let jobs = 0
  const runJob = async (operation, input) => {
    jobs++
    return executeBackgroundJob(operation, input)
  }
  const player = await createBackgroundPlayer(cache, fetch, 'fixture', runJob)
  const original = await Player.create(undefined, async () => new Response(source), undefined, 'fixture')
  assert.equal(player.signature_timestamp, original.signature_timestamp)
  assert.deepEqual(player.data, original.data)
  assert.ok(player.signature_timestamp > 0)
  assert.equal(jobs, 1)
  assert.deepEqual(calls, ['https://www.youtube.com/s/player/fixture/player_es6.vflset/en_US/base.js'])
  const cached = await createBackgroundPlayer(cache, fetch, 'fixture', runJob)
  assert.deepEqual(cached.data, player.data)
  assert.equal(jobs, 1)
  assert.equal(calls.length, 1)
})

test('discovers a missing player id before reading the cache', async () => {
  const cache = { get: async key => { assert.equal(key, 'fixture'); return undefined }, set: async () => {} }
  const urls = []
  const fetch = async url => {
    urls.push(url.toString())
    return new Response(url.pathname === '/iframe_api' ? 'player\\/fixture\\/' : source)
  }
  const player = await createBackgroundPlayer(cache, fetch, undefined, executeBackgroundJob)
  assert.equal(player.player_id, 'fixture')
  assert.equal(urls[0], 'https://www.youtube.com/iframe_api')
})

test('does not extract failed downloads', async () => {
  const cache = { get: async () => undefined }
  const runJob = () => assert.fail('Failed responses must not be parsed')
  await assert.rejects(createBackgroundPlayer(cache, async () => new Response('', { status: 403 }), 'fixture', runJob), /Failed to get player data: 403/)
  await assert.rejects(createBackgroundPlayer(cache, async () => new Response('', { status: 403 }), undefined, runJob), /Failed to get player id: 403/)
})
