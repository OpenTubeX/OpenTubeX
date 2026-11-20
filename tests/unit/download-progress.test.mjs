import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { downloadErrorMessage } from '../../src/renderer/helpers/downloadErrors.js'

const source = readFileSync(new URL('../../src/main/ytDlpDownloads.js', import.meta.url), 'utf8')
const DOWNLOAD_STOPPED_ERROR = /^const DOWNLOAD_STOPPED_ERROR = '([^']+)'$/m.exec(source)[1]
const stderrHandlerStart = source.indexOf('  /**\n   * @param {DownloadPart} part\n   * @param {string} line\n   */\n  function handleStderrLine(part, line) {')
const stderrHandler = source.slice(stderrHandlerStart, source.indexOf('  function finishDownload() {', stderrHandlerStart))
const handler = source.slice(source.indexOf('  /** @param {DownloadPart} part */\n  function partPosition(part) {'), stderrHandlerStart)
const liveConstants = ['LIVE_PREFIX', 'FFMPEG_PROGRESS_REGEX', 'STOP_UNANSWERED_MS']
  .map(name => new RegExp(`^const ${name} = .+$`, 'm').exec(source)[0]).join('\n')

function replay(lines, initialStatus = 'downloading', overrides = {}) {
  const status = { status: initialStatus, percent: 97.3, speed: '1MiB/s', eta: '00:00' }
  const part = { phase: ['paused', 'pausing'].includes(initialStatus) ? 'downloading' : initialStatus, percent: 97.3, speed: '1MiB/s', eta: '00:00', done: false }
  const entry = {}
  const updates = []
  const context = vm.createContext({
    status,
    entry,
    parts: [part],
    videoIds: [],
    combineDownloadSpeeds: () => null,
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
  vm.runInContext(`${liveConstants}\n${handler}\nglobalThis.handleLine = (index, line) => handleStdoutLine(parts[index], line)`, context)
  // A line for another part of a split playlist is given with that part's index
  for (const line of lines) context.handleLine(...(Array.isArray(line) ? line : [0, line]))
  return { status: context.status, updates, entry, parts: context.parts }
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

test('live recordings show the recorded length and size that FFmpeg reports', () => {
  const { status, updates, parts: [part] } = replay([
    '__OPENTUBEX_PREPARING__:aaaaaaaaaaa\t\t\t"Live stream"',
    '__OPENTUBEX_LIVE__:True',
    'total_size=N/A',
    'out_time_us=N/A',
    'progress=continue',
    'total_size=10485760',
    'out_time_us=9648333',
    'out_time=00:00:09.648333',
    'speed=1.01x',
    'progress=continue',
  ], 'preparing')
  assert.equal(status.status, 'downloading')
  assert.equal(status.live, true)
  assert.equal(status.recordedSeconds, 9.648333)
  assert.equal(status.recordedBytes, 10485760)
  assert.equal(status.percent, 0)
  assert.equal(updates.find(update => update.status === 'downloading').force, true)

  // FFmpeg reports once more while it finishes the recording
  status.status = 'processing'
  part.phase = 'processing'
  part.stopRequestedAt = Date.now()
  replay(['progress=continue'], 'processing', { status, parts: [part] })
  assert.equal(status.status, 'processing')

  // A recording that ignored the stop request shows that it is still recording
  part.stopRequestedAt = Date.now() - 60_000
  replay(['progress=continue'], 'processing', { status, parts: [part] })
  assert.equal(status.status, 'downloading')
  assert.equal(part.stopRequestedAt, undefined)
})

test('FFmpeg progress of a video that is not live leaves its status alone', () => {
  // A live video earlier in a playlist must not mark the next one as live
  const { status } = replay([
    '__OPENTUBEX_LIVE__:True',
    '__OPENTUBEX_PREPARING__:aaaaaaaaaaa\t2\t2\t"Video"',
    '__OPENTUBEX_LIVE__:False',
    'out_time_us=1000000',
    'progress=continue',
  ], 'preparing')
  assert.equal(status.status, 'preparing')
  assert.notEqual(status.live, true)
  assert.equal(status.recordedSeconds, undefined)
})

test('parts of a split playlist keep their own live state', () => {
  const parts = [0, 1].map(() => ({ phase: 'preparing', percent: 0, speed: null, eta: null, done: false }))
  // The live video's part reports first, then the regular video's part
  const { status } = replay([
    [0, '__OPENTUBEX_PREPARING__:aaaaaaaaaaa\t1\t2\t"Live stream"'],
    [0, '__OPENTUBEX_LIVE__:True'],
    [1, '__OPENTUBEX_PREPARING__:bbbbbbbbbbb\t2\t2\t"Video"'],
    [1, '__OPENTUBEX_LIVE__:False'],
    [0, 'out_time_us=5000000'],
    [0, 'progress=continue'],
    [1, '__OPENTUBEX_DOWNLOAD__:downloading\t40.0%\t1.00MiB/s\t00:10'],
  ], 'preparing', { parts })
  // The row shows the earlier playlist entry, the live stream
  assert.equal(status.status, 'downloading')
  assert.equal(status.live, true)
  assert.equal(status.recordedSeconds, 5)
  assert.equal(parts[1].live, false)
  assert.equal(parts[1].percent, 40)
})

test('stderr progress is decoded across chunks and keeps diagnostic history bounded', () => {
  const listeners = {}
  const lines = []
  const stderrLines = []
  const stream = name => ({
    setEncoding() {},
    on(event, callback) { listeners[`${name}:${event}`] = callback },
  })
  const wiring = source.slice(source.indexOf("    let stdoutBuffer = ''"), source.indexOf("    child.on('error'", source.indexOf("    let stdoutBuffer = ''")))
  vm.runInNewContext(`${stderrHandler}${wiring}`, {
    child: { stdout: stream('stdout'), stderr: stream('stderr') },
    part: {},
    handleStdoutLine: (_, line) => lines.push(line),
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
  const finishStart = source.indexOf('  function finishDownload() {')
  const finish = source.slice(finishStart, source.indexOf('\n  }\n', finishStart) + 4)
  const status = { status: 'downloading', percent: 40, destinations, destination: destinations.at(-1) ?? null, errorMessage: null }
  const notifications = []
  vm.runInNewContext(`${stderrHandler}${finish}
    for (const line of stderr) handleStderrLine(parts[0], line)
    finishDownload()`, {
    id: 1,
    stderr,
    stderrLines: [],
    errorLines: [],
    status,
    payload,
    subtitleFormat,
    parts: [{ done: true, code, error: null }],
    subtitleDestinations: new Set(destinations),
    existsSync: file => existingFiles.includes(file),
    entry: { cancelled: false, restarting: false },
    activeDownloads: new Map(),
    handleStdoutLine() {},
    rm: async () => {},
    temporaryDownloadFolder: '/downloads/.opentubex-download-1',
    sendStatus() {},
    saveDownloadRecords: async () => {},
    showAutomaticDownloadNotification: (_, state) => notifications.push(state),
    FINAL_METADATA_PREFIX: '__OPENTUBEX_METADATA__:',
    FINAL_PATH_PREFIX: '__OPENTUBEX_FILE__:',
    DOWNLOAD_STOPPED_ERROR,
    Date,
  })
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

test('a killed download reports that it stopped instead of its progress sentinels', () => {
  const { status } = finishDownload({
    code: null,
    payload: { isPlaylist: true },
    destinations: [],
    stderr: ['__OPENTUBEX_DOWNLOAD__:downloading\t50.0%\t2MiB/s\t00:01', '__OPENTUBEX_PROCESSING__'],
  })
  assert.equal(status.status, 'failed')
  assert.equal(downloadErrorMessage(status.errorMessage, key => key), 'Downloads.Download Stopped Unexpectedly')
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
