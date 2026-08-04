import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProxyUrl } from '../../src/main/utils.js'

test('builds a proxy URL from the proxy settings', () => {
  assert.equal(buildProxyUrl({
    protocol: 'socks5',
    hostname: '127.0.0.1',
    port: '9050'
  }), 'socks5://127.0.0.1:9050')

  assert.equal(buildProxyUrl({
    protocol: 'http',
    hostname: 'proxy.example.com',
    port: 8080
  }), 'http://proxy.example.com:8080')
})

test('includes escaped proxy credentials', () => {
  assert.equal(buildProxyUrl({
    protocol: 'socks5',
    hostname: '127.0.0.1',
    port: '9050',
    username: 'user',
    password: 'p@ss:word'
  }), 'socks5://user:p%40ss%3Aword@127.0.0.1:9050')

  assert.equal(buildProxyUrl({
    protocol: 'socks5',
    hostname: '127.0.0.1',
    port: '9050',
    username: 'user'
  }), 'socks5://user:@127.0.0.1:9050')

  // a password without a username can't be represented, so it is ignored
  assert.equal(buildProxyUrl({
    protocol: 'socks5',
    hostname: '127.0.0.1',
    port: '9050',
    password: 'secret'
  }), 'socks5://127.0.0.1:9050')
})

test('returns null for incomplete proxy settings', () => {
  assert.equal(buildProxyUrl({ hostname: '127.0.0.1', port: '9050' }), null)
  assert.equal(buildProxyUrl({ protocol: 'socks5', port: '9050' }), null)
  assert.equal(buildProxyUrl({ protocol: 'socks5', hostname: '127.0.0.1' }), null)
  assert.equal(buildProxyUrl({ protocol: 'socks5', hostname: '', port: '9050' }), null)
  assert.equal(buildProxyUrl({}), null)
})
