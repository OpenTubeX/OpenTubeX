// Linux prerequisites: Wine and Xvfb. Run on a private display:
// xvfb-run -a pnpm exec node --test tests/installer/windows-resource-path.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { getMakeNsisPath } = builderRequire('app-builder-lib/out/toolsets/windows.js')

test('the Windows NSIS compiler can include installer resources', { timeout: 90000 }, async t => {
  assert.equal(process.platform, 'linux', 'Run this Wine regression test on Linux')
  assert.ok(process.env.DISPLAY, 'Run this test using xvfb-run on a private display')
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-nsis-path-'))
  const prefix = join(directory, 'wine')
  const env = {
    ...process.env,
    WINEPREFIX: prefix,
    WINEDEBUG: '-all',
    WINEDLLOVERRIDES: 'winemenubuilder.exe=d'
  }
  const run = (command, args) => new Promise((resolve, reject) => {
    // Wine's persistent server can inherit pipes after its parent has exited.
    const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'], timeout: 60000 })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
  t.after(async () => {
    await run('wineserver', ['-k']).catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  // Keep Wine's user folders separate from the real desktop/documents.
  for (const folder of ['Desktop', 'Documents', 'Downloads']) {
    await mkdir(join(prefix, 'drive_c/users', userInfo().username, folder), { recursive: true })
  }
  const { path: compiler } = await getMakeNsisPath()
  const windowsCompiler = join(dirname(dirname(compiler)), 'Bin/makensis.exe')
  const toWindows = path => 'Z:' + path.replaceAll('/', '\\')
  const source = await readFile('_scripts/windowsInstaller.nsh', 'utf8')
  const include = source.split('\n').find(line => line.includes('!include') && line.includes('installer-translations.nsh'))
  assert.ok(include, 'Exercise the actual custom installer resource include')
  await writeFile(join(directory, 'installer-translations.nsh'), '!define fixtureLabel "fixture"\n')
  const script = join(directory, 'fixture.nsi')
  await writeFile(script, [
    `!define BUILD_RESOURCES_DIR "${toWindows(directory)}"`,
    include,
    'Name "Installer resource fixture"',
    `OutFile "${toWindows(join(directory, 'fixture.exe'))}"`,
    'Section',
    'SectionEnd'
  ].join('\n'))
  await run('wine', [windowsCompiler, '-V2', toWindows(script)])
  assert.ok((await readFile(join(directory, 'fixture.exe'))).length > 0)
})
