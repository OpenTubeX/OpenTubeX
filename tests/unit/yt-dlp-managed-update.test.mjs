import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/main/ytDlpBinaries.js', import.meta.url), 'utf8')
const start = source.indexOf('\n/**\n * Downloads the latest yt-dlp release into the user data directory')
const end = source.indexOf('\n/**\n * Downloads up-to-date FFmpeg and FFprobe builds', start)
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
    installBinary: async (data) => { installs.push(Number(data.toString())) },
    getYtDlpVersion: async () => '2026.10.21',
    writeDownloadValidators: async (path, validators) => { installed = { ...validators } },
    broadcastToRenderers: () => {},
    IpcChannels: {},
    process: { platform: 'linux', arch: 'x64' },
    setTimeout,
    managedYtDlpUpdateQueue: Promise.resolve()
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
    installBinary: async () => {},
    getYtDlpVersion: async () => null,
    existsSync: () => binaryExists,
    writeDownloadValidators: async () => {},
    broadcastToRenderers: () => {},
    IpcChannels: {},
    process: { platform: 'win32', arch: 'x64' },
    managedYtDlpUpdateQueue: Promise.resolve()
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
