import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createKwinScriptFile,
  createKwinWindowOwnerCheck,
  getKwinScriptBaseDirectory,
  getKwinScriptPluginName,
  getKwinWindowOwner,
  isKwinWindowOwnedBy,
} from '../../src/main/kwinScripts.js'

const flatpak = { FLATPAK_ID: 'org.opentubex.OpenTubeX', XDG_RUNTIME_DIR: '/run/user/1000' }

test('identifies windows by process ID outside Flatpak and by app ID inside', () => {
  assert.deepEqual(getKwinWindowOwner({}, 1234), { processId: 1234, flatpakId: null })
  assert.deepEqual(getKwinWindowOwner(flatpak, 2), { processId: null, flatpakId: 'org.opentubex.OpenTubeX' })
  assert.equal(getKwinScriptPluginName('opentubex-test', getKwinWindowOwner({}, 1234)), 'opentubex-test-1234')
  assert.equal(getKwinScriptPluginName('opentubex-test', getKwinWindowOwner(flatpak, 2)), 'opentubex-test-org.opentubex.OpenTubeX')
})

test('matches KWin D-Bus window info to the owner', () => {
  const nativeOwner = getKwinWindowOwner({}, 1234)
  const flatpakOwner = getKwinWindowOwner(flatpak, 2)
  assert.equal(isKwinWindowOwnedBy({ pid: 1234, desktopFile: 'opentubex' }, nativeOwner), true)
  assert.equal(isKwinWindowOwnedBy({ pid: 99, desktopFile: 'opentubex' }, nativeOwner), false)
  // KWin reports the host PID, never the sandbox's
  assert.equal(isKwinWindowOwnedBy({ pid: 9001, desktopFile: 'org.opentubex.OpenTubeX' }, flatpakOwner), true)
  assert.equal(isKwinWindowOwnedBy({ pid: 2, desktopFile: 'opentubex' }, flatpakOwner), false)
})

test('the KWin window check matches windows of the owner', () => {
  const main = { pid: 9001, desktopFileName: 'org.opentubex.OpenTubeX' }
  const pictureInPicture = { pid: 9001, desktopFileName: '' }
  const other = { pid: 7, desktopFileName: '' }
  const sandboxPid = { pid: 2, desktopFileName: '' }
  const workspace = { windowList: () => [main, pictureInPicture, other, sandboxPid] }
  const check = owner => new Function('workspace', `return ${createKwinWindowOwnerCheck(owner)}`)(workspace)

  const inFlatpak = check(getKwinWindowOwner(flatpak, 2))
  assert.deepEqual([main, pictureInPicture, other, sandboxPid].map(inFlatpak), [true, true, false, false])
  const outside = check(getKwinWindowOwner({}, 7))
  assert.deepEqual([main, pictureInPicture, other, sandboxPid].map(outside), [false, false, true, false])
})

test('puts scripts where KWin outside the sandbox can read them', () => {
  assert.equal(getKwinScriptBaseDirectory(flatpak), '/run/user/1000/app/org.opentubex.OpenTubeX')
  assert.equal(getKwinScriptBaseDirectory({}), tmpdir())
  assert.equal(getKwinScriptBaseDirectory({ FLATPAK_ID: 'org.opentubex.OpenTubeX' }), tmpdir())
})

test('writes, rewrites and removes a script file in its own directory', async t => {
  const runtime = await mkdtemp(path.join(tmpdir(), 'opentubex-runtime-'))
  t.after(() => rm(runtime, { force: true, recursive: true }))
  const shared = path.join(runtime, 'app', 'org.opentubex.OpenTubeX')
  await mkdir(shared, { recursive: true })

  const file = await createKwinScriptFile('test.js', { FLATPAK_ID: 'org.opentubex.OpenTubeX', XDG_RUNTIME_DIR: runtime })
  assert.equal(path.basename(file.path), 'test.js')
  assert.equal(path.dirname(path.dirname(file.path)), shared)
  await file.write('first')
  await file.write('second')
  assert.equal(await readFile(file.path, 'utf8'), 'second')

  await file.remove()
  assert.deepEqual(await readdir(shared), [])
  // Removing twice, as cleanup after a failed close does, is harmless
  await file.remove()
})
