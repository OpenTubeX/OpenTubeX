export const OPEN_COMMAND_PALETTE_EVENT = 'opentubex:open-command-palette'

/**
 * Normalizes command text without losing words written in non-Latin scripts.
 * @param {string} value
 * @param {string} locale
 * @returns {string}
 */
export function normalizeCommandText(value, locale) {
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

function findSubsequenceIndexes(query, candidate) {
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

function fuzzyWordScore(query, candidate) {
  const allowedEdits = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0
  if (allowedEdits > 0 && Math.abs(query.length - candidate.length) <= allowedEdits) {
    const distance = editDistance(query, candidate)
    if (distance <= allowedEdits) return 8 + distance * 2 + Math.abs(query.length - candidate.length) / 4
  }
  return subsequenceScore(query, candidate)
}

function fuzzyTextScore(query, candidate) {
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

function scoreCommand(query, command, locale) {
  const fields = [
    { value: normalizeCommandText(command.label, locale), weight: 0 },
    ...(command.aliases ?? []).map(alias => ({
      value: normalizeCommandText(alias, locale),
      weight: 3,
    })),
    { value: normalizeCommandText(command.group, locale), weight: 6 },
  ]

  let score = Math.min(...fields.map(field => fuzzyTextScore(query, field.value) + field.weight))
  if (!Number.isFinite(score)) {
    score = 24
    for (const token of query.split(' ')) {
      const tokenScore = Math.min(...fields.map(field => fuzzyTextScore(token, field.value) + field.weight))
      if (!Number.isFinite(tokenScore)) return Number.POSITIVE_INFINITY
      score += tokenScore
    }
  }

  return score + (command.searchOnly ? 20 : 0)
}

/**
 * Fuzzy matches command labels, aliases, and groups. The original registry
 * order breaks score ties, so broad searches stay predictable as commands
 * update around the active tab.
 * @param {Array<{id: string, label: string, group: string, aliases?: string[]}>} commands
 * @param {string} query
 * @param {string} locale
 * @returns {Array<object>}
 */
export function filterCommandPaletteCommands(commands, query, locale) {
  const normalizedQuery = normalizeCommandText(query, locale)
  if (normalizedQuery === '') return commands

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(normalizedQuery, command, locale) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .map(({ command }) => command)
}

function normalizedCharacterMap(value, locale) {
  const characters = Array.from(value)
  const normalizedCharacters = characters.flatMap((character, index) => (
    Array.from(character.toLocaleLowerCase(locale).normalize('NFKD'))
      .filter(normalizedCharacter => !/\p{Mark}/u.test(normalizedCharacter))
      .map(normalizedCharacter => ({ value: normalizedCharacter, originalIndex: index }))
  ))
  return { characters, normalizedCharacters }
}

function tokenHighlightIndexes(token, normalizedCharacters) {
  const candidate = normalizedCharacters.map(character => character.value).join('')
  const exactIndex = candidate.indexOf(token)
  if (exactIndex !== -1) {
    return Array.from({ length: token.length }, (_, index) => exactIndex + index)
  }

  let bestMatch = null
  for (const match of candidate.matchAll(/\S+/gu)) {
    const word = match[0]
    const score = fuzzyWordScore(token, word)
    if (!Number.isFinite(score) || (bestMatch && bestMatch.score <= score)) continue

    const subsequenceIndexes = findSubsequenceIndexes(token, word)
    bestMatch = {
      score,
      indexes: subsequenceIndexes
        ? subsequenceIndexes.map(index => match.index + index)
        : Array.from({ length: word.length }, (_, index) => match.index + index),
    }
  }
  if (bestMatch) return bestMatch.indexes

  const compactCharacters = normalizedCharacters.filter(character => !/\s/u.test(character.value))
  const compactCandidate = compactCharacters.map(character => character.value).join('')
  return findSubsequenceIndexes(token, compactCandidate)
    ?.map(index => normalizedCharacters.indexOf(compactCharacters[index])) ?? []
}

/**
 * Splits visible command text into plain and highlighted fuzzy-match segments.
 * @param {string} value
 * @param {string} query
 * @param {string} locale
 * @returns {Array<{text: string, highlighted: boolean}>}
 */
export function highlightCommandText(value, query, locale) {
  const normalizedQuery = normalizeCommandText(query, locale)
  const { characters, normalizedCharacters } = normalizedCharacterMap(value, locale)
  if (normalizedQuery === '') return [{ text: value, highlighted: false }]

  const highlightedIndexes = new Set()
  for (const token of normalizedQuery.split(' ')) {
    for (const index of tokenHighlightIndexes(token, normalizedCharacters)) {
      highlightedIndexes.add(normalizedCharacters[index].originalIndex)
    }
  }

  const segments = []
  for (let index = 0; index < characters.length; index++) {
    const highlighted = highlightedIndexes.has(index)
    const lastSegment = segments.at(-1)
    if (lastSegment?.highlighted === highlighted) {
      lastSegment.text += characters[index]
    } else {
      segments.push({ text: characters[index], highlighted })
    }
  }
  return segments
}

/**
 * Builds a synthetic key event for existing renderer shortcut handlers. This
 * lets palette commands invoke the same player action code as the keyboard.
 * @param {string} shortcut
 * @returns {KeyboardEventInit}
 */
export function keyboardEventInitFromShortcut(shortcut) {
  const parts = shortcut.toLowerCase().split('+')
  let key = parts.pop() ?? ''

  const implicitShiftKeys = new Set(['!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', 'plus', ':', '<', '>', '?', '@', '^', '_', '{', '|', '}'])
  const keyValues = {
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    end: 'End',
    home: 'Home',
    minus: '-',
    plus: '+',
    space: ' ',
  }
  key = keyValues[key] ?? key

  const usesPortableControl = parts.includes('ctrl')
  const usesPhysicalControl = parts.includes('control')

  return {
    key,
    code: key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : '',
    bubbles: true,
    cancelable: true,
    ctrlKey: usesPhysicalControl || (usesPortableControl && process.platform !== 'darwin'),
    metaKey: parts.includes('cmd') || (usesPortableControl && process.platform === 'darwin'),
    altKey: parts.includes('alt') || parts.includes('option'),
    shiftKey: parts.includes('shift') || implicitShiftKeys.has(key.toLowerCase()),
  }
}
