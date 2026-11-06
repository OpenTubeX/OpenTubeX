/**
 * Channel sections share one avatar owner; other pages keep their own path.
 * @param {string | undefined} path
 * @returns {string | undefined}
 */
export function getTabAvatarPath(path) {
  return path?.match(/^\/channel\/[^/]+/)?.[0] ?? path
}
