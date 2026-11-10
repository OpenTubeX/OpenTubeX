import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/libretube.js', import.meta.url), 'utf8')
const { convertLibreTubeWatchHistoryToOpenTubeX } = vm.runInNewContext(
  `${source.replace(/^import .*$/m, '').replaceAll('export function', 'function')}
  ({ convertLibreTubeWatchHistoryToOpenTubeX })`,
  { hasReachedWatchedThreshold: (progress, duration) => progress >= duration * 0.9, Date, Map, Number, Math }
)

test('LibreTube watch positions are read as milliseconds', () => {
  const { historyItems } = convertLibreTubeWatchHistoryToOpenTubeX({
    watchHistory: [
      { videoId: 'aaaaaaaaaaa', title: 'Early', duration: 3600 },
      { videoId: 'bbbbbbbbbbb', title: 'Finished', duration: 600 },
    ],
    watchPositions: [
      { videoId: 'aaaaaaaaaaa', position: 3600 },
      { videoId: 'bbbbbbbbbbb', position: 590_000 },
    ],
  }, [])
  const [early, finished] = [...historyItems.values()]
  assert.equal(early.watchProgress, 3.6)
  assert.equal(early.isWatched, false)
  assert.equal(finished.watchProgress, 590)
  assert.equal(finished.isWatched, true)
})
