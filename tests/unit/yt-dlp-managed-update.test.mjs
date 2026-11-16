import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { createSerialQueue } from '../../src/main/serialQueue.js'
import { getPinnedFfmpegBuild, verifyPinnedFfmpegArchive } from '../../src/main/ffmpegBuilds.js'

const source = readFileSync(new URL('../../src/main/ytDlpBinaries.js', import.meta.url), 'utf8')
const start = source.indexOf('\n/**\n * Downloads the latest yt-dlp release into the user data directory')
const end = source.indexOf('\n/**\n * Downloads the FFmpeg and FFprobe builds pinned in ffmpegBuilds.json', start)
assert.ok(start !== -1 && end > start, 'downloadManagedYtDlp should be found in ytDlpBinaries.js')

test('concurrent managed yt-dlp updates verify against the baseline the previous update committed', async () => {
  let installed = { signedAt: 100 }
  const releases = [
    { signedAt: 300, delay: 0 },
    // an older signed release that arrives late must be compared with 300
    { signedAt: 200, delay: 20 }
  ]
  const installs = []
  const context = vm.createContext({
    settings: { _findOne: async () => ({ value: 'stable' }) },
    YT_DLP_RELEASE_REPOSITORIES: { stable: 'yt-dlp/yt-dlp' },
    getYtDlpAssetName: () => 'yt-dlp_linux',
    getManagedBinaryPath: () => '/managed/yt-dlp',
    getLatestReleaseDownloadUrl: async () => 'https://example.invalid/release',
    readDownloadValidators: async () => ({ ...installed }),
    downloadFile: async () => {
      const release = releases.shift()
      await new Promise(resolve => setTimeout(resolve, release.delay))
      return { data: Buffer.from(String(release.signedAt)), validators: {} }
    },
    fetchBuffer: async () => Buffer.alloc(0),
    verifyYtDlpReleaseAsset: (data, assetName, checksums, signature, minimumSignedAt) => {
      const signedAt = Number(data.toString())
      if (minimumSignedAt !== undefined && signedAt < minimumSignedAt) throw new Error('rollback')
      return signedAt
    },
    installBinariesAtomically: async ([binary], validate) => {
      installs.push(Number(binary.data.toString()))
      return validate()
    },
    getYtDlpVersion: async () => '2026.10.21',
    writeDownloadValidators: async (path, validators) => { installed = { ...validators } },
    broadcastToRenderers: () => {},
    IpcChannels: {},
    process: { platform: 'linux', arch: 'x64' },
    setTimeout,
    enqueueManagedYtDlpUpdate: createSerialQueue()
  })
  vm.runInContext(`${source.slice(start, end).replaceAll('export async function', 'async function').replaceAll('export function', 'function')}
globalThis.downloadManagedYtDlp = downloadManagedYtDlp`, context)

  const results = await Promise.all([context.downloadManagedYtDlp(), context.downloadManagedYtDlp()])
  assert.deepEqual(installs, [300])
  assert.equal(installed.signedAt, 300)
  assert.match(results[1].error, /rollback/)
})

/**
 * @param {boolean} binaryExists
 */
async function downloadUnusableYtDlp(binaryExists) {
  const context = vm.createContext({
    settings: { _findOne: async () => ({ value: 'stable' }) },
    YT_DLP_RELEASE_REPOSITORIES: { stable: 'yt-dlp/yt-dlp' },
    getYtDlpAssetName: () => 'yt-dlp.exe',
    getManagedBinaryPath: () => 'C:\\managed\\yt-dlp.exe',
    getLatestReleaseDownloadUrl: async () => 'https://example.invalid/release',
    readDownloadValidators: async () => null,
    downloadFile: async () => ({ data: Buffer.from('yt-dlp'), validators: {} }),
    fetchBuffer: async () => Buffer.alloc(0),
    verifyYtDlpReleaseAsset: () => 100,
    // the version check must run inside the transaction, so a failure restores the previous binary
    installBinariesAtomically: async (binaries, validate) => validate(),
    getYtDlpVersion: async () => null,
    existsSync: () => binaryExists,
    writeDownloadValidators: async () => {},
    broadcastToRenderers: () => {},
    IpcChannels: {},
    process: { platform: 'win32', arch: 'x64' },
    enqueueManagedYtDlpUpdate: createSerialQueue()
  })
  vm.runInContext(`${source.slice(start, end).replaceAll('export async function', 'async function').replaceAll('export function', 'function')}
globalThis.downloadManagedYtDlp = downloadManagedYtDlp`, context)
  return context.downloadManagedYtDlp()
}

test('a downloaded yt-dlp that antivirus software removed is reported as removed', async () => {
  assert.deepEqual({ ...await downloadUnusableYtDlp(false) }, {
    error: 'The downloaded yt-dlp binary was removed',
    errorCode: 'MANAGED_TOOL_REMOVED'
  })
})

test('a downloaded yt-dlp that cannot run is reported as unusable', async () => {
  assert.deepEqual({ ...await downloadUnusableYtDlp(true) }, {
    error: 'The downloaded yt-dlp binary could not be run',
    errorCode: 'MANAGED_TOOL_UNUSABLE'
  })
})

const ffmpegStart = source.indexOf('\n/**\n * Downloads the FFmpeg and FFprobe builds pinned in ffmpegBuilds.json')
const ffmpegEnd = source.indexOf('\n/**\n * Checks whether the selected managed binary has a newer release', ffmpegStart)
assert.ok(ffmpegStart !== -1 && ffmpegEnd > ffmpegStart, 'downloadManagedFfmpeg should be found in ytDlpBinaries.js')

/**
 * @param {{ platform: string, arch: string, pins: object, installed: string[], archives: Record<string, string> }} options
 */
async function downloadPinnedFfmpeg({ platform, arch, pins, installed, archives }) {
  const downloads = []
  const installs = []
  const context = vm.createContext({
    ffmpegBuilds: pins,
    getPinnedFfmpegBuild,
    verifyPinnedFfmpegArchive,
    getManagedBinaryPath: name => `/managed/${name}`,
    isPinnedFfmpegArchiveInstalled: async path => installed.includes(path),
    downloadFile: async (url) => {
      downloads.push(url)
      return { data: Buffer.from(archives[url]), validators: {} }
    },
    extractZipEntry: async (data, matches) => Buffer.from(['ffmpeg', 'ffprobe', 'dir/bin/ffmpeg.exe', 'dir/bin/ffprobe.exe'].find(matches)),
    installBinariesAtomically: async (binaries, validate) => {
      installs.push(...binaries.map(({ path, data }) => `${path}=${data}`))
      return validate()
    },
    getFfmpegVersion: async () => '9.0',
    getFfprobeVersion: async () => '9.0',
    writeFile: async () => {},
    toErrorResult: error => ({ error: error.message, errorCode: error.code }),
    process: { platform, arch }
  })
  vm.runInContext(`${source.slice(ffmpegStart, ffmpegEnd).replace('export async function', 'async function')}
globalThis.downloadManagedFfmpeg = downloadManagedFfmpeg`, context)

  return { result: { ...await context.downloadManagedFfmpeg() }, downloads, installs }
}

const sha256 = data => createHash('sha256').update(data).digest('hex')

test('managed FFmpeg downloads that do not match their pinned checksum are not installed', async () => {
  const pins = {
    'linux-x64': {
      ffmpeg: { url: 'https://example.invalid/ffmpeg.zip', sha256: sha256('ffmpeg') },
      ffprobe: { url: 'https://example.invalid/ffprobe.zip', sha256: sha256('ffprobe') }
    }
  }
  const { result, downloads, installs } = await downloadPinnedFfmpeg({
    platform: 'linux',
    arch: 'x64',
    pins,
    // FFmpeg is up to date, while the FFprobe archive was tampered with
    installed: ['/managed/ffmpeg'],
    archives: { 'https://example.invalid/ffprobe.zip': 'tampered' }
  })

  assert.equal(result.errorCode, 'MANAGED_TOOL_VERIFICATION_FAILED')
  assert.deepEqual(downloads, ['https://example.invalid/ffprobe.zip'])
  assert.deepEqual(installs, [])
})

test('Windows on Arm installs both binaries from one download of the pinned x64 archive', async () => {
  const archive = { url: 'https://example.invalid/win64.zip', sha256: sha256('win64') }
  const { result, downloads, installs } = await downloadPinnedFfmpeg({
    platform: 'win32',
    arch: 'arm64',
    pins: { 'win32-x64': { ffmpeg: archive, ffprobe: archive } },
    installed: [],
    archives: { [archive.url]: 'win64' }
  })

  assert.deepEqual(result, { version: '9.0', updated: true })
  assert.deepEqual(downloads, [archive.url])
  assert.deepEqual(installs, ['/managed/ffmpeg=dir/bin/ffmpeg.exe', '/managed/ffprobe=dir/bin/ffprobe.exe'])
})

test('systems without a pinned FFmpeg build download nothing', async () => {
  const { result, downloads, installs } = await downloadPinnedFfmpeg({
    platform: 'linux',
    arch: 'ia32',
    pins: { 'linux-x64': {} },
    installed: [],
    archives: {}
  })

  assert.deepEqual(result, { error: 'No FFmpeg build is available for linux ia32', errorCode: undefined })
  assert.deepEqual(downloads, [])
  assert.deepEqual(installs, [])
})

test('every desktop platform has a pinned FFmpeg build from its trusted host', () => {
  const pins = JSON.parse(readFileSync(new URL('../../src/main/ffmpegBuilds.json', import.meta.url), 'utf8'))
  const hosts = {
    darwin: 'https://ffmpeg.martin-riedl.de/download/',
    linux: 'https://ffmpeg.martin-riedl.de/download/',
    win32: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/'
  }

  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      for (const { url, sha256 } of Object.values(getPinnedFfmpegBuild(pins, platform, arch))) {
        assert.ok(url.startsWith(hosts[platform]), url)
        assert.match(sha256, /^[\da-f]{64}$/)
      }
    }
  }
})
