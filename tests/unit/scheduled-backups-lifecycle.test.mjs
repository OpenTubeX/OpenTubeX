import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const start = source.indexOf("  app.on('window-all-closed',")
const events = source.slice(start, source.indexOf('  function handleQuit()', start))
const handleQuit = source.match(/  function handleQuit\(\) {[\s\S]*?^  }/m)[0]
const cleanup = source.slice(source.indexOf('  async function cleanUpResources()'), source.indexOf('  // MacOS event'))

function lifecycle(platform) {
  const handlers = new Map()
  const calls = []
  const context = vm.createContext({
    app: { on: (event, handler) => handlers.set(event, handler), quit: () => calls.push('quit') },
    process: { platform },
    mainWindow: {},
    trayWindows: [],
    keepRefreshingInBackground: false,
    ensureBackgroundTray: () => calls.push('tray'),
    backgroundSubscriptions: { setBackground: async () => calls.push('background') },
    isQuitting: false,
    clearInterval: () => calls.push('clear timer'),
    scheduledBackupTimer: {},
    scheduledBackups: { stop: async () => calls.push('stop backups') },
    windowSessionWrites: new Set(),
    trayIconWrite: Promise.resolve(),
    updateWatchQueue: async () => {},
    baseHandlers: { compactAllDatastores: async () => {} },
    shutdownYtDlpDownloads: async () => {},
    session: { defaultSession: { clearCache: async () => {}, clearStorageData: async () => {} } },
  })
  vm.runInContext(`let resourcesCleanUpDone = false; let resourcesCleanUpPromise = null; ${events}\n${handleQuit}\n${cleanup}`, context)
  return { handlers, calls, context }
}

test('macOS keeps scheduled backups running after the last window closes and stops them on application quit', async () => {
  const { handlers, calls, context } = lifecycle('darwin')
  handlers.get('window-all-closed')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [])
  assert.equal(context.mainWindow, null)

  context.isQuitting = true
  handlers.get('will-quit')({ preventDefault: () => calls.push('wait for cleanup') })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['wait for cleanup', 'clear timer', 'stop backups', 'quit'])
})

test('Linux stops scheduled backups and exits after the last window closes', async () => {
  const { handlers, calls } = lifecycle('linux')
  handlers.get('window-all-closed')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['clear timer', 'stop backups', 'quit'])
})

for (const platform of ['linux', 'win32']) {
  test(`${platform} Quit from windowless background mode waits for the active backup`, async () => {
    const { handlers, calls, context } = lifecycle(platform)
    const finished = Promise.withResolvers()
    context.scheduledBackups.stop = async () => { calls.push('stop backups'); await finished.promise }
    context.keepRefreshingInBackground = true
    handlers.get('window-all-closed')()
    assert.deepEqual(calls, ['tray', 'background'])
    assert.equal(context.mainWindow, null)
    context.isQuitting = true
    const quit = handlers.get('will-quit')
    assert.equal(typeof quit, 'function')
    quit({ preventDefault: () => calls.push('wait for cleanup') })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, ['tray', 'background', 'wait for cleanup', 'clear timer', 'stop backups'])
    finished.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, ['tray', 'background', 'wait for cleanup', 'clear timer', 'stop backups', 'quit'])
    quit({ preventDefault: () => assert.fail('completed cleanup must allow Quit') })
  })
}

for (const platform of ['linux', 'win32', 'darwin']) {
  test(`${platform} overlapping window closure and Quit share backup cleanup`, async () => {
    const { handlers, calls, context } = lifecycle(platform)
    const finished = Promise.withResolvers()
    context.isQuitting = true
    context.scheduledBackups.stop = async () => { calls.push('stop backups'); await finished.promise }
    handlers.get('window-all-closed')()
    handlers.get('will-quit')({ preventDefault() {} })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, ['clear timer', 'stop backups'])
    finished.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, ['clear timer', 'stop backups', 'quit'])
  })
}
