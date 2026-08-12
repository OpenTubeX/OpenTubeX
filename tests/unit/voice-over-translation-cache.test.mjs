import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  VoiceOverTranslationCache,
  VOICE_OVER_TRANSLATION_CACHE_DURATION_MS
} from '../../src/main/VoiceOverTranslationCache.js'

const VIDEO_ID = 'abcdefghijk'
const RESULT = {
  translated: true,
  url: 'https://strm.yandex.net/voice-over.mp3',
  remainingTime: 0,
  status: 1
}

async function withCacheDirectory (run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentubex-voice-over-cache-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('persists a voice-over translation across cache instances', async () => {
  await withCacheDirectory(async directory => {
    const firstInstance = new VoiceOverTranslationCache(
      directory,
      async url => new URL(url),
      () => 1000
    )
    await firstInstance.set(VIDEO_ID, 'en', RESULT)

    const restartedInstance = new VoiceOverTranslationCache(
      directory,
      async url => new URL(url),
      () => 2000
    )
    assert.deepEqual(await restartedInstance.get(VIDEO_ID, 'en'), RESULT)
  })
})

test('removes translations after one day', async () => {
  await withCacheDirectory(async directory => {
    const cache = new VoiceOverTranslationCache(
      directory,
      async url => new URL(url),
      () => 1000
    )
    await cache.set(VIDEO_ID, 'en', RESULT)

    cache.now = () => 1000 + VOICE_OVER_TRANSLATION_CACHE_DURATION_MS
    await cache.pruneExpired()

    assert.deepEqual(await readdir(directory), [])
    assert.equal(await cache.get(VIDEO_ID, 'en'), undefined)
  })
})

test('does not prune a replacement written concurrently', async () => {
  await withCacheDirectory(async directory => {
    let now = 1000
    const cache = new VoiceOverTranslationCache(
      directory,
      async url => new URL(url),
      () => now
    )
    await cache.set(VIDEO_ID, 'en', RESULT)

    now += VOICE_OVER_TRANSLATION_CACHE_DURATION_MS
    await Promise.all([
      cache.pruneExpired(),
      cache.set(VIDEO_ID, 'en', { ...RESULT, status: 2 })
    ])

    assert.equal((await cache.get(VIDEO_ID, 'en')).status, 2)
  })
})
