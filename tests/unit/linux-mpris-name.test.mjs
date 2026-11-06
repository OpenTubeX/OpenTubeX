import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { patchLinuxMprisName } from '../../_scripts/patchLinuxMprisName.mjs'

const chromiumMprisServiceName =
  'org.mpris.MediaPlayer2.chromium.instance%i'
const opentubexMprisServiceName =
  'org.mpris.MediaPlayer2.opentubex.instanc%i'

const createContext = (appOutDir, electronPlatformName = 'linux') => ({
  appOutDir,
  electronPlatformName,
  packager: {
    executableName: 'opentubex',
  },
})

test('uses an OpenTubeX-specific MPRIS name in Linux packages', async (t) => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'opentubex-mpris-'))
  t.after(() => rm(appOutDir, { force: true, recursive: true }))

  const executablePath = join(appOutDir, 'opentubex')
  const original = Buffer.from(`prefix${chromiumMprisServiceName}suffix`)
  await writeFile(executablePath, original)

  await patchLinuxMprisName(createContext(appOutDir))

  const patched = await readFile(executablePath)
  assert.equal(patched.length, original.length)
  assert.equal(patched.includes(chromiumMprisServiceName), false)
  assert.equal(patched.includes(opentubexMprisServiceName), true)
})

test('does not modify packages for other platforms', async (t) => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'opentubex-mpris-'))
  t.after(() => rm(appOutDir, { force: true, recursive: true }))

  const executablePath = join(appOutDir, 'opentubex')
  const original = Buffer.from(chromiumMprisServiceName)
  await writeFile(executablePath, original)

  await patchLinuxMprisName(createContext(appOutDir, 'win32'))

  assert.deepEqual(await readFile(executablePath), original)
})

test('fails if Electron changes its MPRIS service name', async (t) => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'opentubex-mpris-'))
  t.after(() => rm(appOutDir, { force: true, recursive: true }))

  await writeFile(join(appOutDir, 'opentubex'), 'no MPRIS service name')

  await assert.rejects(
    patchLinuxMprisName(createContext(appOutDir)),
    /Could not find Chromium's MPRIS service name/
  )
})
