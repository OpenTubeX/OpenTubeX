import assert from 'node:assert/strict'
import test from 'node:test'
import { measureLeavingItemLayouts } from '../../src/renderer/components/FtAutoGrid/leavingItemLayout.js'

test('measures fractional item positions as one batch before leaving styles change layout', () => {
  let reads = 0
  let writes = false
  const rect = value => () => {
    assert.equal(writes, false)
    reads++
    return value
  }
  const children = Array.from({ length: 100 }, (_, index) => ({
    getBoundingClientRect: rect({ width: 250.5, height: 210.25, left: 30.75, top: 50.5 + index * 218.25 })
  }))
  const layouts = measureLeavingItemLayouts({
    children,
    getBoundingClientRect: rect({ left: 20.25, top: 40.75 })
  })
  writes = true
  for (const [index, child] of children.entries()) {
    assert.deepEqual(layouts.get(child), {
      width: 250.5, height: 210.25, left: 10.5, top: 9.75 + index * 218.25
    })
  }
  assert.equal(reads, 101)
})
