import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProxyUrl, isNonPublicNetworkAddress, isOpenTubeXUrl } from '../../src/main/utils.js'

test('identifies network addresses which are unsafe for untrusted fetches', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '[::ffff:127.0.0.1]',
    'fc00::1',
    'fe80::1',
    'not-an-address'
  ]) {
    assert.equal(isNonPublicNetworkAddress(address), true, address)
  }

  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isNonPublicNetworkAddress(address), false, address)
  }
})
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

test('recognizes the configured development server origin', () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousPort = process.env.OPENTUBEX_DEV_SERVER_PORT

  try {
    process.env.NODE_ENV = 'development'
    process.env.OPENTUBEX_DEV_SERVER_PORT = '12345'

    assert.equal(isOpenTubeXUrl('http://localhost:12345/'), true)
    assert.equal(isOpenTubeXUrl('http://localhost:12345/index.html'), true)
    assert.equal(isOpenTubeXUrl('http://localhost:9080/'), false)
    assert.equal(isOpenTubeXUrl('http://127.0.0.1:12345/'), false)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv

    if (previousPort === undefined) delete process.env.OPENTUBEX_DEV_SERVER_PORT
    else process.env.OPENTUBEX_DEV_SERVER_PORT = previousPort
  }
})

test('uses the default development server origin without an override', () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousPort = process.env.OPENTUBEX_DEV_SERVER_PORT

  try {
    process.env.NODE_ENV = 'development'
    delete process.env.OPENTUBEX_DEV_SERVER_PORT

    assert.equal(isOpenTubeXUrl('http://localhost:9080/'), true)
    assert.equal(isOpenTubeXUrl('http://localhost:12345/'), false)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv

    if (previousPort === undefined) delete process.env.OPENTUBEX_DEV_SERVER_PORT
    else process.env.OPENTUBEX_DEV_SERVER_PORT = previousPort
  }
})
