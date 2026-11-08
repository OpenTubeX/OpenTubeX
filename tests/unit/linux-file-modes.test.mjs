import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { removeLinuxGroupOtherWrite } from '../../_scripts/linuxFileModes.mjs'

const mode = async (path) => (await stat(path)).mode & 0o7777

const createApp = async (t) => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'opentubex-modes-'))
  t.after(() => rm(appOutDir, { force: true, recursive: true }))

  // Electron 44.10 Linux zips store these modes.
  await mkdir(join(appOutDir, 'locales'))
  await writeFile(join(appOutDir, 'opentubex'), '')
  await writeFile(join(appOutDir, 'locales', 'en-US.pak'), '')
  await chmod(join(appOutDir, 'opentubex'), 0o777)
  await chmod(join(appOutDir, 'locales', 'en-US.pak'), 0o666)
  await chmod(join(appOutDir, 'locales'), 0o777)
  return appOutDir
}

test('removes group and other write access from Linux packages', async (t) => {
  const appOutDir = await createApp(t)
  await symlink('opentubex', join(appOutDir, 'link'))

  await removeLinuxGroupOtherWrite({ appOutDir, electronPlatformName: 'linux' })

  assert.equal(await mode(join(appOutDir, 'opentubex')), 0o755)
  assert.equal(await mode(join(appOutDir, 'locales', 'en-US.pak')), 0o644)
  assert.equal(await mode(join(appOutDir, 'locales')), 0o755)
  assert.equal((await lstat(join(appOutDir, 'link'))).isSymbolicLink(), true)
})

test('leaves other platforms unchanged', async (t) => {
  const appOutDir = await createApp(t)

  await removeLinuxGroupOtherWrite({ appOutDir, electronPlatformName: 'darwin' })

  assert.equal(await mode(join(appOutDir, 'opentubex')), 0o777)
})
