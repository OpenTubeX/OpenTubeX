import assert from 'node:assert/strict'
import test from 'node:test'

import { getLocaleLoadSequence, resolveLocalePreference } from '../../src/renderer/helpers/settingLocaleSelection.js'

test('system locale selects the exact region, then the language fallback', () => {
  const locales = ['en-US', 'de-DE', 'es', 'es-AR', 'pt-PT']
  assert.deepEqual(resolveLocalePreference('system', 'es_AR', locales), {
    locale: 'es-AR', unavailable: false
  })
  assert.deepEqual(resolveLocalePreference('system', 'es-MX', locales), {
    locale: 'es', unavailable: false
  })
  assert.deepEqual(resolveLocalePreference('system', 'zz-ZZ', locales), {
    locale: 'en-US', unavailable: true
  })
})

test('explicit locale and fallback load order preserve the existing chain', () => {
  assert.deepEqual(resolveLocalePreference('de-DE', 'es-AR', ['en-US']), {
    locale: 'de-DE', unavailable: false
  })
  assert.deepEqual(getLocaleLoadSequence('es-AR'), ['en-US', 'es', 'es-AR'])
  assert.deepEqual(getLocaleLoadSequence('pt-BR'), ['en-US', 'pt', 'pt-BR'])
  assert.deepEqual(getLocaleLoadSequence('en-US'), ['en-US'])
})
