/**
 * Marks the window as waiting while a collaborator lookup runs, so the wait
 * cursor can be shown over the whole page (see the unscoped styles in
 * FtListVideo.vue).
 *
 * Expressed as a class on `<body>` rather than a `body:has(...)` rule on the
 * button's disabled state: feed cards mount and unmount constantly while a
 * feed is scrolled, and `:has()` is re-evaluated on every one of those
 * mutations, invalidating the style of the whole page each time. The waiting
 * state is rare and short lived, so a class that only changes when a lookup
 * starts or finishes costs nothing while scrolling.
 *
 * Ref counted, because several cards can be waiting at once.
 */
let loadingCount = 0

/**
 * @param {boolean} loading
 */
export function setCollaboratorsLoading(loading) {
  loadingCount = Math.max(0, loadingCount + (loading ? 1 : -1))
  document.body.classList.toggle('collaboratorsLoading', loadingCount > 0)
}
