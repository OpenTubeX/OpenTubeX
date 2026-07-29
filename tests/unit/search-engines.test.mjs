import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSearchUrl,
  DEFAULT_SEARCH_ENGINES,
  getFaviconUrl,
  isValidSearchUrlTemplate,
  MAX_CUSTOM_SEARCH_ENGINES,
  parseSearchEngines
} from '../../src/searchEngines.js'

test('uses canonical built-ins and preserves their enabled states', () => {
  const engines = parseSearchEngines(JSON.stringify([
    { id: 'duckduckgo', name: 'Changed', url: 'https://example.com/?q=%s', enabled: false }
  ]))

  assert.equal(engines.length, DEFAULT_SEARCH_ENGINES.length)
  assert.deepEqual(engines[0], {
    ...DEFAULT_SEARCH_ENGINES[0],
    icon: '',
    enabled: false
  })
})

test('accepts valid custom engines and rejects unsafe templates', () => {
  const engines = parseSearchEngines([
    {
      id: 'custom-valid',
      name: 'Example',
      url: 'https://example.com/search?q=%s',
      enabled: true
    },
    {
      id: 'custom-unsafe',
      name: 'Unsafe',
      url: 'javascript:alert(%s)',
      enabled: true
    }
  ])

  assert.deepEqual(engines.at(-1), {
    id: 'custom-valid',
    name: 'Example',
    url: 'https://example.com/search?q=%s',
    icon: '',
    enabled: true
  })
  assert.equal(engines.some(engine => engine.id === 'custom-unsafe'), false)
})

test('validates reusable HTTP search URL templates', () => {
  assert.equal(isValidSearchUrlTemplate('https://example.com/search?q=%s'), true)
  assert.equal(isValidSearchUrlTemplate('https://example.com/search'), false)
  assert.equal(isValidSearchUrlTemplate('javascript:alert(%s)'), false)
})

test('caps parsed custom engines at the supported limit', () => {
  const customEngines = Array.from({ length: MAX_CUSTOM_SEARCH_ENGINES + 1 }, (_, index) => ({
    id: `custom-${index}`,
    name: `Engine ${index}`,
    url: `https://example${index}.com/search?q=%s`,
    enabled: true
  }))
  const engines = parseSearchEngines(customEngines)

  assert.equal(
    engines.filter(engine => engine.id.startsWith('custom-')).length,
    MAX_CUSTOM_SEARCH_ENGINES
  )
})

test('resolves custom favicons directly from the engine origin', () => {
  assert.equal(
    getFaviconUrl('https://search.example.com/find?q=%s'),
    'https://search.example.com/favicon.ico'
  )
})

test('encodes selected text when building the search URL', () => {
  assert.equal(
    buildSearchUrl('https://example.com/?q=%s', 'privacy & cats'),
    'https://example.com/?q=privacy%20%26%20cats'
  )
})
