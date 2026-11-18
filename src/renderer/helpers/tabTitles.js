/**
 * The title of a community post's tab, also used while the tab stays unloaded.
 * @param {string} [author]
 */
export function getPostTabTitle(author) {
  return author ? `Community Post | ${author}` : 'Community Post'
}
