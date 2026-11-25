/**
 * Drops separators that would not sit between two items: leading, trailing,
 * and repeated ones.
 * @template {{ type?: string }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function collapseSeparators(rows) {
  return rows.filter((row, index) => row.type !== 'separator' || (
    index > 0 &&
    rows[index - 1].type !== 'separator' &&
    rows.slice(index + 1).some(next => next.type !== 'separator')
  ))
}
