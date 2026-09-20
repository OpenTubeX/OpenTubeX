import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/main/ytDlp.js', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('  function setDownloadPhase(phase) {'), source.indexOf('\n  let stdoutBuffer', source.indexOf('  function handleStdoutLine(line) {')))

function replay(lines, initialStatus = 'downloading') {
  const status = { status: initialStatus, percent: 97.3, speed: '1MiB/s', eta: '00:00' }
  const entry = {}
  const updates = []
  const context = vm.createContext({
    status, entry, sendStatus: force => updates.push({ ...status, force }),
    FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:', FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
    SUBTITLE_DESTINATION_REGEX: /^never$/, PROGRESS_REGEX: /^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+(\S+))?(?:.*?\bETA\s+(\S+))?/,
    DESTINATION_REGEX: /^never$/, MERGER_REGEX: /^never$/, subtitlesOnly: false,
  })
  vm.runInContext(`${handler}\nglobalThis.handleLine = handleStdoutLine`, context)
  for (const line of lines) context.handleLine(line)
  return { status, updates, entry }
}

test('preparation clears the previous playlist item progress and publishes immediately', () => {
  const { status, updates } = replay(['__OPENTUBEX_PREPARING__:aaaaaaaaaaa'])
  assert.equal(status.status, 'preparing')
  assert.equal(status.percent, 0)
  assert.equal(status.eta, null)
  assert.equal(updates.at(-1).force, true)
})

test('processing starts even when the final transfer percentage is below 100', () => {
  const { status, updates } = replay(['__OPENTUBEX_PROCESSING__'])
  assert.equal(status.status, 'processing')
  assert.equal(status.speed, null)
  assert.equal(status.eta, null)
  assert.equal(updates.at(-1).force, true)
})

test('the next media stream returns to downloading immediately', () => {
  const { status, updates } = replay(['__OPENTUBEX_PROCESSING__', '[download]  0.1% of 10MiB at 2MiB/s ETA 00:05'])
  assert.equal(status.status, 'downloading')
  assert.equal(status.percent, 0.1)
  assert.equal(status.eta, '00:05')
  assert.equal(updates.at(-1).force, true)
})

test('finished transfers clear stale ETA and publish processing without waiting for another log', () => {
  const { status, updates } = replay(['[download] 100% of 10MiB in 00:05'])
  assert.equal(status.status, 'processing')
  assert.equal(status.eta, null)
  assert.equal(updates.at(-1).force, true)
})

test('structured progress uses yt-dlp completion status rather than a rounded percentage', () => {
  const downloading = replay(['__OPENTUBEX_DOWNLOAD__:downloading\t100.0%\t 2MiB/s\t00:00'])
  assert.equal(downloading.status.status, 'downloading')
  const finished = replay(['__OPENTUBEX_DOWNLOAD__:finished\t97.3%\t 2MiB/s\t00:00'])
  assert.equal(finished.status.status, 'processing')
  assert.equal(finished.status.eta, null)
  assert.equal(finished.updates.at(-1).force, true)
})

test('unknown transfer measurements do not leak yt-dlp placeholders', () => {
  const { status } = replay(['__OPENTUBEX_DOWNLOAD__:downloading\tUnknown %\t Unknown B/s\tUnknown'])
  assert.equal(status.percent, 0)
  assert.equal(status.speed, null)
  assert.equal(status.eta, null)
})

test('stderr progress is decoded across chunks and keeps diagnostic history bounded', () => {
  const listeners = {}
  const lines = []
  const stderrLines = []
  const stream = name => ({
    setEncoding() {},
    on(event, callback) { listeners[`${name}:${event}`] = callback },
  })
  const wiring = source.slice(source.indexOf("  let stdoutBuffer = ''"), source.indexOf("  child.on('error',", source.indexOf("  let stdoutBuffer = ''")))
  vm.runInNewContext(wiring, {
    child: { stdout: stream('stdout'), stderr: stream('stderr') },
    handleStdoutLine: line => lines.push(line), stderrLines,
  })
  listeners['stdout:data']('__OPENTUBEX_PREPARING__:aaaaaaaaaaa\n')
  listeners['stderr:data']('__OPENTUBEX_DOWN')
  assert.equal(lines.length, 1)
  listeners['stderr:data']('LOAD__:finished\t97.3%\t2MiB/s\t00:00\r\n__OPENTUBEX_PROCESSING__\n')
  assert.deepEqual(lines, [
    '__OPENTUBEX_PREPARING__:aaaaaaaaaaa',
    '__OPENTUBEX_DOWNLOAD__:finished\t97.3%\t2MiB/s\t00:00',
    '__OPENTUBEX_PROCESSING__',
  ])
  listeners['stderr:data']('1\n2\n3\n4\n5\n6\n')
  assert.deepEqual(stderrLines, ['2', '3', '4', '5', '6'])
  listeners['stderr:data']('ERROR: download failed without a newline')
  listeners['stderr:end']()
  assert.equal(lines.at(-1), 'ERROR: download failed without a newline')
  assert.deepEqual(stderrLines, ['3', '4', '5', '6', 'ERROR: download failed without a newline'])
})

for (const initialStatus of ['paused', 'pausing']) {
  test(`processing updates preserve ${initialStatus} and remember the phase for resume`, () => {
    const { status, entry } = replay(['__OPENTUBEX_PROCESSING__'], initialStatus)
    assert.equal(status.status, initialStatus)
    assert.equal(entry.resumeStatus, 'processing')
  })
}
