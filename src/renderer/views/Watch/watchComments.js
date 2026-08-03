/**
 * @param {{ isLive: boolean, isPremiere: boolean, hideComments: boolean }} state
 */
export function areCommentsAvailable({ isLive, isPremiere, hideComments }) {
  return (!isLive || isPremiere) && !hideComments
}
