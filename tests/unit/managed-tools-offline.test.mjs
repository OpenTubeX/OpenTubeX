import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRequestFailure } from '../../src/renderer/helpers/api/requestDiagnostics.js'
import { createNetworkRecovery } from '../../src/renderer/helpers/networkRecovery.js'
import { createManagedExternalSoftwareController, resolveManagedToolsCapabilities } from '../../src/renderer/helpers/managedExternalSoftware.js'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

test('managed tool capabilities match the runtime that owns the native binaries', () => {
  assert.deepEqual(resolveManagedToolsCapabilities({ isElectron: true, isCapacitor: false }), {
    supportsManagedTools: true,
    requiresManagedYtDlp: false,
    supportsManagedFfmpeg: true,
  })
  assert.deepEqual(resolveManagedToolsCapabilities({ isElectron: false, isCapacitor: true }), {
    supportsManagedTools: true,
    requiresManagedYtDlp: true,
    supportsManagedFfmpeg: false,
  })
  assert.deepEqual(resolveManagedToolsCapabilities({ isElectron: false, isCapacitor: false }), {
    supportsManagedTools: false,
    requiresManagedYtDlp: false,
    supportsManagedFfmpeg: false,
  })
})

for (const platform of [
  { isElectron: true, isCapacitor: false, expected: ['yt-dlp', 'ffmpeg'] },
  { isElectron: false, isCapacitor: true, expected: ['yt-dlp'] },
]) {
  test(`${platform.isElectron ? 'Electron' : 'Android'} checks only binaries it can manage`, async () => {
    const checked = []
    const controller = createManagedExternalSoftwareController({
      capabilities: resolveManagedToolsCapabilities(platform),
      store: { getters: {
        getExternalSoftwareUpdateMode: 'ask',
        getYtDlpSource: 'managed',
        getYtDlpFfmpegSource: 'managed',
      } },
      ytDlp: {
        ytDlpGetInfo: async () => ({
          ytDlp: { available: true }, ffmpeg: { available: true }, ffprobe: { available: true },
        }),
        ytDlpCheckBinaryUpdate: async binary => { checked.push(binary); return { available: false } },
      },
      t: key => key,
      showProgressStartToast: { value: false },
      initializeNetworkRecovery: () => ({ run: async (_key, task) => task() }),
      classifyRequestFailure: () => null,
      startProgressBarOperation: () => { throw new Error('No download expected') },
      showToast: () => { throw new Error('No update prompt expected') },
    })
    await controller.initializeManagedExternalSoftware()
    assert.deepEqual(checked, platform.expected)
  })
}

function setup(t, online, checkInternet) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const events = new EventTarget()
  const recovery = createNetworkRecovery({ eventTarget: events, isOnline: () => online, checkInternet })
  t.after(() => recovery.dispose())
  const calls = []
  const toasts = []
  const context = {
    isElectron: false, isCapacitor: true,
    initializeNetworkRecovery: () => recovery,
    classifyRequestFailure,
    getConnectionState: () => recovery.state,
    navigator: { get onLine() { return online } },
    store: { getters: { getExternalSoftwareUpdateMode: 'automatic', getYtDlpSource: 'managed', getYtDlpFfmpegSource: 'managed' } },
    ytDlp: {
      ytDlpGetInfo: async () => ({ ytDlp: { available: false }, ffmpeg: { available: true }, ffprobe: { available: true } }),
      addYtDlpBinaryDownloadProgressListener: () => () => {},
      ytDlpDownloadBinary: async () => { calls.push('download'); return online ? { version: '1', updated: true } : { error: 'Unable to resolve host "api.github.com"' } },
    },
    showProgressStartToast: { value: true },
    t: key => key,
    showToast: toast => toasts.push(toast),
    startProgressBarOperation: () => ({ update() {}, finish() {} }),
  }
  context.initializeManagedExternalSoftware = createManagedExternalSoftwareController({
    capabilities: resolveManagedToolsCapabilities(context),
    store: context.store, ytDlp: context.ytDlp, t: context.t,
    showProgressStartToast: context.showProgressStartToast,
    initializeNetworkRecovery: context.initializeNetworkRecovery,
    classifyRequestFailure: context.classifyRequestFailure,
    startProgressBarOperation: context.startProgressBarOperation,
    showToast: context.showToast,
  }).initializeManagedExternalSoftware
  return { calls, toasts, context, connect(value) { online = value; events.dispatchEvent(new Event(value ? 'online' : 'offline')) } }
}

test('Android startup defers missing managed tools without progress or error toasts while offline, then resumes', async t => {
  const app = setup(t, false)
  const pending = app.context.initializeManagedExternalSoftware()
  await flush()
  assert.deepEqual(app.calls, [])
  assert.deepEqual(app.toasts, [])
  t.mock.timers.tick(3600000)
  await flush()
  assert.deepEqual(app.calls, [])
  app.connect(true)
  await pending
  assert.deepEqual(app.calls, ['download'])
  assert.equal(app.toasts.some(toast => toast.message.includes('Error')), false)
})

test('going offline during a native managed tool download defers its failure and retries after reconnection', async t => {
  const app = setup(t, true)
  let attempts = 0
  app.context.ytDlp.ytDlpDownloadBinary = async () => {
    attempts++
    if (attempts === 1) {
      app.connect(false)
      return { error: 'Unable to resolve host "api.github.com"' }
    }
    return { version: '1', updated: true }
  }
  const pending = app.context.initializeManagedExternalSoftware()
  await flush()
  assert.equal(app.toasts.some(toast => toast.message.includes('Error')), false)
  app.connect(true)
  await pending
  assert.equal(attempts, 2)
})

test('managed tool failures while connected remain visible', async t => {
  const app = setup(t, true)
  app.context.ytDlp.ytDlpDownloadBinary = async () => ({ error: 'Invalid archive' })
  await app.context.initializeManagedExternalSoftware()
  assert.equal(app.toasts.some(toast => toast.message.includes('Error')), true)
})

for (const stage of ['info', 'download']) {
  test(`disconnecting during ${stage} also handles native promise rejection quietly`, async t => {
    const app = setup(t, true)
    if (stage === 'info') {
      const getInfo = app.context.ytDlp.ytDlpGetInfo
      app.context.ytDlp.ytDlpGetInfo = async () => {
        app.connect(false)
        return getInfo()
      }
    } else {
      let attempts = 0
      app.context.ytDlp.ytDlpDownloadBinary = async () => {
        if (++attempts === 1) {
          app.connect(false)
          throw new Error('Unable to resolve host')
        }
        return { version: '1', updated: true }
      }
    }
    const pending = app.context.initializeManagedExternalSoftware()
    await flush()
    assert.equal(app.toasts.some(toast => toast.message.includes('Error')), false)
    if (stage === 'info') assert.deepEqual(app.toasts, [])
    app.connect(true)
    await pending
    assert.equal(app.toasts.some(toast => toast.message.includes('Finished')), true)
  })
}

test('Android startup also defers native tool downloads when the network link is up but internet is unreachable', async t => {
  let reachable = false
  const app = setup(t, true, async () => reachable)
  const pending = app.context.initializeManagedExternalSoftware()
  await flush()
  assert.deepEqual(app.calls, [])
  assert.deepEqual(app.toasts, [])
  reachable = true
  t.mock.timers.tick(5000)
  await pending
  assert.deepEqual(app.calls, ['download'])
})

test('a native tool failure checks WAN reachability before showing an error', async t => {
  let reachable = true
  const app = setup(t, true, async () => reachable)
  let attempts = 0
  app.context.ytDlp.ytDlpDownloadBinary = async () => {
    if (++attempts === 1) {
      reachable = false
      return { error: 'Unable to resolve host' }
    }
    return { version: '1', updated: true }
  }
  const pending = app.context.initializeManagedExternalSoftware()
  await flush()
  assert.equal(app.toasts.some(toast => toast.message.includes('Error')), false)
  assert.equal(attempts, 1)
  reachable = true
  t.mock.timers.tick(5000)
  await pending
  assert.equal(attempts, 2)
})

for (const failure of [
  { error: 'Unable to resolve host "api.github.com"' },
  { code: 'UnknownHostException', message: 'Download failed' },
  { code: 'ETIMEDOUT', message: 'Download failed' },
  { code: 'ECONNRESET', message: 'Download failed' },
]) {
  test(`managed tool transport failure retries even when GrapheneOS is reachable: ${failure.code ?? failure.error}`, async t => {
    const app = setup(t, true, async () => true)
    let attempts = 0
    app.context.ytDlp.ytDlpDownloadBinary = async () => {
      if (++attempts === 1) {
        if (failure.code) throw Object.assign(new Error(failure.message), { code: failure.code })
        return failure
      }
      return { version: '1', updated: true }
    }
    const pending = app.context.initializeManagedExternalSoftware()
    await flush()
    assert.equal(app.toasts.some(toast => toast.message.includes('Error')), false)
    t.mock.timers.tick(5000)
    await pending
    assert.equal(attempts, 2)
  })
}

test('known non-network managed tool errors do not trigger another connectivity probe', async t => {
  let probes = 0
  const app = setup(t, true, async () => { probes++; return true })
  app.context.ytDlp.ytDlpDownloadBinary = async () => {
    throw Object.assign(new Error('Download failed'), { code: 'SSLHandshakeException' })
  }
  await app.context.initializeManagedExternalSoftware()
  assert.equal(probes, 1)
  assert.equal(app.toasts.some(toast => toast.message.includes('Error')), true)
})
