/**
 * Normalizes search text without losing words written in non-Latin scripts.
 * @param {string} value
 * @param {string} locale
 * @returns {string}
 */
export function normalizeSearchText(value, locale) {
  return value
    .toLocaleLowerCase(locale)
    .normalize('NFKD')
    .replaceAll(/\p{Mark}/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function editDistance(first, second) {
  const rows = Array.from(
    { length: first.length + 1 },
    (_, row) => Array(second.length + 1).fill(row === 0 ? 0 : row)
  )
  for (let column = 0; column <= second.length; column++) rows[0][column] = column

  for (let row = 1; row <= first.length; row++) {
    for (let column = 1; column <= second.length; column++) {
      const substitutionCost = first[row - 1] === second[column - 1] ? 0 : 1
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitutionCost
      )
      if (
        row > 1 &&
        column > 1 &&
        first[row - 1] === second[column - 2] &&
        first[row - 2] === second[column - 1]
      ) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1)
      }
    }
  }

  return rows[first.length][second.length]
}

export function findSubsequenceIndexes(query, candidate) {
  if (query.length < 3) return null

  const indexes = []
  let queryIndex = 0
  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < query.length; candidateIndex++) {
    if (candidate[candidateIndex] !== query[queryIndex]) continue
    indexes.push(candidateIndex)
    queryIndex++
  }

  if (queryIndex !== query.length) return null
  const span = indexes.at(-1) - indexes[0] + 1
  return span <= query.length * 2 + 2 ? indexes : null
}

function subsequenceScore(query, candidate) {
  const indexes = findSubsequenceIndexes(query, candidate)
  if (!indexes) return Number.POSITIVE_INFINITY

  const gaps = indexes.slice(1).reduce((total, index, position) => (
    total + index - indexes[position] - 1
  ), 0)
  return 12 + indexes[0] / 4 + gaps
}

export function fuzzyWordScore(query, candidate) {
  const allowedEdits = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0
  if (allowedEdits > 0 && Math.abs(query.length - candidate.length) <= allowedEdits) {
    const distance = editDistance(query, candidate)
    if (distance <= allowedEdits) return 8 + distance * 2 + Math.abs(query.length - candidate.length) / 4
  }
  return subsequenceScore(query, candidate)
}

export function fuzzyTextScore(query, candidate) {
  if (candidate === query) return 0
  if (candidate.startsWith(query)) return 1 + (candidate.length - query.length) / 100

  const words = candidate.split(' ')
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    if (word === query) return 2 + index / 100
    if (word.startsWith(query)) bestScore = Math.min(bestScore, 3 + index / 100)
  }
  if (candidate.includes(query)) bestScore = Math.min(bestScore, 4 + candidate.indexOf(query) / 100)

  for (let index = 0; index < words.length; index++) {
    bestScore = Math.min(bestScore, fuzzyWordScore(query, words[index]) + index / 100)
  }

  const compactCandidate = candidate.replaceAll(' ', '')
  return Math.min(bestScore, subsequenceScore(query.replaceAll(' ', ''), compactCandidate) + 4)
}
