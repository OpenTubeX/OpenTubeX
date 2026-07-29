import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSponsorBlockSubmissionSegmentTimes,
  resolveSponsorBlockActionType,
  selectSponsorBlockFullVideoLabel,
} from '../../src/renderer/helpers/player/sponsorBlockFullVideo.js'

test('only supported categories can mark a full video', () => {
  assert.equal(resolveSponsorBlockActionType('sponsor', 'full'), 'full')
  assert.equal(resolveSponsorBlockActionType('selfpromo', 'full'), 'full')
  assert.equal(resolveSponsorBlockActionType('exclusive_access', 'skip'), 'full')
  assert.equal(resolveSponsorBlockActionType('interaction', 'full'), 'skip')
  assert.equal(resolveSponsorBlockActionType('poi_highlight', 'full'), 'poi')
})

test('full-video submissions always use zero timestamps', () => {
  assert.deepEqual(getSponsorBlockSubmissionSegmentTimes({
    actionType: 'full',
    startTime: 42,
    endTime: 84,
  }), [0, 0])
})

test('full-video labels use SponsorBlock priority', () => {
  const selfPromotion = { actionType: 'full', category: 'selfpromo' }
  const exclusiveAccess = { actionType: 'full', category: 'exclusive_access' }
  const sponsor = { actionType: 'full', category: 'sponsor' }

  assert.equal(selectSponsorBlockFullVideoLabel([
    selfPromotion,
    { actionType: 'skip', category: 'sponsor' },
    exclusiveAccess,
    sponsor,
  ]), sponsor)
  assert.equal(selectSponsorBlockFullVideoLabel([selfPromotion, exclusiveAccess]), exclusiveAccess)
  assert.deepEqual(selectSponsorBlockFullVideoLabel([
    { category: 'exclusive_access' }
  ]), { category: 'exclusive_access' })
  assert.equal(selectSponsorBlockFullVideoLabel([{ actionType: 'skip', category: 'sponsor' }]), null)
})
