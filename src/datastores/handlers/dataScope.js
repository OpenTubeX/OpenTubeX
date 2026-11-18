// @ts-check

/** @type {string | null} */
let dataScope = null

/**
 * The data scope that history, watch stats, recommendations, playlists and
 * search history requests use: a separate profile's ID, or null for the data
 * the other profiles share.
 */
export function getDataScope() {
  return dataScope
}

/** @param {string | null} scope */
export function setDataScope(scope) {
  dataScope = scope ?? null
}

/**
 * Runs `operation` with the handlers of another data scope, for work on data
 * the app doesn't show, such as restoring a backup. Requests capture their
 * scope when they are made, so `operation` must make each request
 * synchronously or capture the scope itself.
 * @template T
 * @param {string | null} scope
 * @param {() => T} operation
 * @returns {T}
 */
export function withDataScope(scope, operation) {
  const previous = dataScope
  dataScope = scope ?? null
  try {
    return operation()
  } finally {
    dataScope = previous
  }
}
