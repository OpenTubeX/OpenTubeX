import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/main/ytDlp.js', import.meta.url), 'utf8')
const start = source.indexOf('/** @type {Map<string, { fileKey: string, version: string }>} */')
const end = source.indexOf('\n}\n', source.indexOf('async function getYtDlpVersion(', start)) + 3
assert.ok(start !== -1 && end > start, 'getYtDlpVersion should be found in ytDlp.js')

function createProbe () {
  const calls = []
  const files = new Map()
  const context = vm.createContext({
    stat: async (path) => {
      const info = files.get(path)
      if (!info) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return info
    },
    execFileAsync: async (executable, args) => {
      calls.push([executable, ...args])
      const info = files.get(executable) ?? files.get(`/usr/bin/${executable}`)
      if (info?.broken) throw new Error('spawn failed')
      return { stdout: `${info?.version ?? 'path-version'}\n` }
    },
    process: { platform: 'linux', env: { PATH: '' } },
    delimiter: ':',
    join: (...parts) => parts.join('/')
  })
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.getYtDlpVersion = getYtDlpVersion`, context)
  return { calls, files, context, getYtDlpVersion: context.getYtDlpVersion }
}

test('reuses the yt-dlp version while the binary file is unchanged', async () => {
  const { calls, files, getYtDlpVersion } = createProbe()
  files.set('/bin/yt-dlp', { mtimeMs: 1, size: 100, version: '2026.01.01' })

  assert.equal(await getYtDlpVersion('/bin/yt-dlp'), '2026.01.01')
  assert.equal(await getYtDlpVersion('/bin/yt-dlp'), '2026.01.01')
  assert.equal(calls.length, 1, 'the second lookup must not spawn yt-dlp again')

  files.set('/bin/yt-dlp', { mtimeMs: 2, size: 120, version: '2026.02.02' })
  assert.equal(await getYtDlpVersion('/bin/yt-dlp'), '2026.02.02', 'an updated binary is probed again')
  assert.equal(calls.length, 2)
})

test('does not cache failures or executables that cannot be stat-ed', async () => {
  const { calls, files, getYtDlpVersion } = createProbe()
  files.set('/bin/yt-dlp', { mtimeMs: 1, size: 100, broken: true })

  assert.equal(await getYtDlpVersion('/bin/yt-dlp'), null)
  files.set('/bin/yt-dlp', { mtimeMs: 1, size: 100, version: '2026.01.01' })
  assert.equal(await getYtDlpVersion('/bin/yt-dlp'), '2026.01.01', 'a failed probe is retried')

  assert.equal(await getYtDlpVersion('yt-dlp'), 'path-version')
  assert.equal(await getYtDlpVersion('yt-dlp'), 'path-version')
  assert.equal(calls.filter(([executable]) => executable === 'yt-dlp').length, 2,
    'a bare name that PATH cannot resolve has no file identity, so it is probed each time')
})

test('resolves a bare executable name through PATH so the system binary is cached too', async () => {
  const { calls, context, files, getYtDlpVersion } = createProbe()
  context.process.env.PATH = '/opt/none:/usr/bin'
  files.set('/usr/bin/yt-dlp', { mtimeMs: 1, size: 100, version: '2026.03.03' })

  assert.equal(await getYtDlpVersion('yt-dlp'), '2026.03.03')
  assert.equal(await getYtDlpVersion('yt-dlp'), '2026.03.03')
  assert.equal(calls.length, 1, 'the PATH-resolved binary keys the cache')
})
