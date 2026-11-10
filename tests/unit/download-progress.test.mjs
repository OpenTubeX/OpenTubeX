import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/main/ytDlpDownloads.js', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('  function setDownloadPhase(phase) {'), source.indexOf('\n  let stdoutBuffer', source.indexOf('  function handleStdoutLine(line) {')))

function replay(lines, initialStatus = 'downloading', overrides = {}) {
  const status = { status: initialStatus, percent: 97.3, speed: '1MiB/s', eta: '00:00' }
  const entry = {}
  const updates = []
  const context = vm.createContext({
    status,
    entry,
    sendStatus: force => updates.push({ ...status, force }),
    FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:',
    FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
    SUBTITLE_DESTINATION_REGEX: /^never$/,
    PROGRESS_REGEX: /^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+(\S+))?(?:.*?\bETA\s+(\S+))?/,
    DESTINATION_REGEX: /^never$/,
    MERGER_REGEX: /^never$/,
    subtitlesOnly: false,
    ID_REGEX: /^[\w-]{11}$/,
    downloadFolders: ['/downloads'],
    isPathInsideFolders: () => true,
    ...overrides,
  })
  vm.runInContext(`${handler}\nglobalThis.handleLine = handleStdoutLine`, context)
  for (const line of lines) context.handleLine(line)
  return { status, updates, entry }
}

test('preparation clears the previous playlist item progress and publishes immediately', () => {
  const { status, updates } = replay(['__OPENTUBEX_PREPARING__:aaaaaaaaaaa\t3\t12\t"Caf\\u00e9\\tvideo"'])
  assert.equal(status.currentVideoId, 'aaaaaaaaaaa')
  assert.equal(status.currentTitle, 'Caf\u00e9\tvideo')
  assert.equal(status.playlistIndex, 3)
  assert.equal(status.playlistCount, 12)
  assert.equal(status.status, 'preparing')
  assert.equal(status.percent, 0)
  assert.equal(status.eta, null)
  assert.equal(updates.at(-1).force, true)
})

test('destination lines outside the download folders are not recorded', () => {
  // custom `--print` arguments can imitate yt-dlp's own lines
  const { status } = replay([
    '[download] Destination: /downloads/Video.mp4',
    '[download] Destination: /home/user/.ssh/id_ed25519',
    '[Merger] Merging formats into "/home/user/.bashrc"',
  ], 'downloading', {
    DESTINATION_REGEX: /^\[(?:download|ExtractAudio)\] Destination: (.+)$/,
    MERGER_REGEX: /^\[Merger\] Merging formats into "(.+)"$/,
    isPathInsideFolders: path => path.startsWith('/downloads/'),
  })
  assert.equal(status.destination, '/downloads/Video.mp4')
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
    handleStdoutLine: line => lines.push(line),
    stderrLines,
    errorLines: [],
    FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:',
    FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
  })
  listeners['stdout:data']('__OPENTUBEX_PREPARING__:aaaaaaaaaaa\n')
  listeners['stderr:data']('__OPENTUBEX_DOWN')
  assert.equal(lines.length, 1)
  listeners['stderr:data']('LOAD__:finished\t97.3%\t2MiB/s\t00:00\r\n__OPENTUBEX_PROCESSING__\n')
  // only `--print` on stdout may report the files that get served and trashed
  listeners['stderr:data']('__OPENTUBEX_FILE__:aaaaaaaaaaa\t/home/user/.ssh/id_ed25519\n__OPENTUBEX_METADATA__:"aaaaaaaaaaa"\t"Title"\n')
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

test('storage history includes only terminal downloads that the backend can clear', () => {
  const storageSource = readFileSync(new URL('../../src/renderer/components/Settings/Data/StorageSettings.vue', import.meta.url), 'utf8')
  const start = storageSource.indexOf('const finishedDownloads = computed(')
  const end = storageSource.indexOf('\nconst downloadedMediaBytes', start)
  const records = ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused', 'completed', 'failed', 'cancelled', 'skipped']
    .map((status, id) => ({ id, status }))
  const result = vm.runInNewContext(`${storageSource.slice(start, end)}\nfinishedDownloads.value`, {
    computed: getter => ({ value: getter() }), downloads: { value: records },
  })
  assert.deepEqual(Array.from(result, record => record.status), ['completed', 'failed', 'cancelled', 'skipped'])
})

function finishDownload({ code, payload, destinations, stderr, subtitleFormat = '', existingFiles = [] }) {
  const start = source.indexOf('  /** @param {string} line */\n  function handleStderrLine(line) {')
  const closeStart = source.indexOf("  child.on('close', (code) => {", start)
  const closeEnd = source.indexOf('\n  })\n', closeStart) + 5
  const status = { status: 'downloading', percent: 40, destinations, destination: destinations.at(-1) ?? null, errorMessage: null }
  const notifications = []
  let close
  vm.runInNewContext(`${source.slice(start, source.indexOf("  child.on('error',", start))}${source.slice(closeStart, closeEnd)}
    for (const line of stderr) handleStderrLine(line)`, {
    id: 1,
    stderr,
    stderrLines: [],
    errorLines: [],
    status,
    payload,
    subtitleFormat,
    finished: false,
    subtitleDestinations: new Set(destinations),
    existsSync: file => existingFiles.includes(file),
    entry: { cancelled: false, restarting: false },
    activeDownloads: new Map(),
    handleStdoutLine() {},
    releaseDownloadSlot() {},
    removeTemporaryDownloadFolder() {},
    sendStatus() {},
    saveDownloadRecords: async () => {},
    showAutomaticDownloadNotification: (_, state) => notifications.push(state),
    FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:',
    FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
    child: { on: (event, callback) => { if (event === 'close') close = callback } },
    Date,
  })
  close(code)
  return { status, notifications }
}

const membersOnlyError = 'ERROR: [youtube] bbbbbbbbbbb: Join this channel to get access to members-only content like this video'

test('a playlist completes with the skipped videos when yt-dlp reports errors for some entries', () => {
  const { status } = finishDownload({
    code: 1,
    payload: { isPlaylist: true },
    destinations: ['/downloads/Playlist/001 - First [aaaaaaaaaaa].mp4'],
    stderr: [membersOnlyError, ...Array(5).fill('__OPENTUBEX_DOWNLOAD__:downloading\t50.0%\t2MiB/s\t00:01')],
    existingFiles: ['/downloads/Playlist/001 - First [aaaaaaaaaaa].mp4'],
  })
  assert.equal(status.status, 'completed')
  assert.equal(status.percent, 100)
  assert.equal(status.errorMessage, membersOnlyError)
})

test('a playlist without any saved file and a failed single video still fail', () => {
  const playlist = finishDownload({ code: 1, payload: { isPlaylist: true }, destinations: [], stderr: [membersOnlyError] })
  assert.equal(playlist.status.status, 'failed')
  const unwritten = finishDownload({ code: 1, payload: { isPlaylist: true }, destinations: ['/downloads/First.en.vtt'], stderr: ['ERROR: Unable to download video subtitles for \'en\': HTTP Error 429'] })
  assert.equal(unwritten.status.status, 'failed')
  const video = finishDownload({ code: 1, payload: {}, destinations: ['/downloads/Video [aaaaaaaaaaa].mp4'], stderr: [membersOnlyError] })
  assert.equal(video.status.status, 'failed')
  assert.equal(video.status.errorMessage, membersOnlyError)
})

test('a playlist keeps the original subtitle when converting a skipped entry failed', () => {
  const { status } = finishDownload({
    code: 1,
    payload: { isPlaylist: true },
    destinations: ['/downloads/First.en.vtt', '/downloads/Second.en.vtt'],
    stderr: ['ERROR: Postprocessing: Conversion failed!'],
    subtitleFormat: 'srt',
    existingFiles: ['/downloads/First.en.srt', '/downloads/Second.en.vtt'],
  })
  assert.equal(status.status, 'completed')
  assert.deepEqual(status.destinations, ['/downloads/First.en.srt', '/downloads/Second.en.vtt'])
})

test('a download that starts while FFmpeg is being validated waits for that installation', async () => {
  const start = source.indexOf("  if (ffmpeg.source === 'managed') {")
  const block = source.slice(start, source.indexOf("  } else if (ffmpeg.executable !== 'ffmpeg')", start))
  let finishInstall
  let installs = 0
  const context = vm.createContext({
    missingFfmpegInstall: null,
    // the installation has already placed both files and is checking their versions
    existsSync: () => installs > 0,
    resolveFfprobeExecutable: async () => ({ executable: '/managed/ffprobe' }),
    downloadManagedFfmpeg: () => {
      installs++
      return new Promise(resolve => { finishInstall = resolve })
    },
  })
  vm.runInContext(`globalThis.prepare = async () => { const ffmpeg = { source: 'managed', executable: '/managed/ffmpeg' }; const args = []
${block}  }
  return args
}`, context)
  const first = context.prepare()
  await new Promise(setImmediate)
  let secondDone = false
  const second = context.prepare().then(result => { secondDone = true; return result })
  await new Promise(setImmediate)
  assert.equal(secondDone, false, 'the second download must not use binaries that are still being validated')
  finishInstall({ error: 'rejected' })
  assert.equal((await first).error, 'rejected')
  assert.equal((await second).error, 'rejected')
  assert.equal(installs, 1)
})
