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

test('wraps IPv6 hosts in brackets', () => {
  assert.equal(buildProxyUrl({
    protocol: 'socks5',
    hostname: '::1',
    port: '9050'
  }), 'socks5://[::1]:9050')

  assert.equal(buildProxyUrl({
    protocol: 'http',
    hostname: '2001:db8::1',
    port: '8080',
    username: 'user',
    password: 'pass'
  }), 'http://user:pass@[2001:db8::1]:8080')

  // already bracketed hosts are left alone
  assert.equal(buildProxyUrl({
    protocol: 'socks5',
    hostname: '[::1]',
    port: '9050'
  }), 'socks5://[::1]:9050')
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

// settings are only written to the database once they get changed,
// so unchanged proxy settings are missing entirely
test('falls back to the default proxy settings', () => {
  assert.equal(buildProxyUrl({}), 'socks5://127.0.0.1:9050')
  assert.equal(buildProxyUrl({ hostname: 'proxy.example.com' }), 'socks5://proxy.example.com:9050')
  assert.equal(buildProxyUrl({ protocol: 'http', port: '8080' }), 'http://127.0.0.1:8080')
  assert.equal(buildProxyUrl({ protocol: '', hostname: '', port: '' }), 'socks5://127.0.0.1:9050')
  assert.equal(buildProxyUrl({ username: 'user', password: 'pass' }), 'socks5://user:pass@127.0.0.1:9050')
})
