import assert from 'node:assert/strict'
import test from 'node:test'

import { createLinkNavigationPlatform } from '../../src/renderer/helpers/appLinkNavigationPlatform.js'

const internalLink = { href: 'https://app.example/#/watch/abc', origin: 'https://app.example' }

test('Electron internal link shortcut respects platform modifier and middle clicks', () => {
  const linux = createLinkNavigationPlatform({ runtime: 'electron', isMac: false })
  assert.deepEqual(linux.internalLinkShortcut({ type: 'click', button: 0, ctrlKey: true, shiftKey: false }, internalLink, 'https://app.example'), {
    hashRoute: '/watch/abc', doCreateNewWindow: false, doCreateNewTab: true, makeActive: true,
  })
  assert.deepEqual(linux.internalLinkShortcut({ type: 'auxclick', button: 1, shiftKey: true }, internalLink, 'https://app.example'), {
    hashRoute: '/watch/abc', doCreateNewWindow: true, doCreateNewTab: false, makeActive: false,
  })
  assert.equal(linux.internalLinkShortcut({ type: 'click', button: 0, metaKey: true }, internalLink, 'https://app.example'), null)
  assert.equal(linux.internalLinkShortcut({ type: 'click', button: 0, ctrlKey: true, altKey: true }, internalLink, 'https://app.example'), null)
  assert.equal(linux.internalLinkShortcut({ type: 'click', button: 0, ctrlKey: true }, { href: 'https://other.example/', origin: 'https://other.example' }, 'https://app.example'), null)
  assert.equal(createLinkNavigationPlatform({ runtime: 'web', isMac: false }).internalLinkShortcut({ type: 'click', button: 0, ctrlKey: true }, internalLink, 'https://app.example'), null)
})

test('link disposition uses native OS modifier in Electron and either modifier on web', () => {
  const mac = createLinkNavigationPlatform({ runtime: 'electron', isMac: true })
  const web = createLinkNavigationPlatform({ runtime: 'web', isMac: false })
  assert.deepEqual(mac.linkDisposition({ type: 'click', button: 0, ctrlKey: true, metaKey: false, shiftKey: false }), {
    doCreateNewTab: false, doCreateNewWindow: false, isMiddleClick: false,
  })
  assert.equal(mac.linkDisposition({ type: 'click', button: 0, metaKey: true }).doCreateNewTab, true)
  assert.equal(web.linkDisposition({ type: 'click', button: 0, metaKey: true }).doCreateNewTab, true)
})

test('mouse history buttons are handled only by Electron tabs', () => {
  const electron = createLinkNavigationPlatform({ runtime: 'electron', isMac: false })
  const web = createLinkNavigationPlatform({ runtime: 'web', isMac: false })
  assert.equal(electron.mouseHistoryOffset({ button: 3 }), -1)
  assert.equal(electron.mouseHistoryOffset({ button: 4 }), 1)
  assert.equal(electron.mouseHistoryOffset({ button: 1 }), null)
  assert.equal(web.mouseHistoryOffset({ button: 3 }), null)
})
