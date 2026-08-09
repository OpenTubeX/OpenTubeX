import assert from 'node:assert/strict'
import test from 'node:test'

import { findSponsorBlockSeekBarSegment } from '../../src/renderer/helpers/player/sponsorBlockSeekBar.js'

test('selects the topmost marker when SponsorBlock segments overlap', () => {
  const filler = { category: 'filler', actionType: 'skip', startTime: 10, endTime: 30 }
  const selfPromotion = { category: 'selfpromo', actionType: 'skip', startTime: 20, endTime: 25 }

  assert.equal(findSponsorBlockSeekBarSegment([filler, selfPromotion], 22, 0.1), selfPromotion)
  assert.equal(findSponsorBlockSeekBarSegment([filler, selfPromotion], 15, 0.1), filler)
})

test('selects point markers within the visible hover tolerance', () => {
  const segment = { category: 'poi_highlight', actionType: 'poi', startTime: 20, endTime: 20 }

  assert.equal(findSponsorBlockSeekBarSegment([segment], 20.4, 0.1), segment)
  assert.equal(findSponsorBlockSeekBarSegment([segment], 20.6, 0.1), null)
})
