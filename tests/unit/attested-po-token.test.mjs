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

test('a failed retry keeps the token pending attestation', async () => {
  let mints = 0
  const token = await mintAttestedPoToken(async () => {
    if (++mints > 1) throw new Error('timed out')
    return pending
  })
  assert.equal(token, pending)
  assert.equal(mints, 2)
})

test('a failed first mint still rejects', async () => {
  await assert.rejects(mintAttestedPoToken(async () => {
    throw new Error('timed out')
  }), /timed out/)
})

test('the last token is used once the attempts run out', async () => {
  let mints = 0
  const token = await mintAttestedPoToken(async () => `${++mints}`.padEnd(124, 'p'))
  assert.equal(token, '3'.padEnd(124, 'p'))
  assert.equal(mints, 3)
})
