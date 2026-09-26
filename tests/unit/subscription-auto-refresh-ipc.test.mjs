import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerSubscriptionAutoRefreshIpc } from '../../src/main/subscriptionAutoRefreshIpc.js'

test('subscription refresh ownership gates progress, cancellation, and automatic downloads', async () => {
  const handlers = new Map()
  const sent = []
  const owner = {
    id: 1,
    isDestroyed: () => false,
    once: () => {},
    send: (...args) => sent.push(args)
  }
  const other = { id: 2, isDestroyed: () => false }
  let visibilityUpdates = 0
  const service = registerSubscriptionAutoRefreshIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: (channel, handler) => handlers.set(channel, handler)
    },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    TabManager: { getFromWebContents: sender => sender === owner ? { activeTabId: 'tab-1' } : null },
    getActiveRecovery: () => null,
    backgroundSubscriptions: { setBackground: async () => {} },
    updateBackgroundVisibility: () => { visibilityUpdates += 1 },
    getWindows: () => []
  })
  const event = { sender: owner, senderFrame: { url: 'app://bundle/index.html' } }
  assert.equal(await handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE)(event, 'tab-1', 'videos'), true)
  assert.equal(service.isInProgress(), true)
  assert.equal(service.isAutomaticDownloadAuthorized(event, { refreshOwnerTabId: 'tab-1' }), true)
  assert.equal(service.isAutomaticDownloadAuthorized({ sender: other }, { refreshOwnerTabId: 'tab-1' }), false)
  handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS)({ sender: other }, 'tab-1', 70)
  handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS)(event, 'tab-1', 125)
  assert.deepEqual(handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_GET_STATE)(event), {
    inProgress: true, percentage: 100, tab: 'videos'
  })
  service.requestCancellation()
  assert.deepEqual(sent, [[IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL]])
  handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE)(event, 'tab-1')
  assert.equal(service.isInProgress(), false)
  assert.equal(visibilityUpdates, 1)
})
