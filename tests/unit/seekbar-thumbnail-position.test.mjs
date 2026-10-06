import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const shaka = { ui: { Element: class {} } }
const context = vm.createContext({
  shaka,
  goog: { provide() {}, require() {}, requireType() {} }
})
for (const file of ['range_element.js', 'seek_bar.js']) {
  vm.runInContext(readFileSync(require.resolve(`shaka-player/ui/${file}`), 'utf8'), context)
}

function seekBar({ start = 0, end = 4.2, width = 1000.5, left = 42.25, step = 'any' } = {}) {
  const bar = Object.create(shaka.ui.SeekBar.prototype)
  Object.assign(bar, {
    bar: {
      min: String(start), max: String(end), step, offsetWidth: Math.round(width),
      getBoundingClientRect: () => ({ left, right: left + width, width })
    },
    player: {
      seekRange: () => ({ start, end }),
      isDynamic: () => false,
      getImageTracks: () => []
    },
    controls: { getChapters: () => [] },
    adCuePoints_: [],
    thumbnailContainer_: { clientWidth: 150, style: {} },
    thumbnailImageContainer_: { style: {} },
    thumbnailTime_: {},
    timeFormatter_: value => String(Math.floor(value))
  })
  return bar
}

for (const duration of [0.8, 2, 4.2, 12, 600]) {
  test(`seekbar preview follows the cursor continuously on a ${duration}s video`, () => {
    const bar = seekBar({ end: duration })
    const rect = bar.bar.getBoundingClientRect()
    for (const fraction of [0.17, 0.35, 0.53, 0.79]) {
      const cursorX = rect.left + 6 + fraction * (rect.width - 12)
      const value = bar.getValueFromPosition(cursorX)
      bar.showThumbnailAtValue_(value)
      const center = Number.parseFloat(bar.thumbnailContainer_.style.left) + 75
      assert.ok(Math.abs(center - (cursorX - rect.left)) < 0.01,
        `preview center ${center} is offset from cursor ${cursorX - rect.left}`)
      assert.ok(Math.abs(value - fraction * duration) < 1e-9)
    }
  })
}

test('continuous seeking clamps at the seek range boundaries, including a live offset', () => {
  const bar = seekBar({ start: 100.25, end: 104.45 })
  const rect = bar.bar.getBoundingClientRect()
  assert.equal(bar.getValueFromPosition(rect.left - 10), 100.25)
  assert.equal(bar.getValueFromPosition(rect.right + 10), 104.45)
  assert.ok(Math.abs(bar.getValueFromPosition(rect.left + rect.width / 2) - 102.35) < 1e-9)
})

test('numeric and default range steps still snap to their increments', () => {
  for (const [step, expected] of [['0.5', 1.5], ['', 1], ['1', 1]]) {
    const bar = seekBar({ step })
    const rect = bar.bar.getBoundingClientRect()
    const cursorX = rect.left + 6 + (1.4 / 4.2) * (rect.width - 12)
    assert.equal(bar.getValueFromPosition(cursorX), expected)
  }
})

test('preview stays inside the seekbar at either edge', () => {
  const bar = seekBar()
  bar.showThumbnailAtValue_(0)
  assert.equal(bar.thumbnailContainer_.style.left, '0px')
  bar.showThumbnailAtValue_(4.2)
  assert.equal(bar.thumbnailContainer_.style.left, `${bar.bar.offsetWidth - 150}px`)
})
