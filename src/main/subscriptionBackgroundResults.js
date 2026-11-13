import { mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createSerialQueue } from './serialQueue.js'
import { writeFileAtomic } from './writeFileAtomic.js'

/**
 * Keep response bodies on disk, with one replaceable slot per profile/feed/channel.
 * A channel's failure has its own slot, so that it does not replace a fetched feed the app has not imported yet.
 */
export function createSubscriptionBackgroundResults(directory) {
  const index = new Map()
  const enqueue = createSerialQueue()
  let initialized = false
  const keyFor = result => JSON.stringify([result.profileId, result.feedType, result.channelId ?? null, ...(result.kind === 'channelFailure' ? ['failure'] : [])])
  const filenameFor = key => path.join(directory, createHash('sha256').update(key).digest('hex') + '.json')
  const remember = result => index.set(keyFor(result), { id: result.id, timestamp: result.timestamp, kind: result.kind })

  async function initialize() {
    await mkdir(directory, { recursive: true })
    for (const file of await readdir(directory)) {
      if (/^[a-f0-9]{64}\.json\.tmp$/.test(file)) {
        await unlink(path.join(directory, file))
        continue
      }
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
      try { remember(JSON.parse(await readFile(path.join(directory, file), 'utf8'))) } catch (error) {
        console.error('Invalid saved background subscription result', error)
        await unlink(path.join(directory, file))
      }
    }
  }
  function run(operation) {
    return enqueue(async () => {
      if (!initialized) { await initialize(); initialized = true }
      return operation()
    })
  }

  return {
    save(result) {
      return run(async () => {
        const value = { ...result, id: randomUUID() }
        const file = filenameFor(keyFor(value))
        await writeFileAtomic(file, JSON.stringify(value), { mode: 0o600 })
        remember(value)
      })
    },
    next() {
      return run(async () => {
        const first = [...index.entries()].sort(([, a], [, b]) => a.timestamp - b.timestamp || Number(a.kind === 'completion') - Number(b.kind === 'completion'))[0]
        return first ? JSON.parse(await readFile(filenameFor(first[0]), 'utf8')) : null
      })
    },
    acknowledge(id) {
      return run(async () => {
        for (const [key, result] of index) {
          if (result.id !== id) continue
          await unlink(filenameFor(key))
          index.delete(key)
          break
        }
        return true
      })
    },
    retain(configuration) {
      return run(async () => {
        const wanted = new Set(configuration.profiles.flatMap(profile => Object.entries(profile.channels).flatMap(([feed, ids]) => [
          JSON.stringify([profile.id, feed, null]),
          ...ids.flatMap(id => [JSON.stringify([profile.id, feed, id]), JSON.stringify([profile.id, feed, id, 'failure'])])
        ])))
        for (const key of index.keys()) {
          if (wanted.has(key)) continue
          await unlink(filenameFor(key))
          index.delete(key)
        }
      })
    }
  }
}
