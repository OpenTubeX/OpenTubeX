import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { createProxyController, registerProxyIpc } from '../../src/main/proxyController.js'

test('startup proxy setup keeps connections while IPC changes close them', () => {
  const proxyRules = []
  let closedConnections = 0
  const session = {
    setProxy: options => proxyRules.push(options),
    closeAllConnections: () => { closedConnections += 1 }
  }
  const controller = createProxyController(session)
  controller.set('http://startup:8080', { closeConnections: false })
  assert.equal(controller.getUrl(), 'http://startup:8080')
  assert.equal(closedConnections, 0)

  const registrations = new Map()
  registerProxyIpc({
    ipcMain: { on: (channel, handler) => registrations.set(channel, handler) },
    controller,
    isTrustedUrl: url => url === 'app://bundle/index.html'
  })
  const event = { senderFrame: { url: 'app://bundle/index.html' } }
  registrations.get(IpcChannels.ENABLE_PROXY)(event, 'http://next:8080')
  assert.equal(controller.getUrl(), 'http://next:8080')
  assert.equal(closedConnections, 1)

  registrations.get(IpcChannels.DISABLE_PROXY)(event)
  assert.equal(controller.getUrl(), undefined)
  assert.equal(closedConnections, 2)
  assert.deepEqual(proxyRules, [
    { proxyRules: 'http://startup:8080' },
    { proxyRules: 'http://next:8080' },
    {}
  ])
})

test('untrusted frames cannot change the proxy', () => {
  const proxyRules = []
  const controller = createProxyController({
    setProxy: options => proxyRules.push(options),
    closeAllConnections: () => assert.fail('must not close connections')
  })
  const registrations = new Map()
  registerProxyIpc({
    ipcMain: { on: (channel, handler) => registrations.set(channel, handler) },
    controller,
    isTrustedUrl: () => false
  })
  const event = { senderFrame: { url: 'https://example.com' } }
  registrations.get(IpcChannels.ENABLE_PROXY)(event, 'http://blocked')
  registrations.get(IpcChannels.DISABLE_PROXY)(event)
  assert.equal(controller.getUrl(), undefined)
  assert.deepEqual(proxyRules, [])
})
