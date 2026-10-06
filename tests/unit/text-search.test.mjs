import assert from 'node:assert/strict'
import test from 'node:test'

import { findSubsequenceIndexes, fuzzyWordScore } from '../../src/renderer/helpers/textSearch.js'

function referenceDistance (first, second) {
  const rows = Array.from({ length: first.length + 1 }, (_, row) => Array(second.length + 1).fill(row))
  for (let column = 0; column <= second.length; column++) rows[0][column] = column
  for (let row = 1; row <= first.length; row++) {
    for (let column = 1; column <= second.length; column++) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + Number(first[row - 1] !== second[column - 1])
      )
      if (row > 1 && column > 1 && first[row - 1] === second[column - 2] && first[row - 2] === second[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1)
      }
    }
  }
  return rows[first.length][second.length]
}

function referenceScore (query, candidate) {
  const allowedEdits = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0
  if (allowedEdits > 0 && Math.abs(query.length - candidate.length) <= allowedEdits) {
    const distance = referenceDistance(query, candidate)
    if (distance <= allowedEdits) return 8 + distance * 2 + Math.abs(query.length - candidate.length) / 4
  }
  const indexes = findSubsequenceIndexes(query, candidate)
  if (!indexes) return Infinity
  const gaps = indexes.slice(1).reduce((sum, index, position) => sum + index - indexes[position] - 1, 0)
  return 12 + indexes[0] / 4 + gaps
}

test('fuzzy scoring preserves substitutions, insertions, deletions, adjacent swaps and subsequences', () => {
  const words = ['', 'a', 'abc', 'abcd', 'abdc', 'acbd', 'acb', 'cabd', 'abcdefg', 'abcedfg', 'bacdefg', 'abdefg', 'aabcdefg', 'abxdeyg', 'axbyczd', 'übertragung', 'ubetragung', '日本語の字幕', '日本語字幕', '😀abcdefg', 'abcdef😀g']
  for (const query of words) {
    for (const candidate of words) {
      assert.equal(fuzzyWordScore(query, candidate), referenceScore(query, candidate), `${query} / ${candidate}`)
    }
  }
  let seed = 123
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let sample = 0; sample < 2000; sample++) {
    const word = () => Array.from({ length: 3 + Math.floor(random() * 10) }, () => 'abcd'[Math.floor(random() * 4)]).join('')
    const query = word()
    let candidate = word()
    if (sample % 2 === 0) {
      const characters = [...query]
      for (let edit = 0; edit < 1 + sample % 3; edit++) {
        const index = Math.floor(random() * characters.length)
        const operation = Math.floor(random() * 4)
        if (operation === 0) characters.splice(index, 0, 'abcd'[Math.floor(random() * 4)])
        if (operation === 1) characters.splice(index, 1)
        if (operation === 2) characters[index] = 'abcd'[Math.floor(random() * 4)]
        if (operation === 3 && index + 1 < characters.length) {
          [characters[index], characters[index + 1]] = [characters[index + 1], characters[index]]
        }
      }
      candidate = characters.join('')
    }
    assert.equal(fuzzyWordScore(query, candidate), referenceScore(query, candidate), `${query} / ${candidate}`)
  }
})

test('rejecting a long unrelated word does not compare every pair of characters', () => {
  const text = 'x'.repeat(256)
  let characterReads = 0
  const query = new Proxy(Object(text), {
    get (target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) characterReads++
      return Reflect.get(target, key)
    },
  })
  assert.equal(fuzzyWordScore(query, 'y'.repeat(256)), Infinity)
  assert.ok(characterReads < 4096, `fuzzy matching read ${characterReads} characters for a 256-character word`)
})
