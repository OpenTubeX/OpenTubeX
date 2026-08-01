import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findUpdateRelease,
  findUpdateReleases,
  formatReleaseChangelog
} from '../../src/renderer/helpers/releaseUpdates.js'

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

test('nightly builds update to newer nightly prereleases', () => {
  const nightlyRelease = {
    name: 'OpenTubeX nightly 101',
    prerelease: true,
    tag_name: 'v0.29.0-nightly-101'
  }

  assert.equal(
    findUpdateRelease([nightlyRelease], '0.29.0-nightly-100'),
    nightlyRelease
  )
})

test('nightly builds fall back to a newer stable release', () => {
  const newerStableRelease = {
    name: 'OpenTubeX 0.30.1',
    prerelease: false,
    tag_name: 'v0.30.1-beta'
  }

  assert.equal(
    findUpdateRelease([newerStableRelease], '0.30.0-nightly-595'),
    newerStableRelease
  )
})

test('nightly builds prefer a newer stable version over an older-version nightly', () => {
  const newerNightlyRelease = {
    prerelease: true,
    tag_name: 'v0.30.0-nightly-596'
  }
  const newerStableRelease = {
    prerelease: false,
    tag_name: 'v0.30.1-beta'
  }

  assert.equal(
    findUpdateRelease(
      [newerNightlyRelease, newerStableRelease],
      '0.30.0-nightly-595'
    ),
    newerStableRelease
  )
})

test('nightly builds prefer a newer nightly over stable for the same version', () => {
  const newerStableRelease = {
    prerelease: false,
    tag_name: 'v0.30.1-beta'
  }
  const newerNightlyRelease = {
    prerelease: true,
    tag_name: 'v0.30.1-nightly-600'
  }

  assert.equal(
    findUpdateRelease(
      [newerStableRelease, newerNightlyRelease],
      '0.30.0-nightly-595'
    ),
    newerNightlyRelease
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

test('all skipped stable releases are returned newest first', () => {
  const patchRelease = {
    name: 'OpenTubeX 0.30.1',
    prerelease: false,
    tag_name: 'v0.30.1-beta'
  }

  assert.deepEqual(
    findUpdateReleases([stableRelease, patchRelease], '0.29.0'),
    [patchRelease, stableRelease]
  )
})

test('installed and older releases are excluded from skipped releases', () => {
  const installedRelease = {
    prerelease: false,
    tag_name: 'v0.29.0-beta'
  }
  const olderRelease = {
    prerelease: false,
    tag_name: 'v0.28.0-beta'
  }

  assert.deepEqual(
    findUpdateReleases([stableRelease, installedRelease, olderRelease], '0.29.0'),
    [stableRelease]
  )
})

test('release changelogs contain the notes for every update', () => {
  const releases = [
    {
      name: 'OpenTubeX 0.30.1',
      tag_name: 'v0.30.1-beta',
      body: 'Patch release notes'
    },
    {
      name: 'OpenTubeX 0.30.0',
      tag_name: 'v0.30.0-beta',
      body: 'Minor release notes'
    }
  ]

  assert.equal(
    formatReleaseChangelog(releases),
    '## OpenTubeX 0.30.1\n\nPatch release notes\n\n## OpenTubeX 0.30.0\n\nMinor release notes'
  )
})
