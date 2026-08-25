import assert from 'node:assert/strict'
import test from 'node:test'

import { isInvidiousInstanceUrl } from '../../src/main/invidiousAuthorization.js'

test('matches requests within the configured Invidious instance', () => {
  assert.equal(isInvidiousInstanceUrl(
    'https://invidious.example/api/v1/search?q=test',
    'https://invidious.example'
  ), true)
  assert.equal(isInvidiousInstanceUrl(
    'https://example.test/invidious/api/v1/search?q=test',
    'https://example.test/invidious'
  ), true)
})

test('rejects look-alike Invidious hosts and paths', () => {
  const instanceUrl = 'https://invidious.example/base'
  const untrustedUrls = [
    'https://invidious.example.attacker.test/base/api/v1/search',
    'https://invidious.example/base-attacker/api/v1/search',
    'http://invidious.example/base/api/v1/search'
  ]

  for (const url of untrustedUrls) {
    assert.equal(isInvidiousInstanceUrl(url, instanceUrl), false)
  }
})

test('rejects invalid Invidious URLs', () => {
  assert.equal(isInvidiousInstanceUrl('not a URL', 'https://invidious.example'), false)
  assert.equal(isInvidiousInstanceUrl('https://invidious.example', 'not a URL'), false)
})
