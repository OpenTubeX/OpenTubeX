import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/player/miniControlsSnapshot.js', import.meta.url), 'utf8'))
  .replace('export function ', 'function ')

for (const failure of ['image loading', 'canvas rendering']) {
  test(`mini controls retry unchanged content after failed ${failure}`, () => {
    const timers = new Map()
    let timerId = 0
    const images = []
    const errors = []
    const changes = []
    let failCanvas = failure === 'canvas rendering'
    const root = {
      childNodes: [],
      matches: () => false,
      cloneNode: () => ({ style: { setProperty() {} }, querySelector: () => null })
    }
    const context = vm.createContext({
      setTimeout(callback) { timers.set(++timerId, callback); return timerId },
      clearTimeout(id) { timers.delete(id) },
      window: { devicePixelRatio: 2 },
      getComputedStyle: () => ({
        visibility: 'visible', display: 'block', opacity: '1', content: 'none',
        * [Symbol.iterator]() {}
      }),
      HTMLInputElement: class {},
      XMLSerializer: class { serializeToString() { return '<div />' } },
      Image: class { constructor() { images.push(this) } },
      document: { createElement: () => ({
        getContext: () => ({ drawImage() { if (failCanvas) throw new Error('Canvas unavailable') } }),
        toDataURL: () => 'data:image/png;base64,controls'
      }) }
    })
    vm.runInContext(source, context)
    const snapshot = context.createMiniControlsSnapshot(value => changes.push(value), error => errors.push(error))
    snapshot.update(root, 240, 135, false)
    if (failure === 'image loading') images[0].onerror()
    else images[0].onload()
    assert.equal(errors.length, 0, 'A transient snapshot failure must not report a playback error')
    assert.deepEqual(changes, [])

    failCanvas = false
    for (let frame = 0; frame < 60; frame++) snapshot.update(root, 240, 135, true)
    assert.equal(images.length, 1, 'Scroll frames must not retry a failed snapshot')
    assert.equal(timers.size, 1, 'An idle failure schedules its own retry')
    const retry = [...timers.values()][0]
    timers.clear()
    retry()
    assert.equal(images.length, 2, 'The unchanged controls must retry after the failed attempt')
    images[1].onload()
    assert.deepEqual(changes, ['data:image/png;base64,controls'])
    snapshot.update(root, 240, 135, false)
    assert.equal(images.length, 2, 'A successful retry is cached normally')
    snapshot.invalidate()
    // Change dimensions to require a fresh image, then fail persistently.
    snapshot.update(root, 241, 135, false)
    images.at(-1).onerror()
    const retryAgain = [...timers.values()][0]
    timers.clear()
    retryAgain()
    images.at(-1).onerror()
    const attempts = images.length
    for (let frame = 0; frame < 60; frame++) snapshot.update(root, 241, 135, false)
    assert.equal(images.length, attempts, 'Persistent failure exhausts the automatic retry')
    assert.equal(timers.size, 0)
    assert.equal(errors.length, 1, 'Report persistent failure once')
    snapshot.update(null, 0, 0, false)
    snapshot.update(root, 240, 135, false)
    images.at(-1).onerror()
    assert.equal(timers.size, 1)
    snapshot.update(null, 0, 0, false)
    assert.equal(timers.size, 0, 'Leaving mini mode cancels the retry')
    snapshot.update(root, 240, 135, false)
    images.at(-1).onerror()
    snapshot.destroy()
    assert.equal(timers.size, 0, 'Destruction cancels the retry')
  })
}
