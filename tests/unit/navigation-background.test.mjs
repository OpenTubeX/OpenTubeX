import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/tabs/TabNavigationService.js', import.meta.url), 'utf8')
const start = source.indexOf('function nextAnimationFrame() {')
const end = source.indexOf('\n}\n', start) + 2

function frameWait(hidden = false) {
  const events = new EventTarget()
  const listeners = new Set()
  let frame
  let cancellations = 0
  const wait = runInNewContext(source.slice(start, end) + '\nnextAnimationFrame', {
    isAppHidden: () => hidden,
    window: {
      requestAnimationFrame(callback) { frame = callback; return 1 },
      cancelAnimationFrame() { cancellations++ },
    },
    document: {
      addEventListener(type, listener) { listeners.add(listener); events.addEventListener(type, listener) },
      removeEventListener(type, listener) { listeners.delete(listener); events.removeEventListener(type, listener) },
    },
  })
  return {
    wait,
    hide() { hidden = true; events.dispatchEvent(new Event('visibilitychange')) },
    render() { frame?.() },
    get listeners() { return listeners.size },
    get cancellations() { return cancellations },
  }
}

for (const initiallyHidden of [true, false]) {
  test(`navigation completes without a rendered frame when ${initiallyHidden ? 'already hidden' : 'hidden during the wait'}`, async () => {
    const frames = frameWait(initiallyHidden)
    const pending = frames.wait()
    if (!initiallyHidden) frames.hide()
    assert.equal(await Promise.race([pending.then(() => true), setTimeout(20, false)]), true,
      'a hidden WebView must release the navigation queue without animation frames')
    assert.equal(frames.listeners, 0, 'visibility listeners are released')
    if (!initiallyHidden) assert.equal(frames.cancellations, 1, 'the outstanding frame is cancelled')
  })
}

test('visible navigation still waits for a rendered frame and cleans up its listener', async () => {
  const frames = frameWait()
  let complete = false
  const pending = frames.wait().then(() => { complete = true })
  await Promise.resolve()
  assert.equal(complete, false)
  frames.render()
  await pending
  assert.equal(complete, true)
  assert.equal(frames.listeners, 0)
})
