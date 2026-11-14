/**
 * The Obsidian URI that appends text to a note in the vault's default folder
 * for new notes, creating the note when it is missing. Only this action is
 * built here, so the renderer cannot open other Obsidian URIs, such as ones
 * that overwrite notes.
 * See https://obsidian.md/help/Extending+Obsidian/Obsidian+URI
 * @param {unknown} note `{ vault, name, content }`
 * @returns {string | null} `null` for malformed input
 */
export function getObsidianAppendUri(note) {
  if (note === null || typeof note !== 'object') return null
  const { vault, name, content } = /** @type {Record<string, unknown>} */ (note)
  // encodeURIComponent throws for lone surrogates
  if (![vault, name, content].every(value => typeof value === 'string' && value.trim() !== '' && value.isWellFormed())) return null
  // A name is not a path into other folders
  if (/[/\\]/.test(/** @type {string} */ (name))) return null

  const params = { vault, name, content, append: 'true', silent: 'true' }
  // Obsidian needs spaces as %20, which URLSearchParams writes as +
  return 'obsidian://new?' + Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(/** @type {string} */ (value))}`)
    .join('&')
}
