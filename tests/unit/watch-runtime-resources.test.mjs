import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const lifecycle = source.slice(source.indexOf('    activateWatchRuntime()'), source.indexOf('\n    async cleanupWatchRuntime()'))
const reset = source.slice(source.indexOf('    resetAutoplayInterruptionTimeout() {'), source.indexOf('\n    updatePlaybackRate('))

test('watch activation and disposal do not accumulate autoplay inactivity timers', () => {
  const timers = new Map()
  let nextId = 0
  const methods = vm.runInNewContext(`({${lifecycle}${reset}})`, {
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout(callback, delay) {
      const id = ++nextId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) }
  })

  for (let index = 0; index < 20; index++) {
    const watch = {
      ...methods,
      isTabPresented: true,
      subscriptionShortsFeedActive: false,
      defaultAutoplayInterruptionIntervalHours: 3,
      autoplayInterruptionTimeout: null,
      resetShortsSwipe() {},
      abortAutoplayCountdown() {}
    }
    watch.activateWatchRuntime()
    assert.equal(timers.size, 1)
    watch.resetAutoplayInterruptionTimeout()
    assert.equal(timers.size, 1, 'interaction replaces the pending timeout')
    watch.deactivateWatchRuntime()
    assert.equal(timers.size, 0, 'a hidden or disposed watch view must release its three-hour callback')
  }
})
