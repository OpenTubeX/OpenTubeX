import assert from 'node:assert/strict'
import test from 'node:test'

import { getNightlyCommit } from '../../src/renderer/helpers/versionDisplay.js'

test('nightly versions include the short build commit', () => {
  assert.equal(
    getNightlyCommit('0.30.2-nightly-625', '7d649ede2b6241065e8793e5cc92819e95610a16'),
    '7d649ed'
  )
})

test('stable versions do not include the build commit', () => {
  assert.equal(
    getNightlyCommit('0.30.2', '7d649ede2b6241065e8793e5cc92819e95610a16'),
    ''
  )
})

test('nightly versions without build metadata keep their current display', () => {
  assert.equal(getNightlyCommit('0.30.2-nightly-625', ''), '')
})
