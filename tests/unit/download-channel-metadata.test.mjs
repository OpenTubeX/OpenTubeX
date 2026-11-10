import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../../src/main/ytDlpDownloads.js', import.meta.url), 'utf8')
const start = source.indexOf('  function handleStdoutLine(line)')
const end = source.indexOf('    const subtitleMatch', start)
const helperStart = source.indexOf('function isPathInsideFolders(')
const helper = source.slice(helperStart, source.indexOf('\n}\n', helperStart) + 2)

function createHandler(status) {
  return vm.runInNewContext(`${helper}\n${source.slice(start, end)} }\nhandleStdoutLine`, {
    status,
    metadataByVideoId: new Map(),
    downloadFolders: ['/downloads', '/tmp/opentubex-download-a'],
    FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:',
    FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
    ID_REGEX: /^[\w-]{11}$/,
    truncatesLongTitles: false,
    sendStatus() {},
    Buffer,
    isAbsolute,
    relative,
    resolve,
    sep,
  })
}

test('download metadata preserves each playlist file channel regardless of output order', () => {
  for (const metadataFirst of [false, true]) {
    const status = { videoId: '', files: [], destinations: [] }
    const handle = createHandler(status)
    const metadata = '__OPENTUBEX_METADATA__:"abcdefghijk"\t"Title"\t"thumbnail"\t"Channel"\t"UC-channel"'
    const file = '__OPENTUBEX_FILE__:abcdefghijk\t120\t1920\t1080\t/downloads/video.mp4'
    for (const line of metadataFirst ? [metadata, file] : [file, metadata]) handle(line)
    assert.equal(status.files[0].author, 'Channel')
    assert.equal(status.files[0].authorId, 'UC-channel')
    assert.equal(status.files[0].title, 'Title')
  }
})

test('download files outside the download folders are not recorded', () => {
  const status = { videoId: '', files: [], destinations: [] }
  const handle = createHandler(status)
  // custom `--print` arguments can imitate the file line for any path
  for (const path of ['/home/user/.ssh/id_ed25519', '/downloads/../etc/passwd', '/downloads', '/downloads-other/video.mp4']) {
    handle(`__OPENTUBEX_FILE__:abcdefghijk\t120\t1920\t1080\t${path}`)
  }
  assert.deepEqual(status.files, [])
  assert.deepEqual(status.destinations, [])
  handle('__OPENTUBEX_FILE__:abcdefghijk\t120\t1920\t1080\t/downloads/Channel/video.mp4')
  assert.deepEqual(status.destinations, ['/downloads/Channel/video.mp4'])
})
