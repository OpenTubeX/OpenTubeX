// @ts-check

/**
 * @typedef {'chapters' | 'comments' | 'liveChat' | 'metadata' | 'transcript' | 'sponsorBlock' | 'queue' | 'recommendations' | 'playlist'} DockedPanel
 * Panels that the player docks beside the video in fullscreen and full-window
 * mode. The player reports changes with `dock-panel-change` events and accepts
 * the panels to reopen in `startWithDockedPanels`.
 */

/**
 * The order in which panels reopen when the player enters fullscreen or
 * full-window mode. Chapters only reopen after a video change.
 * @type {DockedPanel[]}
 */
export const DOCKED_PANEL_RESTORE_ORDER = ['chapters', 'comments', 'liveChat', 'metadata', 'transcript', 'sponsorBlock', 'queue', 'recommendations', 'playlist']

/**
 * The order in which panels close when fullscreen and full-window mode end.
 * @type {Exclude<DockedPanel, 'chapters'>[]}
 */
export const DOCKED_PANEL_CLOSE_ORDER = ['metadata', 'transcript', 'sponsorBlock', 'liveChat', 'comments', 'playlist', 'queue', 'recommendations']

/**
 * Remembers which docked panels to reopen the next time the player enters
 * fullscreen or full-window mode.
 * @param {Iterable<DockedPanel>} initial panels that the previous video's player had open
 */
export function createDockedPanelMemory(initial) {
  const pending = new Set(initial)
  return {
    /**
     * @param {DockedPanel} panel
     * @param {boolean} reopen
     */
    set(panel, reopen) {
      if (reopen) pending.add(panel)
      else pending.delete(panel)
    },
    /**
     * Whether to reopen the panel. It is forgotten either way.
     * @param {DockedPanel} panel
     */
    take(panel) {
      return pending.delete(panel)
    },
  }
}
