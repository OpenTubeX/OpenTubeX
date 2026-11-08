import assert from 'node:assert/strict'
import test from 'node:test'

import { getSponsorBlockCategoryVoteOptions } from '../../src/renderer/helpers/player/sponsorBlockCategories.js'

test('category votes preserve timed skip and mute segments', () => {
  for (const actionType of ['skip', 'mute']) {
    const options = getSponsorBlockCategoryVoteOptions(actionType)
    assert.ok(options.includes('intro'))
    assert.equal(options.includes('music_offtopic'), actionType === 'skip')
    assert.ok(!options.includes('poi_highlight'))
    assert.ok(!options.includes('exclusive_access'))
  }
})

test('category votes respect full-video, highlight, and chapter restrictions', () => {
  assert.deepEqual(getSponsorBlockCategoryVoteOptions('full'), [])
  assert.deepEqual(getSponsorBlockCategoryVoteOptions('poi'), ['poi_highlight'])
  assert.deepEqual(getSponsorBlockCategoryVoteOptions('chapter'), [])
})
