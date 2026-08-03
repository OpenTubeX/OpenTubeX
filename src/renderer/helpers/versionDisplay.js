const NIGHTLY_VERSION_PATTERN = /^\d+\.\d+\.\d+-nightly-\d+$/

/**
 * @param {string} version
 * @param {string} commit
 * @returns {string}
 */
export function getNightlyCommit(version, commit) {
  return NIGHTLY_VERSION_PATTERN.test(version) && commit.length > 0
    ? commit.slice(0, 7)
    : ''
}
