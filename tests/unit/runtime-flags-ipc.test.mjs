import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IpcChannels } from '../../src/constants.js'
import { registerRuntimeFlagsIpc } from '../../src/main/runtimeFlagsIpc.js'

test('runtime flags report startup state and toggle their own files before relaunch', async () => {
  const handlers = new Map()
  const oneShotHandlers = new Map()
  const operations = []
  registerRuntimeFlagsIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      once: (channel, handler) => oneShotHandlers.set(channel, handler)
    },
    isTrustedUrl: url => url === 'app://trusted',
    replaceHttpCache: { enabled: false, path: '/cache-flag' },
    disableHardwareAcceleration: { enabled: true, path: '/gpu-flag' },
    files: {
      open: async (path, mode) => {
        operations.push(['open', path, mode])
        return { close: async () => operations.push(['close', path]) }
      },
      rm: async path => operations.push(['rm', path])
    },
    relaunch: () => operations.push(['relaunch'])
  })
  const trusted = { senderFrame: { url: 'app://trusted' } }
  const untrusted = { senderFrame: { url: 'https://untrusted.test' } }

  assert.equal(handlers.get(IpcChannels.GET_REPLACE_HTTP_CACHE)(trusted), false)
  assert.equal(handlers.get(IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION)(trusted), true)
  assert.equal(handlers.get(IpcChannels.GET_REPLACE_HTTP_CACHE)(untrusted), undefined)

  await oneShotHandlers.get(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE)(untrusted)
  assert.deepEqual(operations, [])
  await oneShotHandlers.get(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE)(trusted)
  await oneShotHandlers.get(IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION)(trusted)
  assert.deepEqual(operations, [
    ['open', '/cache-flag', 'w'], ['close', '/cache-flag'], ['relaunch'],
    ['rm', '/gpu-flag'], ['relaunch']
  ])
})
