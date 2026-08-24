import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterCommandPaletteCommands,
  highlightCommandText,
  keyboardEventInitFromShortcut,
  normalizeCommandText,
} from '../../src/renderer/helpers/commandPalette.js'

const commands = [
  { id: 'history', label: 'History', group: 'Navigation', aliases: ['watched videos'] },
  { id: 'settings-history', label: 'Privacy and history', group: 'Settings', aliases: [] },
  { id: 'captions', label: 'Sous-titres', group: 'Lecture', aliases: ['captions', 'cc'] },
]

test('normalizes localized command text for accent-insensitive matching', () => {
  assert.equal(normalizeCommandText('  Résumé   vidéo ', 'fr-FR'), 'resume video')
})

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

test('splits exact command label matches into highlighted text segments', () => {
  assert.deepEqual(highlightCommandText('Switch to Tab: Home', 'tab', 'en-US'), [{
    text: 'Switch to ',
    highlighted: false,
  }, {
    text: 'Tab',
    highlighted: true,
  }, {
    text: ': Home',
    highlighted: false,
  }])
})

test('highlights the characters that produced a fuzzy label match', () => {
  const segments = highlightCommandText('History', 'hstry', 'en-US')
  assert.equal(segments.map(segment => segment.text).join(''), 'History')
  assert.equal(
    segments.filter(segment => segment.highlighted).map(segment => segment.text).join(''),
    'Hstry'
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
