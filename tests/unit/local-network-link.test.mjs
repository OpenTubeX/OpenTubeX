import assert from 'node:assert/strict'
import test from 'node:test'

import { pointsToLocalNetwork } from '../../src/main/localNetworkLink.js'

const hosts = { 'router.example': ['192.168.1.1'], localhost: ['::1', '127.0.0.1'], 'media.example': ['93.184.215.14'] }
const resolveHost = async hostname => {
  if (!Object.hasOwn(hosts, hostname)) throw new Error('ERR_NAME_NOT_RESOLVED')
  return hosts[hostname]
}

test('links to this computer or the local network need confirmation, public ones do not', async () => {
  for (const [url, expected] of [
    ['http://192.168.1.1/admin', true],
    ['http://[::1]:8080/', true],
    ['http://router.example/', true],
    ['http://localhost:3000/', true],
    ['https://media.example/video', false],
    ['https://unresolved.example/', false],
  ]) {
    assert.equal(await pointsToLocalNetwork(url, resolveHost), expected, url)
  }
})
