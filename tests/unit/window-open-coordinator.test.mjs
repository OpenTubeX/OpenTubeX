import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { createWindowOpenCoordinator } from '../../src/main/windowOpenCoordinator.js'

function setup() {
  const sent = []
  const replies = []
  const webContents = {
    id: 9,
    isDestroyed: () => false,
    getURL: () => 'app://bundle/index.html',
    send: (...args) => sent.push(args)
  }
  const window = { id: 2, webContents, isDestroyed: () => false }
  const coordinator = createWindowOpenCoordinator({
    rootAppUrl: 'app://bundle/index.html',
    getDirectOpenUrl: () => null,
    isTrustedUrl: url => url === 'app://bundle/index.html',
    BrowserWindow: { fromWebContents: contents => contents === webContents ? window : null },
    TabManager: { getForWindow: () => null }
  })
  const readyEvent = {
    sender: webContents,
    senderFrame: { url: 'app://bundle/index.html' },
    reply: (...args) => replies.push(args)
  }
  return { coordinator, window, webContents, sent, replies, readyEvent }
}

test('window open coordinator queues protocol URLs until renderer ready', () => {
  const { coordinator, window, sent, replies, readyEvent } = setup()
  coordinator.openUrlInWindow(window, 'https://example.com/one')
  assert.deepEqual(sent, [])
  coordinator.openPendingUrlForReadyWebContents(readyEvent)
  assert.deepEqual(replies, [[IpcChannels.OPEN_URL, { url: 'https://example.com/one', tabId: null }]])
  coordinator.openUrlInWindow(window, 'https://example.com/two')
  assert.deepEqual(sent, [[IpcChannels.OPEN_URL, { url: 'https://example.com/two', tabId: null }]])
})

test('window open coordinator resets readiness when web contents reloads', () => {
  const { coordinator, window, sent, replies, readyEvent, webContents } = setup()
  coordinator.openPendingUrlForReadyWebContents(readyEvent)
  coordinator.resetReady(webContents.id)
  coordinator.openUrlInWindow(window, 'https://example.com/three')
  assert.deepEqual(sent, [])
  coordinator.openPendingUrlForReadyWebContents(readyEvent)
  assert.deepEqual(replies, [[IpcChannels.OPEN_URL, { url: 'https://example.com/three', tabId: null }]])
})
