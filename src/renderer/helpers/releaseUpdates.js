const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta|-nightly-(\d+))?$/

/**
 * @param {string} version
 * @returns {{ channel: 'stable' | 'nightly', parts: number[] } | null}
 */
function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version)
  if (match === null) {
    return null
  }

  const nightlyBuild = match[4]
  return {
    channel: nightlyBuild === undefined ? 'stable' : 'nightly',
    parts: [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      Number.parseInt(match[3], 10),
      nightlyBuild === undefined ? 0 : Number.parseInt(nightlyBuild, 10)
    ]
  }
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @returns {number}
 */
function compareVersionParts(left, right) {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index] - right[index]
    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/**
 * Finds all updates available to the installed build, newest first.
 * Stable builds stay on stable releases, while nightly builds can update to a
 * newer nightly or fall back to a newer stable version.
 *
 * @param {Array<{ draft?: boolean, prerelease?: boolean, tag_name?: string }>} releases
 * @param {string} installedVersion
 * @returns {object[]}
 */
export function findUpdateReleases(releases, installedVersion) {
  const installed = parseVersion(installedVersion)
  if (installed === null) {
    return []
  }

  return releases
    .map((release) => ({
      release,
      version: parseVersion(release.tag_name ?? '')
    }))
    .filter(({ release, version }) => {
      const isNightlyRelease = release.prerelease === true

      return release.draft !== true &&
        version !== null &&
        isNightlyRelease === (version.channel === 'nightly') &&
        !(installed.channel === 'stable' && version.channel === 'nightly') &&
        compareVersionParts(version.parts, installed.parts) > 0
    })
    .sort((left, right) => compareVersionParts(right.version.parts, left.version.parts))
    .map(({ release }) => release)
}

/**
 * Finds the newest update available to the installed build.
 *
 * @param {Array<{ draft?: boolean, prerelease?: boolean, tag_name?: string }>} releases
 * @param {string} installedVersion
 * @returns {object | null}
 */
export function findUpdateRelease(releases, installedVersion) {
  return findUpdateReleases(releases, installedVersion)[0] ?? null
}

/**
 * Combines release notes into a changelog with a heading for each release.
 *
 * @param {Array<{ body?: string | null, name?: string | null, tag_name?: string }>} releases
 * @returns {string}
 */
export function formatReleaseChangelog(releases) {
  return releases.map((release) => {
    const title = release.name ?? release.tag_name ?? ''
    return `## ${title}\n\n${release.body ?? ''}`
  }).join('\n\n')
}
