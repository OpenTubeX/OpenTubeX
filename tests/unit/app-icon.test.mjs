import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function imageFrom(data) {
  const image = {
    isEmpty: () => data === null,
    toPNG: () => data,
    getSize: () => ({ width: 512, height: 512 }),
    resize: () => image,
  }
  return image
}

let root
const shortcuts = new Map()
let rejectedWrites = 0
globalThis.appIconTestElectron = {
  app: { getPath: name => join(root, name) },
  BrowserWindow: { getAllWindows: () => [] },
  nativeImage: {
    createEmpty: () => imageFrom(null),
    createFromBuffer: imageFrom,
    createFromDataURL: url => imageFrom(Buffer.from(url.split(',')[1], 'base64')),
    createFromPath: file => imageFrom(existsSync(file) ? readFileSync(file) : null),
  },
  shell: {
    readShortcutLink: file => ({ ...shortcuts.get(file) }),
    writeShortcutLink: (file, operation, details) => {
      if (rejectedWrites > 0) {
        rejectedWrites--
        return false
      }
      shortcuts.set(file, { ...shortcuts.get(file), ...details })
      return true
    },
  },
}
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== 'electron') return nextResolve(specifier, context)
    const source = ['app', 'BrowserWindow', 'nativeImage', 'shell']
      .map(name => `export const ${name} = globalThis.appIconTestElectron.${name}`)
      .join('\n')
    return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
  }
})
const { createAppIconManager } = await import('../../src/main/appIcon.js')
hooks.deregister()

test('app icon shortcut updates that fail are retried for the same icon', async t => {
  root = await mkdtemp(join(tmpdir(), 'app-icon-'))
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const appData = process.env.APPDATA
  t.after(async () => {
    Object.defineProperty(process, 'platform', platform)
    if (appData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = appData
    await rm(root, { recursive: true, force: true })
  })
  t.mock.method(console, 'error', () => {})
  Object.defineProperty(process, 'platform', { value: 'win32' })
  process.env.APPDATA = join(root, 'AppData')
  const userDataPath = join(root, 'UserData')
  const executablePath = join(root, 'App', 'OpenTubeX.exe')
  const pinnedDirectory = join(process.env.APPDATA, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  const shortcutPath = join(pinnedDirectory, 'OpenTubeX.lnk')
  await mkdir(userDataPath, { recursive: true })
  await mkdir(pinnedDirectory, { recursive: true })
  await writeFile(shortcutPath, '')
  shortcuts.set(shortcutPath, { target: executablePath, icon: '', iconIndex: 0 })
  const icon = `data:image/png;base64,${Buffer.from('chosen icon').toString('base64')}`
  const shortcutIcon = () => shortcuts.get(shortcutPath).icon

  const appIcon = createAppIconManager({ userDataPath, defaultIconPath: '', executablePath })
  rejectedWrites = 1
  await appIcon.set(icon)
  assert.equal(shortcutIcon(), '')
  await appIcon.set(icon)
  assert.match(shortcutIcon(), /app-icon-[\da-f]{16}\.ico$/)

  // An installer or update resets the shortcut, and the startup repair fails.
  shortcuts.set(shortcutPath, { target: executablePath, icon: '', iconIndex: 0 })
  const restarted = createAppIconManager({ userDataPath, defaultIconPath: '', executablePath })
  rejectedWrites = 1
  restarted.restore()
  await restarted.flush()
  assert.equal(shortcutIcon(), '')
  await restarted.set(icon)
  assert.match(shortcutIcon(), /app-icon-[\da-f]{16}\.ico$/)
})
