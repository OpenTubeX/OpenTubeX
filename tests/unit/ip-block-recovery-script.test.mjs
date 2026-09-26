import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'
import test from 'node:test'
import { IpcChannels } from '../../src/constants.js'
import { createIpBlockRecoveryScriptRunner, registerIpBlockRecoveryIpc } from '../../src/main/ipBlockRecoveryIpc.js'

function loadRunner(platform, spawn, fileStat = async () => ({ isFile: () => true })) {
  let savedPath
  const execute = createIpBlockRecoveryScriptRunner({
    path: platform === 'win32' ? path.win32 : path.posix,
    platform,
    systemRoot: 'C:\\Windows',
    spawn,
    stat: fileStat,
    settings: { _findOne: async (key) => {
      assert.equal(key, 'videoIpBlockScriptPath')
      return { value: savedPath }
    } }
  })
  return (scriptPath, configuredPath = scriptPath) => {
    savedPath = configuredPath
    return execute(scriptPath)
  }
}

function captureSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args: Array.from(args), options })
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0, null))
    return child
  }
}

for (const filename of ['recover & calc.bat', 'recover%PATH%.cmd', 'recover!PATH!.bat', 'recover".bat', 'recover\n.bat']) {
  test(`rejects shell syntax in Windows batch path ${JSON.stringify(filename)}`, async () => {
    const calls = []
    const run = loadRunner('win32', captureSpawn(calls))
    await assert.rejects(run(`C:\\scripts\\${filename}`))
    assert.equal(calls.length, 0)
  })
}

for (const [extension, executable, expectedArgs] of [
  ['bat', 'cmd.exe', ['/d', '/v:off', '/s', '/c', '""C:\\My Scripts\\recover.bat""']],
  ['cmd', 'cmd.exe', ['/d', '/v:off', '/s', '/c', '""C:\\My Scripts\\recover.cmd""']],
  ['ps1', 'WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'C:\\My Scripts\\recover.ps1']],
  ['vbs', 'cscript.exe', ['//Nologo', 'C:\\My Scripts\\recover.vbs']],
  ['exe', null, []]
]) {
  test(`runs Windows ${extension} files with explicit arguments and no implicit shell`, async () => {
    const calls = []
    const run = loadRunner('win32', captureSpawn(calls))
    const script = `C:\\My Scripts\\recover.${extension}`
    const result = await run(script)
    assert.equal(result.exitCode, 0)
    assert.equal(calls[0].command, executable ? `C:\\Windows\\System32\\${executable}` : script)
    assert.deepEqual(calls[0].args, expectedArgs)
    assert.equal(calls[0].options.shell, false)
    assert.equal(calls[0].options.windowsVerbatimArguments, extension === 'bat' || extension === 'cmd')
  })
}

test('rejects missing files and directories before spawning', async () => {
  const calls = []
  await assert.rejects(loadRunner('linux', captureSpawn(calls), async () => { throw new Error('ENOENT') })('/missing'))
  await assert.rejects(loadRunner('linux', captureSpawn(calls), async () => ({ isFile: () => false }))('/directory'))
  assert.equal(calls.length, 0)
})

test('executes a literal Unix filename containing spaces and shell syntax', { skip: process.platform === 'win32' }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-recovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const script = path.join(directory, 'recover ; echo injected.sh')
  await writeFile(script, '#!/bin/sh\nprintf recovered\nprintf diagnostic >&2\nexit 7\n', { mode: 0o700 })
  const result = await loadRunner(process.platform, cp.spawn, stat)(script)
  assert.equal(result.stdout, 'recovered')
  assert.equal(result.stderr, 'diagnostic')
  assert.equal(result.exitCode, 7)
})

test('only executes the recovery script configured in saved settings', async () => {
  const calls = []
  const run = loadRunner('linux', captureSpawn(calls))
  await assert.rejects(run('/attacker/script.sh', '/saved/recovery.sh'))
  await assert.rejects(run('/attacker/script.sh', ''))
  await assert.rejects(run('/attacker/script.sh', 42))
  assert.equal(calls.length, 0)
  await run('/saved/recovery.sh', '/saved/recovery.sh')
  assert.equal(calls[0].command, '/saved/recovery.sh')
})

test('recovery IPC shares one active attempt and ignores untrusted callers', async () => {
  const handlers = new Map()
  let release
  let runs = 0
  const recovery = registerIpBlockRecoveryIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    executeScript: () => { runs += 1; return new Promise(resolve => { release = resolve }) },
    cooldownMs: 0
  })
  const trusted = { senderFrame: { url: 'app://bundle/index.html' } }
  const untrusted = { senderFrame: { url: 'https://example.com' } }
  assert.equal(handlers.get(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT)(untrusted, '/recover.sh'), false)
  assert.equal(handlers.get(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT)(trusted, '/recover.sh'), true)
  assert.equal(handlers.get(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT)(trusted, '/recover.sh'), false)
  assert.equal(runs, 1)
  const pending = handlers.get(IpcChannels.EXECUTE_IP_BLOCK_RECOVERY_SCRIPT)(trusted, '/recover.sh')
  release({ exitCode: 0 })
  assert.deepEqual(await pending, { exitCode: 0 })
  assert.equal(await handlers.get(IpcChannels.WAIT_FOR_IP_BLOCK_RECOVERY_SCRIPT)(trusted), undefined)
  assert.equal(runs, 1)
  assert.ok(recovery.getActivePromise())
})

test('recovery IPC chooses a script file with the platform filter', async () => {
  const handlers = new Map()
  let options
  registerIpBlockRecoveryIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    executeScript: async () => {},
    app: { getPath: () => '/home/user' },
    BrowserWindow: { fromWebContents: () => null },
    dialog: { showOpenDialog: async value => { options = value; return { canceled: false, filePaths: ['/scripts/recover.sh'] } } },
    platform: 'linux'
  })
  const choose = handlers.get(IpcChannels.CHOOSE_IP_BLOCK_RECOVERY_SCRIPT)
  assert.equal(await choose({ senderFrame: { url: 'https://example.com' } }, '/tmp'), undefined)
  assert.equal(await choose({ senderFrame: { url: 'app://bundle/index.html' }, sender: {} }), '/scripts/recover.sh')
  assert.equal(options.defaultPath, '/home/user')
  assert.deepEqual(options.filters[0], { name: 'Shell Script Files', extensions: ['sh'] })
})
