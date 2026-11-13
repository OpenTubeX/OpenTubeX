/**
 * @typedef {object} SearchCorrection
 * @property {'showingResultsFor' | 'includingResultsFor' | 'didYouMean'} type
 * @property {string} correctedQuery
 * @property {boolean} canSearchOriginal YouTube offers no uncorrected search for
 * some queries, such as hashtags, and ignores the request to turn correction off
 */

const CORRECTION_TYPES = {
  ShowingResultsFor: 'showingResultsFor',
  IncludingResultsFor: 'includingResultsFor',
  DidYouMean: 'didYouMean'
}

// Protobuf field 8 ({ 1: 1 }), which YouTube adds to the params of its
// "Search instead for" link to turn off spelling correction.
const NO_SPELL_CORRECTION_BYTES = [0x42, 0x02, 0x08, 0x01]

/**
 * @param {{ type: string, corrected_query?: { toString(): string }, original_query_endpoint?: unknown }[] | undefined} results
 * @returns {SearchCorrection | null}
 */
export function parseSearchCorrection(results) {
  const node = results?.find(item => Object.hasOwn(CORRECTION_TYPES, item.type))
  const correctedQuery = node?.corrected_query?.toString().trim()

  return correctedQuery
    ? { type: CORRECTION_TYPES[node.type], correctedQuery, canSearchOriginal: node.original_query_endpoint !== undefined }
    : null
}

/**
 * Appending a field to encoded protobuf params merges it with the existing
 * filters, so the user's filters still apply.
 * @param {string} params URL-encoded base64 search params
 * @returns {string}
 */
export function disableSearchSpellCorrection(params) {
  const bytes = Array.from(atob(decodeURIComponent(params)), char => char.charCodeAt(0))
  return encodeURIComponent(btoa(String.fromCharCode(...bytes, ...NO_SPELL_CORRECTION_BYTES)))
}
