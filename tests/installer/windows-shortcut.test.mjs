// Linux prerequisites: Wine, xdotool and Xvfb. Run on a private display:
// xvfb-run -a pnpm exec node --test tests/installer/windows-shortcut.test.mjs
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { Arch, build, Platform } from 'electron-builder'
import config from '../../_scripts/ebuilder.config.mjs'
import { prepareWindowsInstallerTranslations } from '../../_scripts/windowsInstallerTranslations.mjs'

const exec = promisify(execFile)
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitFor (probe) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await delay(100)
  }
  throw new Error('Installer did not reach the expected state within 60 seconds')
}

async function exists (path) {
  return access(path).then(() => true, () => false)
}

test('compiled Windows installer preserves the desktop shortcut choice', { timeout: 300000 }, async t => {
  assert.equal(process.platform, 'linux', 'Run this Wine regression test on Linux')
  assert.ok(process.env.DISPLAY, 'Run this test using xvfb-run on a private display')
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-installer-test-'))
  const prefix = join(directory, 'wine')
  const env = {
    ...process.env,
    WINEPREFIX: prefix,
    WINEDEBUG: '-all',
    WINEDLLOVERRIDES: 'winemenubuilder.exe=d',
    XDG_DATA_HOME: join(directory, 'xdg-data'),
    XDG_CONFIG_HOME: join(directory, 'xdg-config'),
    XDG_CACHE_HOME: join(directory, 'xdg-cache')
  }
  const run = (command, args) => {
    if (command === 'xdotool') return exec(command, args, { env, timeout: 60000 })
    // Wine's persistent server can inherit pipes after its parent has exited.
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'], timeout: 60000 })
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
    })
  }
  const children = new Set()
  t.after(async () => {
    await run('wineserver', ['-k']).catch(() => {})
    for (const child of children) child.kill()
    await rm(directory, { recursive: true, force: true })
  })

  // Prevent Wine from linking its desktop/documents to the user's real folders.
  for (const folder of ['Desktop', 'Documents', 'Downloads']) {
    await mkdir(join(prefix, 'drive_c/users', userInfo().username, folder), { recursive: true })
  }
  await run('wineserver', ['-p'])
  await run('wineboot', ['-u'])
  const resources = join(directory, 'resources')
  await mkdir(join(directory, 'app/resources'), { recursive: true })
  await writeFile(join(directory, 'app/OpenTubeX.exe'), 'installer regression fixture')
  await prepareWindowsInstallerTranslations({
    electronPlatformName: 'win32',
    packager: { projectDir: process.cwd(), info: { buildResourcesDir: resources } }
  })

  // Observe the real finish checkbox without changing its initialization/actions.
  const stateFile = join(directory, 'finish-state.txt')
  const source = await readFile(config.nsis.include, 'utf8')
  const observer = `
    Push $0
    Push $1
    SendMessage $mui.FinishPage.ShowReadme \${BM_GETCHECK} 0 0 $0
    FileOpen $1 "Z:${stateFile.replaceAll('/', '\\')}" w
    FileWrite $1 "$0$\\r$\\n$newDesktopLink$\\r$\\n$INSTDIR"
    FileClose $1
    Pop $1
    Pop $0
`
  const observed = source.replace(/(Function OpenTubeXFinishPageShow[\s\S]*?)( {2}FunctionEnd)/,
    (_, body, end) => body + observer + end)
  assert.notEqual(observed, source, 'The finish-page observer must be installed')
  const include = join(directory, 'fixture.nsh')
  // Wine tasklist reports false positives; only the fixture disables that check.
  await writeFile(include, '!macro customCheckAppRunning\n!macroend\n' + observed)
  async function buildInstaller (nsis, output) {
    const artifacts = await build({
      projectDir: process.cwd(),
      prepackaged: join(directory, 'app'),
      targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
      config: {
        ...config,
        // electron-builder normalizes this array in place on each build.
        files: [...config.files],
        directories: { output: join(directory, output), buildResources: resources },
        win: { icon: resolve('_icons/icon.ico'), signAndEditExecutable: false },
        nsis: { ...nsis, runAfterFinish: false },
        publish: null
      }
    })
    const installer = artifacts.find(path => path.endsWith('.exe'))
    assert.ok(installer)
    return installer
  }
  const installer = await buildInstaller({ ...config.nsis, include }, 'current')
  const previousInclude = join(directory, 'previous.nsh')
  await writeFile(previousInclude, '!macro customCheckAppRunning\n!macroend\n')
  // Published v0.36.0-beta NSIS defaults, including its original uninstaller.
  const previousInstaller = await buildInstaller({
    oneClick: false, allowToChangeInstallationDirectory: true, include: previousInclude
  }, 'previous')
  const toUnix = path => join(prefix, 'drive_c', ...path.slice(3).split('\\'))
  let desktopLink
  let installDirectory

  async function install (checked, toggle = false, args = ['/currentuser']) {
    await rm(stateFile, { force: true })
    const child = spawn('wine', [installer, ...args], { env, stdio: 'ignore' })
    children.add(child)
    child.on('exit', () => children.delete(child))
    const window = await waitFor(async () => {
      const result = await run('xdotool', ['search', '--onlyvisible', '--name', '^OpenTubeX Setup']).catch(() => null)
      return result && result.stdout.trim().split('\n').at(-1)
    })
    await delay(200)
    await run('xdotool', ['key', '--window', window, 'alt+i'])
    await waitFor(() => exists(stateFile))
    const [state, link, location] = (await readFile(stateFile, 'utf8')).split('\r\n')
    desktopLink = toUnix(link)
    installDirectory = location
    await delay(200)
    // With runAfterFinish disabled, the desktop checkbox starts focused.
    await run('xdotool', ['windowfocus', '--sync', window])
    await run('xdotool', ['key', ...(toggle ? ['space'] : []), 'Tab', 'Return'])
    await waitFor(async () => !(await run('xdotool', ['search', '--name', '^OpenTubeX Setup']).catch(() => null)))
    assert.equal(state, checked ? '1' : '0')
  }

  const silentUpdate = (...args) => run('wine', [installer, '/S', '/currentuser', ...args])
  const uninstall = scope => run('wine', [
    toUnix(`${installDirectory}\\Uninstall OpenTubeX.exe`), '/S', scope, `_?=${installDirectory}`
  ])

  await t.test('fresh installs leave an unrelated same-named desktop file untouched', async () => {
    const unrelatedLink = join(prefix, 'drive_c/users', userInfo().username, 'Desktop/OpenTubeX.lnk')
    const contents = Buffer.from('Unrelated user-created shortcut')
    await writeFile(unrelatedLink, contents)
    try {
      await install(false)
      assert.deepEqual(await readFile(unrelatedLink), contents)
      await silentUpdate('--updated')
      assert.deepEqual(await readFile(unrelatedLink), contents)
      await install(false)
      assert.deepEqual(await readFile(unrelatedLink), contents)
      await uninstall('/currentuser')
      assert.deepEqual(await readFile(unrelatedLink), contents)
    } finally {
      await rm(unrelatedLink, { force: true })
    }
  })
  await t.test('the first automatic upgrade preserves shortcuts from the previous installer', async () => {
    await run('wine', [previousInstaller, '/S', '/currentuser'])
    assert.equal(await exists(desktopLink), true)
    await appendFile(desktopLink, 'previous installer shortcut preservation marker')
    const before = await readFile(desktopLink)
    await silentUpdate('--updated')
    assert.ok((await readFile(desktopLink)).equals(before), 'The first automatic upgrade must preserve shortcut bytes')
    await uninstall('/currentuser')
  })
  await t.test('the first manual and automatic upgrades preserve deleted shortcuts', async () => {
    for (const automatic of [false, true]) {
      await run('wine', [previousInstaller, '/S', '/currentuser'])
      assert.equal(await exists(desktopLink), true)
      await rm(desktopLink)
      if (automatic) await silentUpdate('--updated')
      else await install(false)
      assert.equal(await exists(desktopLink), false)
      await uninstall('/currentuser')
    }
  })
  await t.test('fresh install and silent update leave the desktop empty', async () => {
    await install(false)
    assert.equal(await exists(desktopLink), false)
    await silentUpdate('--updated')
    assert.equal(await exists(desktopLink), false)
  })
  await t.test('the command-line opt-out overrides a checked checkbox', async () => {
    await install(false, true, ['/currentuser', '--no-desktop-shortcut'])
    assert.equal(await exists(desktopLink), false)
  })
  await t.test('opting in creates a shortcut and automatic updates leave its contents intact', async () => {
    await install(false, true)
    assert.equal(await exists(desktopLink), true)
    // A marker makes any rewrite observable, even with identical default fields.
    await appendFile(desktopLink, 'shortcut preservation marker')
    const before = await readFile(desktopLink)
    await silentUpdate('--updated')
    assert.ok((await readFile(desktopLink)).equals(before), 'Automatic updates must preserve existing shortcut bytes')
    await install(true, false, ['/currentuser', '--updated'])
    assert.ok((await readFile(desktopLink)).equals(before), 'An untouched checkbox must preserve existing shortcut bytes')
  })
  await t.test('an existing shortcut checks the checkbox; unchecking removes it', async () => {
    await install(true, true)
    assert.equal(await exists(desktopLink), false)
  })
  await t.test('deleted shortcuts stay deleted during manual and silent updates', async () => {
    await install(false, true)
    await rm(desktopLink)
    await silentUpdate()
    assert.equal(await exists(desktopLink), false)
    await install(false)
    assert.equal(await exists(desktopLink), false)
  })
  await t.test('uninstall removes an opted-in shortcut', async () => {
    await install(false, true)
    await uninstall('/currentuser')
    assert.equal(await exists(desktopLink), false)
  })
  await t.test('all-users installs also track the chosen scope and custom directory', async () => {
    const currentUserLink = desktopLink
    await install(false, true, ['/allusers', '/D=C:\\InstallerScopeTest\\OpenTubeX'])
    assert.equal(installDirectory, 'C:\\InstallerScopeTest\\OpenTubeX')
    assert.notEqual(desktopLink, currentUserLink)
    const allUsersLink = desktopLink
    assert.equal(await exists(desktopLink), true)
    await install(true, false, ['/allusers'])
    assert.equal(installDirectory, 'C:\\InstallerScopeTest\\OpenTubeX')
    assert.equal(desktopLink, allUsersLink)
    await uninstall('/allusers')
    assert.equal(await exists(desktopLink), false)
  })
})
