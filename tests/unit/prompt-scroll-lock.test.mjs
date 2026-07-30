import assert from 'node:assert/strict'
import test from 'node:test'

import {
  lockBodyScroll,
  unlockBodyScroll
} from '../../src/renderer/components/FtPrompt/scrollLock.js'

test('overlapping prompts restore document styles after the final unlock', () => {
  const hadWindow = Object.hasOwn(globalThis, 'window')
  const hadDocument = Object.hasOwn(globalThis, 'document')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document

  globalThis.window = { innerWidth: 1200 }
  globalThis.document = {
    documentElement: {
      clientWidth: 1184,
      style: { overflow: 'auto' }
    },
    body: {
      style: { paddingInlineEnd: '4px' }
    }
  }

  try {
    lockBodyScroll()
    lockBodyScroll()
    unlockBodyScroll()

    assert.equal(document.documentElement.style.overflow, 'hidden')
    assert.equal(document.body.style.paddingInlineEnd, 'calc(4px + 16px)')

    unlockBodyScroll()

    assert.equal(document.documentElement.style.overflow, 'auto')
    assert.equal(document.body.style.paddingInlineEnd, '4px')
  } finally {
    unlockBodyScroll()
    unlockBodyScroll()

    if (hadWindow) {
      globalThis.window = previousWindow
    } else {
      delete globalThis.window
    }

    if (hadDocument) {
      globalThis.document = previousDocument
    } else {
      delete globalThis.document
    }
  }
})
