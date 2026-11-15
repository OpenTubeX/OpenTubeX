import assert from 'node:assert/strict'
import test from 'node:test'

import { isRoundedNumber } from '../../src/renderer/helpers/viewCounts.js'

/** Mirrors `formatViewCount` in src/renderer/helpers/utils.js, which pulls in the locale from vue-i18n. */
function formatViewCount(viewCount) {
  return new Intl.NumberFormat(['en'], isRoundedNumber(viewCount) ? { notation: 'compact' } : undefined)
    .format(viewCount)
}

test('shortens the view counts that YouTube already rounded', () => {
  assert.equal(formatViewCount(1000), '1K')
  assert.equal(formatViewCount(1400), '1.4K')
  assert.equal(formatViewCount(14000), '14K')
  assert.equal(formatViewCount(143000), '143K')
  assert.equal(formatViewCount(3500000), '3.5M')
  assert.equal(formatViewCount(1200000000), '1.2B')
})
