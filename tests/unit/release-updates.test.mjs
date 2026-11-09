import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchReleasePages,
  findUpdateRelease,
  findUpdateReleases,
  scheduleUpdateChecks
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

test('updates from later release pages are included', async () => {
  const firstPageUrl = 'https://api.github.com/releases?per_page=100'
  const secondPageUrl = 'https://api.github.com/releases?per_page=100&page=2'
  const patchRelease = {
    name: 'OpenTubeX 0.30.1',
    prerelease: false,
    tag_name: 'v0.30.1-beta'
  }
  const pages = new Map([
    [firstPageUrl, {
      link: `<${secondPageUrl}>; rel="next", <${secondPageUrl}>; rel="last"`,
      releases: [patchRelease]
    }],
    [secondPageUrl, {
      link: null,
      releases: [stableRelease]
    }]
  ])
  const requestedUrls = []

  const releases = await fetchReleasePages(firstPageUrl, async (url) => {
    requestedUrls.push(url)
    const page = pages.get(url)

    return {
      ok: true,
      status: 200,
      headers: {
        get: () => page.link
      },
      json: async () => page.releases
    }
  }, '0.29.0')

  assert.deepEqual(requestedUrls, [firstPageUrl, secondPageUrl])
  assert.deepEqual(
    findUpdateReleases(releases, '0.29.0'),
    [patchRelease, stableRelease]
  )
})

test('stops paging once a page reaches releases that are not newer than the installed build', async () => {
  const pageUrl = page => `https://api.github.com/releases?per_page=10&page=${page}`
  const pages = [
    [{ prerelease: false, tag_name: 'v0.31.0-beta' }, { prerelease: true, tag_name: 'v0.30.1-nightly-350' }],
    [{ prerelease: false, tag_name: 'v0.30.1-beta' }, { prerelease: false, tag_name: 'v0.29.0-beta' }],
    [{ prerelease: false, tag_name: 'v0.28.0-beta' }]
  ]
  const requestedUrls = []
  const fetchPage = async (url) => {
    requestedUrls.push(url)
    const page = Number(new URL(url).searchParams.get('page'))
    return {
      ok: true,
      status: 200,
      headers: { get: () => page < pages.length ? `<${pageUrl(page + 1)}>; rel="next"` : null },
      json: async () => pages[page - 1]
    }
  }

  const releases = await fetchReleasePages(pageUrl(1), fetchPage, '0.29.0')
  assert.deepEqual(requestedUrls, [pageUrl(1), pageUrl(2)])
  assert.deepEqual(findUpdateReleases(releases, '0.29.0').map(release => release.tag_name), ['v0.31.0-beta', 'v0.30.1-beta'])

  // Nightly releases older than the installed one also end the search
  requestedUrls.length = 0
  await fetchReleasePages(pageUrl(1), fetchPage, '0.30.1-nightly-400')
  assert.deepEqual(requestedUrls, [pageUrl(1)])
})

test('keeps paging past a stable release listed ahead of newer nightlies', async () => {
  // GitHub's order for these releases, which lists each stable release ahead
  // of the nightlies built on its version
  const pageUrl = page => `https://api.github.com/releases?per_page=3&page=${page}`
  const pages = [
    ['v0.37.3-beta', 'v0.37.2-nightly-2633', 'v0.37.2-beta'],
    ['v0.37.2-nightly-2600', 'v0.37.1-beta'],
    ['v0.37.1-nightly-2559']
  ].map(tags => tags.map(tag_name => ({ prerelease: tag_name.includes('nightly'), tag_name })))
  const requestedUrls = []
  const releases = await fetchReleasePages(pageUrl(1), async (url) => {
    requestedUrls.push(url)
    const page = Number(new URL(url).searchParams.get('page'))
    return {
      ok: true,
      status: 200,
      headers: { get: () => page < pages.length ? `<${pageUrl(page + 1)}>; rel="next"` : null },
      json: async () => pages[page - 1]
    }
  }, '0.37.2-nightly-2590')

  assert.deepEqual(requestedUrls, [pageUrl(1), pageUrl(2), pageUrl(3)])
  assert.deepEqual(
    findUpdateReleases(releases, '0.37.2-nightly-2590').map(release => release.tag_name),
    ['v0.37.3-beta', 'v0.37.2-nightly-2633', 'v0.37.2-nightly-2600']
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

test('scheduleUpdateChecks repeats checks by wall-clock time', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const hour = 60 * 60 * 1000
  const visibility = Object.assign(new EventTarget(), { hidden: false })
  let checks = 0
  const stop = scheduleUpdateChecks(() => { checks++ }, 6 * hour, visibility)

  t.mock.timers.tick(6 * hour - 1)
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(checks, 0)

  t.mock.timers.tick(15 * 60 * 1000)
  assert.equal(checks, 1)

  // A suspended app's timers fall behind the clock, so becoming visible checks
  t.mock.timers.setTime(Date.now() + 7 * hour)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(15 * 60 * 1000)
  assert.equal(checks, 1)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(checks, 2)
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(checks, 2)

  stop()
  t.mock.timers.tick(12 * hour)
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(checks, 2)
})
