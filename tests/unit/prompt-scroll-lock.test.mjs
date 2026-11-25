import assert from 'node:assert/strict'
import test from 'node:test'

import {
  lockBodyScroll,
  unlockBodyScroll
} from '../../src/renderer/components/FtPrompt/scrollLock.js'

test('overlapping prompts restore document styles after the final unlock', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document')
  const previousDocument = globalThis.document

  const classes = new Set()
  globalThis.document = {
    documentElement: {
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      style: { overflow: 'auto' }
    }
  }

  try {
    lockBodyScroll()
    lockBodyScroll()
    unlockBodyScroll()

    assert.equal(document.documentElement.style.overflow, 'hidden')
    assert.ok(classes.has('appScrollLocked'))

    unlockBodyScroll()

    assert.equal(document.documentElement.style.overflow, 'auto')
    assert.ok(!classes.has('appScrollLocked'))
  } finally {
    unlockBodyScroll()
    unlockBodyScroll()

    if (hadDocument) {
      globalThis.document = previousDocument
    } else {
      delete globalThis.document
    }
  }
})
