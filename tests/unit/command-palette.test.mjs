import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterCommandPaletteCommands,
  highlightCommandText,
  keyboardEventInitFromShortcut,
} from '../../src/renderer/helpers/commandPalette.js'

const commands = [
  { id: 'history', label: 'History', group: 'Navigation', aliases: ['watched videos'] },
  { id: 'settings-history', label: 'Privacy and history', group: 'Settings', aliases: [] },
  { id: 'captions', label: 'Sous-titres', group: 'Lecture', aliases: ['captions', 'cc'] },
]

test('ranks exact labels before broader label matches', () => {
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'history', 'en-US').map(command => command.id),
    ['history', 'settings-history']
  )
})

test('matches common aliases and every query token', () => {
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'watched videos', 'en-US').map(command => command.id),
    ['history']
  )
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'captions lecture', 'en-US').map(command => command.id),
    ['captions']
  )
})

test('fuzzy matches omitted characters and adjacent transpositions', () => {
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'hstry', 'en-US').map(command => command.id),
    ['history', 'settings-history']
  )
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'hsitory', 'en-US').map(command => command.id),
    ['history', 'settings-history']
  )
})

test('fuzzy matches every token across aliases and groups', () => {
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'wtchd vdeos navgation', 'en-US').map(command => command.id),
    ['history']
  )
})

test('does not return unrelated commands for a fuzzy query', () => {
  assert.deepEqual(
    filterCommandPaletteCommands(commands, 'zzzzzz', 'en-US'),
    []
  )
})

test('keeps direct actions ahead of settings search results', () => {
  const overlappingCommands = [{
    id: 'action',
    label: 'Toggle captions ON/OFF',
    group: 'Playback',
    aliases: ['captions']
  }, {
    id: 'setting',
    label: 'Captions',
    group: 'Settings',
    aliases: [],
    searchOnly: true
  }]

  assert.deepEqual(
    filterCommandPaletteCommands(overlappingCommands, 'captions', 'en-US')
      .map(command => command.id),
    ['action', 'setting']
  )
})

test('converts configured shortcuts into keyboard event data', () => {
  assert.deepEqual(keyboardEventInitFromShortcut('ctrl+shift+k'), {
    key: 'k',
    code: 'KeyK',
    bubbles: true,
    cancelable: true,
    ctrlKey: process.platform !== 'darwin',
    metaKey: process.platform === 'darwin',
    altKey: false,
    shiftKey: true,
  })
})

test('highlights exact, fuzzy, and compact matches in labels containing surrogate pairs', () => {
  // Exact match at the end of a label with leading emojis (UTF-16 offset >= code point count)
  assert.deepEqual(highlightCommandText('🎬 Trailer', 'r', 'en-US'), [
    { text: '🎬 T', highlighted: false },
    { text: 'r', highlighted: true },
    { text: 'ailer', highlighted: false },
  ])
  assert.deepEqual(highlightCommandText('🎬 abcr', 'r', 'en-US'), [
    { text: '🎬 abc', highlighted: false },
    { text: 'r', highlighted: true },
  ])

  // Matching the surrogate pair itself
  assert.deepEqual(highlightCommandText('Watch 🎬 clip', '🎬', 'en-US'), [
    { text: 'Watch ', highlighted: false },
    { text: '🎬', highlighted: true },
    { text: ' clip', highlighted: false },
  ])

  // Fuzzy word subsequence and edit-distance matches after surrogate pairs
  assert.deepEqual(highlightCommandText('🎬🎬🎬 history', 'hstry', 'en-US'), [
    { text: '🎬🎬🎬 ', highlighted: false },
    { text: 'h', highlighted: true },
    { text: 'i', highlighted: false },
    { text: 'st', highlighted: true },
    { text: 'o', highlighted: false },
    { text: 'ry', highlighted: true },
  ])
  assert.deepEqual(highlightCommandText('🎬🎬🎬 history', 'hsitory', 'en-US'), [
    { text: '🎬🎬🎬 ', highlighted: false },
    { text: 'history', highlighted: true },
  ])

  // Compact multi-word subsequence match after surrogate pairs
  assert.deepEqual(highlightCommandText('🎬🎬 foo bar', 'fbr', 'en-US'), [
    { text: '🎬🎬 ', highlighted: false },
    { text: 'f', highlighted: true },
    { text: 'oo ', highlighted: false },
    { text: 'b', highlighted: true },
    { text: 'a', highlighted: false },
    { text: 'r', highlighted: true },
  ])
})
