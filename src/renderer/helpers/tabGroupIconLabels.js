/**
 * Accessible names of the tab group icons
 * @param {(key: string) => string} t
 * @returns {Record<string, string>}
 */
export function getTabGroupIconLabels(t) {
  return {
    'layer-group': t('Tab Organizer.Title'),
    'folder-open': t('Tab Organizer.Icon Labels.Folder'),
    bookmark: t('Tab Organizer.Icon Labels.Bookmark'),
    heart: t('Tab Organizer.Icon Labels.Favorites'),
    film: t('Tab Organizer.Icon Labels.Videos'),
    gamepad: t('Tab Organizer.Icon Labels.Gaming'),
    flask: t('Tab Organizer.Icon Labels.Research'),
    palette: t('Tab Organizer.Icon Labels.Art'),
    globe: t('Tab Organizer.Icon Labels.Travel'),
    podcast: t('Tab Organizer.Icon Labels.Podcast'),
    clock: t('Tab Organizer.Icon Labels.Clock'),
    'puzzle-piece': t('Tab Organizer.Icon Labels.Puzzle Piece'),
    users: t('Tab Organizer.Icon Labels.People'),
    'chart-line': t('Tab Organizer.Icon Labels.Chart'),
    'calendar-days': t('Tab Organizer.Icon Labels.Calendar'),
    images: t('Tab Organizer.Icon Labels.Images'),
    headphones: t('Tab Organizer.Icon Labels.Music')
  }
}
