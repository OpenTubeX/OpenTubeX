import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = source.indexOf('    addToYouTubeWatchHistory() {')
const end = source.indexOf('\n    },', start)
const methods = compileFunction(
  `return ({${source.slice(start, end)}\n} })`,
  ['getYouTubeChannelKey', 'isSignedInToYouTube', 'addToYouTubeWatchHistory']
)

test('incognito tabs do not add videos to the YouTube account watch history', () => {
  for (const isIncognitoTab of [false, true]) {
    const requests = []
    const { addToYouTubeWatchHistory } = methods(
      () => 'channel',
      () => true,
      async videoId => { requests.push(videoId) }
    )
    addToYouTubeWatchHistory.call({
      videoId: 'aaaaaaaaaaa',
      isIncognitoTab,
      youTubeHistoryKey: null,
      localFilePlayback: false,
      isOffline: false,
      $store: { getters: { getYouTubeAccount: {}, getYouTubeAccountWatchHistory: true } }
    })
    assert.deepEqual(requests, isIncognitoTab ? [] : ['aaaaaaaaaaa'])
  }
})
