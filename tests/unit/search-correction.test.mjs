import assert from 'node:assert/strict'
import test from 'node:test'

import { disableSearchSpellCorrection, parseSearchCorrection } from '../../src/renderer/helpers/search-correction.js'

const text = value => ({ toString: () => value })

test('parses an automatic search correction', () => {
  const results = [
    { type: 'ShowingResultsFor', corrected_query: text('minecraft speedrun'), original_query: text('minecarft speedrn') },
    { type: 'Video' }
  ]

  assert.deepEqual(parseSearchCorrection(results), { type: 'showingResultsFor', correctedQuery: 'minecraft speedrun' })
})

test('parses search suggestions without automatic correction', () => {
  assert.deepEqual(parseSearchCorrection([{ type: 'Video' }, { type: 'DidYouMean', corrected_query: text('how to tie a tie') }]), {
    type: 'didYouMean',
    correctedQuery: 'how to tie a tie'
  })
  assert.deepEqual(parseSearchCorrection([{ type: 'IncludingResultsFor', corrected_query: text('lofi') }]), {
    type: 'includingResultsFor',
    correctedQuery: 'lofi'
  })
})

test('ignores searches without a usable correction', () => {
  assert.equal(parseSearchCorrection(undefined), null)
  assert.equal(parseSearchCorrection([{ type: 'Video' }]), null)
  assert.equal(parseSearchCorrection([{ type: 'DidYouMean', corrected_query: text(' ') }]), null)
})

test('turns off spelling correction without dropping the encoded filters', () => {
  // YouTube.js' params for the default filters, and YouTube's "Search instead for" params.
  assert.equal(disableSearchSpellCorrection('EgA%3D'), 'EgBCAggB')
  assert.equal(disableSearchSpellCorrection(''), 'QgIIAQ%3D%3D')
  // Popularity, this year, videos, HD
  assert.equal(disableSearchSpellCorrection('CAMSBggFEAEgAQ%3D%3D'), 'CAMSBggFEAEgAUICCAE%3D')
})
