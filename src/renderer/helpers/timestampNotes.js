/**
 * A Markdown list item that links to a moment of a video, followed by the
 * note. Lines after the first are indented to stay in the list item.
 * @param {object} options
 * @param {string} options.url the video URL at that moment
 * @param {string} options.timestamp the displayed time, such as `1:02:03`
 * @param {string} options.note
 */
export function formatTimestampNote({ url, timestamp, note }) {
  // Parentheses and spaces would end the link target
  const target = url.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll(' ', '%20')
  const text = note.trim().replaceAll(/\r?\n/g, '\n  ')
  return `- [${timestamp}](${target})${text === '' ? '' : ` ${text}`}`
}

/**
 * The name of the Obsidian note collecting the notes of a video. Obsidian
 * rejects some characters in note names, and names starting with a dot are
 * hidden.
 * @param {string} title
 * @param {string} fallback used when nothing of the title remains
 */
export function getObsidianNoteName(title, fallback) {
  const name = title
    .replaceAll(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 200)
    .trim()
  return name === '' ? fallback : name
}
