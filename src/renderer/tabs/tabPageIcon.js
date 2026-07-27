const PAGE_ICONS = [
  [/^\/$|^\/subscriptions(?:\/|$)/, ['fas', 'rss']],
  [/^\/subscribedchannels(?:\/|$)/, ['fas', 'user-check']],
  [/^\/trending(?:\/|$)/, ['fas', 'fire']],
  [/^\/popular(?:\/|$)/, ['fas', 'users']],
  [/^\/(?:userplaylists|playlist)(?:\/|$)/, ['fas', 'bookmark']],
  [/^\/history(?:\/|$)/, ['fas', 'history']],
  [/^\/stats(?:\/|$)/, ['fas', 'chart-line']],
  [/^\/settings(?:\/|$)/, ['fas', 'sliders-h']],
  [/^\/about(?:\/|$)/, ['fas', 'info-circle']],
  [/^\/search(?:\/|$)/, ['fas', 'search']],
  [/^\/channel(?:\/|$)/, ['fas', 'circle-user']],
  [/^\/hashtag(?:\/|$)/, ['fas', 'hashtag']],
  [/^\/post(?:\/|$)/, ['fas', 'comment']],
  [/^\/watch(?:\/|$)/, ['fas', 'clapperboard']],
]

export function getTabPageIcon(tab) {
  const path = tab?.route?.path ?? ''
  return PAGE_ICONS.find(([pattern]) => pattern.test(path))?.[1] ?? null
}
