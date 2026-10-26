import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { shouldOpenExternalMediaUrl } from '../../src/renderer/helpers/externalMediaUrl.js'

const app = readFileSync('src/renderer/App.vue', 'utf8')
const start = app.indexOf('  const openUrl = async url => {', app.indexOf('async function enableCapacitorIntegrations()'))
const fragment = app.slice(start, app.indexOf('  const backButtonHandle', start))

function urlOpener(supportsYtDlp = true) {
  const youtube = []
  const externalMedia = []
  const openUrl = vm.runInNewContext(`${fragment}\nopenUrl`, {
    getHomeWidgetPage: () => null,
    handleYoutubeLink: url => youtube.push(url),
    openExternalMedia: url => externalMedia.push(url),
    shouldOpenExternalMediaUrl,
    supportsYtDlp,
    store: { dispatch: async () => {}, getters: { getCurrentInvidiousInstanceUrl: 'https://invidious.example' } }
  })
  return { openUrl, youtube, externalMedia }
}

for (const [input, expected] of [
  ['opentubex://https://www.youtube.com/watch?v=test', 'https://www.youtube.com/watch?v=test'],
  ['opentubex-nightly://https://www.youtube.com/watch?v=test', 'https://www.youtube.com/watch?v=test'],
  ['opentubex-nightly://https//youtu.be/test', 'https://youtu.be/test'],
  ['opentubex-nightly:https://youtu.be/test', 'https://youtu.be/test'],
  ['https://youtu.be/test', 'https://youtu.be/test'],
]) {
  test(`Capacitor opens ${input} as a YouTube URL`, async () => {
    const { openUrl, youtube, externalMedia } = urlOpener()
    await openUrl(input)
    assert.deepEqual(youtube, [expected])
    assert.deepEqual(externalMedia, [])
  })
}

test('Capacitor opens links from other sites with yt-dlp', async () => {
  const { openUrl, youtube, externalMedia } = urlOpener()
  await openUrl('https://www.instagram.com/reel/Chunk8-jurw/')
  await openUrl('opentubex://https//vimeo.com/56015672')
  await openUrl('https://invidious.example/watch?v=abcdefghijk')
  assert.deepEqual(externalMedia, ['https://www.instagram.com/reel/Chunk8-jurw/', 'https://vimeo.com/56015672'])
  assert.deepEqual(youtube, ['https://invidious.example/watch?v=abcdefghijk'])
})

test('builds without yt-dlp pass other links to the YouTube URL handler', async () => {
  const { openUrl, youtube, externalMedia } = urlOpener(false)
  await openUrl('https://www.instagram.com/reel/Chunk8-jurw/')
  assert.deepEqual(youtube, ['https://www.instagram.com/reel/Chunk8-jurw/'])
  assert.deepEqual(externalMedia, [])
})
