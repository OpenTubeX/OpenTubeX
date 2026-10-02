import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const app = readFileSync('src/renderer/App.vue', 'utf8')
const start = app.indexOf('  const openUrl = url => {', app.indexOf('async function enableCapacitorIntegrations()'))
const fragment = app.slice(start, app.indexOf('  const backButtonHandle', start))

for (const [input, expected] of [
  ['opentubex://https://www.youtube.com/watch?v=test', 'https://www.youtube.com/watch?v=test'],
  ['opentubex-nightly://https://www.youtube.com/watch?v=test', 'https://www.youtube.com/watch?v=test'],
  ['opentubex-nightly://https//youtu.be/test', 'https://youtu.be/test'],
  ['opentubex-nightly:https://youtu.be/test', 'https://youtu.be/test'],
  ['https://youtu.be/test', 'https://youtu.be/test'],
]) {
  test(`Capacitor opens ${input} as a YouTube URL`, () => {
    const urls = []
    const openUrl = vm.runInNewContext(`${fragment}\nopenUrl`, { handleYoutubeLink: url => urls.push(url) })
    openUrl(input)
    assert.deepEqual(urls, [expected])
  })
}
