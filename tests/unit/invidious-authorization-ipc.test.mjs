import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IpcChannels } from '../../src/constants.js'
import { registerInvidiousAuthorizationIpc } from '../../src/main/invidiousAuthorizationIpc.js'

test('Invidious authorization is scoped to its renderer and instance', () => {
  const listeners = new Map()
  const controller = registerInvidiousAuthorizationIpc({
    ipcMain: { on: (channel, listener) => listeners.set(channel, listener) },
    isTrustedUrl: url => url === 'app://trusted',
    isInvidiousInstanceUrl: (url, instance) => url.startsWith(`${instance}/`)
  })
  const set = listeners.get(IpcChannels.SET_INVIDIOUS_AUTHORIZATION)
  const trusted = { senderFrame: { url: 'app://trusted' }, sender: { id: 7 } }
  const untrusted = { senderFrame: { url: 'https://untrusted.test' }, sender: { id: 7 } }

  set(untrusted, 'secret', 'https://instance.test')
  assert.equal(controller.getForRequest(7, 'https://instance.test/image'), undefined)
  set(trusted, 'secret', 'https://instance.test')
  assert.equal(controller.getForRequest(7, 'https://instance.test/image'), 'secret')
  assert.equal(controller.getForRequest(7, 'https://other.test/image'), undefined)
  assert.equal(controller.getForRequest(8, 'https://instance.test/image'), undefined)
  set(trusted, '', 'https://instance.test')
  assert.equal(controller.getForRequest(7, 'https://instance.test/image'), undefined)
  set(trusted, 'another', 'https://instance.test')
  controller.forget(7)
  assert.equal(controller.getForRequest(7, 'https://instance.test/image'), undefined)
})
