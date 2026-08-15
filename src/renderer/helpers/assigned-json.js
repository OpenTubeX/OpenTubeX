/**
 * Extracts the JSON object assigned to a named JavaScript variable.
 *
 * @param {string} source
 * @param {string} variableName
 * @returns {string | undefined}
 */
export function extractAssignedJsonObject(source, variableName) {
  let assignmentStart = source.indexOf(variableName)
  let objectStart = -1

  while (assignmentStart !== -1) {
    let cursor = assignmentStart + variableName.length
    while (/\s/.test(source[cursor])) cursor++

    if (source[cursor] === '=') {
      cursor++
      while (/\s/.test(source[cursor])) cursor++

      if (source[cursor] === '{') {
        objectStart = cursor
        break
      }
    }

    assignmentStart = source.indexOf(variableName, assignmentStart + variableName.length)
  }

  if (objectStart === -1) return undefined

  let depth = 0
  let escaped = false
  let inString = false

  for (let index = objectStart; index < source.length; index++) {
    const character = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth++
    } else if (character === '}') {
      depth--
      if (depth === 0) return source.slice(objectStart, index + 1)
    }
  }

  return undefined
}
