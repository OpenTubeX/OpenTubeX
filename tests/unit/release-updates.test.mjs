import assert from 'node:assert/strict'
import test from 'node:test'

import { findUpdateRelease } from '../../src/renderer/helpers/releaseUpdates.js'

const stableRelease = {
  name: 'OpenTubeX 0.30.0',
  prerelease: false,
  tag_name: 'v0.30.0-beta'
}

test('stable builds only update from normal GitHub releases', () => {
  const nightlyRelease = {
    name: 'OpenTubeX nightly 200',
    prerelease: true,
    tag_name: 'v0.31.0-nightly-200'
  }

  assert.equal(
    findUpdateRelease([nightlyRelease, stableRelease], '0.29.0'),
    stableRelease
  )
})

test('nightly builds only update from nightly prereleases', () => {
  const nightlyRelease = {
    name: 'OpenTubeX nightly 101',
    prerelease: true,
    tag_name: 'v0.29.0-nightly-101'
  }

  assert.equal(
    findUpdateRelease([stableRelease, nightlyRelease], '0.29.0-nightly-100'),
    nightlyRelease
  )
})

test('nightly build numbers are compared as complete numeric identifiers', () => {
  const olderNightly = {
    prerelease: true,
    tag_name: 'v0.29.0-nightly-99'
  }
  const newerNightly = {
    prerelease: true,
    tag_name: 'v0.29.0-nightly-101'
  }

  assert.equal(
    findUpdateRelease([olderNightly, newerNightly], '0.29.0-nightly-100'),
    newerNightly
  )
  assert.equal(
    findUpdateRelease([olderNightly], '0.29.0-nightly-100'),
    null
  )
})

test('the newest semantic version is selected regardless of API order', () => {
  const newerStableRelease = {
    prerelease: false,
    tag_name: 'v1.0.0-beta'
  }

  assert.equal(
    findUpdateRelease([newerStableRelease, stableRelease], '0.29.0'),
    newerStableRelease
  )
})
