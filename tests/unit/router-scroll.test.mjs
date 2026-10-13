import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/router/index.js', import.meta.url), 'utf8')
const start = source.indexOf('  scrollBehavior(')
const behavior = source.slice(start, source.indexOf('\n})', start))

for (const platform of ['IS_CAPACITOR', 'IS_ELECTRON']) {
  test(`${platform} leaves saved scroll restoration to the tab navigation service`, () => {
    const timers = []
    const scroll = vm.runInNewContext(`({${behavior}}).scrollBehavior`, {
      process: { env: { [platform]: true } },
      setTimeout: callback => timers.push(callback)
    })
    assert.equal(scroll({}, {}, null), false, 'A delayed router reset would overwrite the restored tab position')
    assert.equal(timers.length, 0)
  })
}

test('web navigation still restores browser history scrolling', async () => {
  const scroll = vm.runInNewContext(`({${behavior}}).scrollBehavior`, {
    process: { env: {} }, setTimeout: callback => callback()
  })
  const position = { left: 0, top: 750 }
  assert.equal(await scroll({}, {}, position), position)
})

test('web query-state saves preserve the current viewport', () => {
  const timers = []
  const scroll = vm.runInNewContext(`({${behavior}}).scrollBehavior`, {
    process: { env: {} },
    window: { history: { state: { preserveScroll: true } } },
    setTimeout: callback => timers.push(callback)
  })
  assert.equal(scroll({}, {}, null), false)
  assert.equal(timers.length, 0)
})

test('web Back navigation restores its saved position even on a preserved route', async () => {
  const scroll = vm.runInNewContext(`({${behavior}}).scrollBehavior`, {
    process: { env: {} },
    window: { history: { state: { preserveScroll: true } } },
    setTimeout: callback => callback()
  })
  const position = { left: 0, top: 750 }
  assert.equal(await scroll({}, {}, position), position)
})
