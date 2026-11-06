import assert from 'node:assert/strict'
import test from 'node:test'

import { isRoundedNumber } from '../../src/renderer/helpers/viewCounts.js'

/** Mirrors `formatViewCount` in src/renderer/helpers/utils.js, which pulls in the locale from vue-i18n. */
function formatViewCount(viewCount, shorten = true, locale = 'en') {
  return new Intl.NumberFormat([locale], shorten && isRoundedNumber(viewCount) ? { notation: 'compact' } : undefined)
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

test('keeps exact view counts as they are', () => {
  assert.equal(formatViewCount(1234567), '1,234,567')
  assert.equal(formatViewCount(4321), '4,321')
  assert.equal(formatViewCount(999), '999')
  assert.equal(formatViewCount(0), '0')
})

// Shortening these would drop digits that YouTube's own compact numbers never have,
// so they can't have come from a rounded view count.
test('does not shorten numbers that compact notation cannot represent exactly', () => {
  assert.equal(formatViewCount(12300000), '12,300,000')
  assert.equal(formatViewCount(1050000), '1,050,000')
  assert.equal(formatViewCount(1234000), '1,234,000')
})

test('leaves the compact notation to the locale', () => {
  // The separators are non-breaking spaces
  assert.equal(formatViewCount(3500000, true, 'de'), '3,5\u00a0Mio.')
  // Indian numbering groups by lakh instead of million
  assert.equal(formatViewCount(3500000, true, 'hi'), '35\u00a0\u0932\u093e\u0916')
})

test('ignores view counts that are not usable numbers', () => {
  assert.equal(isRoundedNumber(Number.NaN), false)
  assert.equal(isRoundedNumber(Number.POSITIVE_INFINITY), false)
  assert.equal(isRoundedNumber(-14000), false)
})

test('keeps the full numbers when the user opted out of shortening', () => {
  assert.equal(formatViewCount(14000, false), '14,000')
  assert.equal(formatViewCount(3500000, false), '3,500,000')
})
