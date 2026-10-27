import assert from 'node:assert/strict'
import test from 'node:test'

import { disableSearchSpellCorrection, parseSearchCorrection } from '../../src/renderer/helpers/search-correction.js'

const text = value => ({ toString: () => value })

test('parses an automatic search correction', () => {
  const results = [
    {
      type: 'ShowingResultsFor',
      corrected_query: text('minecraft speedrun'),
      original_query: text('minecarft speedrn'),
      original_query_endpoint: {}
    },
    { type: 'Video' }
  ]

  assert.deepEqual(parseSearchCorrection(results), {
    type: 'showingResultsFor',
    correctedQuery: 'minecraft speedrun',
    canSearchOriginal: true
  })
})

test('parses search suggestions without automatic correction', () => {
  assert.deepEqual(parseSearchCorrection([{ type: 'Video' }, { type: 'DidYouMean', corrected_query: text('how to tie a tie') }]), {
    type: 'didYouMean',
    correctedQuery: 'how to tie a tie',
    canSearchOriginal: false
  })
  assert.deepEqual(parseSearchCorrection([{ type: 'IncludingResultsFor', corrected_query: text('lofi'), original_query_endpoint: {} }]), {
    type: 'includingResultsFor',
    correctedQuery: 'lofi',
    canSearchOriginal: true
  })
})

test('marks corrections that YouTube offers no uncorrected search for', () => {
  // YouTube omits the "Search only for" link for hashtag searches.
  assert.deepEqual(parseSearchCorrection([{ type: 'IncludingResultsFor', corrected_query: text('cooking') }]), {
    type: 'includingResultsFor',
    correctedQuery: 'cooking',
    canSearchOriginal: false
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
