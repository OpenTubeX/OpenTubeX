import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../../src/main/ytDlp.js', import.meta.url), 'utf8')
const start = source.indexOf('  function handleStdoutLine(line)')
const end = source.indexOf('    const subtitleMatch', start)

test('download metadata preserves each playlist file channel regardless of output order', () => {
  for (const metadataFirst of [false, true]) {
    const status = { videoId: '', files: [], destinations: [] }
    const handle = vm.runInNewContext(`${source.slice(start, end)} }\nhandleStdoutLine`, {
      status, metadataByVideoId: new Map(),
      FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:', FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
      ID_REGEX: /^[\w-]{11}$/, truncatesLongTitles: false, sendStatus() {}, Buffer,
    })
    const metadata = '__OPENTUBEX_METADATA__:"abcdefghijk"\t"Title"\t"thumbnail"\t"Channel"\t"UC-channel"'
    const file = '__OPENTUBEX_FILE__:abcdefghijk\t120\t1920\t1080\t/video.mp4'
    for (const line of metadataFirst ? [metadata, file] : [file, metadata]) handle(line)
    assert.equal(status.files[0].author, 'Channel')
    assert.equal(status.files[0].authorId, 'UC-channel')
    assert.equal(status.files[0].title, 'Title')
  }
})
