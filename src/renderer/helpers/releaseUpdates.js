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
 * Finds the newest update on the installed build's release channel.
 *
 * @param {Array<{ draft?: boolean, prerelease?: boolean, tag_name?: string }>} releases
 * @param {string} installedVersion
 * @returns {object | null}
 */
export function findUpdateRelease(releases, installedVersion) {
  const installed = parseVersion(installedVersion)
  if (installed === null) {
    return null
  }

  let latestRelease = null
  let latestVersion = installed

  for (const release of releases) {
    const releaseVersion = parseVersion(release.tag_name ?? '')
    const isNightlyRelease = release.prerelease === true

    if (
      release.draft === true ||
      releaseVersion === null ||
      releaseVersion.channel !== installed.channel ||
      isNightlyRelease !== (installed.channel === 'nightly') ||
      compareVersionParts(releaseVersion.parts, latestVersion.parts) <= 0
    ) {
      continue
    }

    latestRelease = release
    latestVersion = releaseVersion
  }

  return latestRelease
}
