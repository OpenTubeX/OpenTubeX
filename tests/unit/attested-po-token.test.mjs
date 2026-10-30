import assert from 'node:assert/strict'
import test from 'node:test'
import { mintAttestedPoToken } from '../../src/main/attestedPoToken.js'

const attested = 'a'.repeat(120)
const pending = 'p'.repeat(124)

test('an attested token is minted once', async () => {
  let mints = 0
  const token = await mintAttestedPoToken(async () => {
    mints++
    return attested
  })
  assert.equal(token, attested)
  assert.equal(mints, 1)
})

test('a longer token pending attestation is minted again', async () => {
  const tokens = [pending, pending, attested]
  const token = await mintAttestedPoToken(async () => tokens.shift())
  assert.equal(token, attested)
  assert.equal(tokens.length, 0)
})

test('the last token is used once the attempts run out', async () => {
  let mints = 0
  const token = await mintAttestedPoToken(async () => `${++mints}`.padEnd(124, 'p'))
  assert.equal(token, '3'.padEnd(124, 'p'))
  assert.equal(mints, 3)
})
