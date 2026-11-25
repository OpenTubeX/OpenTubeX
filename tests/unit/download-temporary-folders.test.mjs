import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/main/ytDlpDownloads.js', import.meta.url), 'utf8')
const start = source.indexOf('const TEMPORARY_FOLDER_PREFIX')
const end = source.indexOf('\n}\n', source.indexOf('async function removeStaleTemporaryDownloadFolders(')) + 3

/** The PID of a process that has exited */
function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''])
  return new Promise(resolve => child.once('exit', () => resolve(child.pid)))
}

test('left over temporary download folders are removed, but not ones a running download may use', async t => {
  const root = await mkdtemp(join(tmpdir(), 'opentubex-temporary-folders-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const downloads = join(root, 'downloads')
  const appTemp = join(root, 'temp')
  const outside = join(root, 'outside')
  await Promise.all([downloads, appTemp, outside].map(folder => mkdir(folder)))

  const folder = async (parent, name, owner) => {
    const path = join(parent, name)
    await mkdir(path)
    await writeFile(join(path, 'video.mp4.part'), 'partial')
    if (owner !== undefined) await writeFile(join(path, '.opentubex-owner'), String(owner))
    return path
  }
  const dayAgo = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000
  const deadPid = await exitedPid()
  await folder(downloads, '.opentubex-download-crashed', deadPid)
  await folder(downloads, '.opentubex-download-running', process.pid)
  await folder(appTemp, 'opentubex-download-crashed', deadPid)
  await utimes(await folder(downloads, '.opentubex-download-old-version'), dayAgo, dayAgo)
  await folder(downloads, '.opentubex-download-recent-old-version')
  await folder(downloads, 'Channel')
  await writeFile(join(outside, 'keep'), 'keep')
  await symlink(outside, join(downloads, '.opentubex-download-link'))

  const { removeStaleTemporaryDownloadFolders } = vm.runInNewContext(
    `${source.slice(start, end)}\n({ removeStaleTemporaryDownloadFolders })`,
    { app: { getPath: () => appTemp }, join, readdir, readFile, rm, stat, process, console, Date, Number }
  )
  await removeStaleTemporaryDownloadFolders(downloads)

  assert.deepEqual((await readdir(downloads)).sort(), [
    '.opentubex-download-link', '.opentubex-download-recent-old-version', '.opentubex-download-running', 'Channel',
  ])
  assert.deepEqual(await readdir(appTemp), [])
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'keep')
})
