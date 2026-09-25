const PAGE_ICONS = [
  [/^\/home(?:\/|$)/, ['fas', 'house']],
  [/^\/$|^\/subscriptions(?:\/|$)/, ['fas', 'rss']],
  [/^\/subscribedchannels(?:\/|$)/, ['fas', 'user-check']],
  [/^\/trending(?:\/|$)/, ['fas', 'fire']],
  [/^\/popular(?:\/|$)/, ['fas', 'users']],
  [/^\/(?:userplaylists|playlist)(?:\/|$)/, ['fas', 'bookmark']],
  [/^\/history(?:\/|$)/, ['fas', 'history']],
  [/^\/downloads(?:\/|$)/, ['fas', 'download']],
  [/^\/stats(?:\/|$)/, ['fas', 'chart-line']],
  [/^\/settings(?:\/|$)/, ['fas', 'sliders-h']],
  [/^\/about(?:\/|$)/, ['fas', 'info-circle']],
  [/^\/search(?:\/|$)/, ['fas', 'search']],
  [/^\/channel(?:\/|$)/, ['fas', 'circle-user']],
  [/^\/hashtag(?:\/|$)/, ['fas', 'hashtag']],
  [/^\/post(?:\/|$)/, ['fas', 'comment']],
  [/^\/watch(?:\/|$)/, ['fas', 'clapperboard']],
]

const EXTERNAL_MEDIA_PLATFORMS = [
  ['twitch.tv', 'twitch'],
  ['vimeo.com', 'vimeo'],
  ['dailymotion.com', 'dailymotion'],
  ['soundcloud.com', 'soundcloud'],
  ['bandcamp.com', 'bandcamp'],
  ['bilibili.com', 'bilibili'],
  ['odysee.com', 'odysee'],
  ['rumble.com', 'rumble'],
  ['archive.org', 'internetarchive'],
  ['mixcloud.com', 'mixcloud'],
  ['kick.com', 'kick'],
  ['nicovideo.jp', 'niconico'],
  ['nico.ms', 'niconico'],
  ['tiktok.com', 'tiktok'],
  ['instagram.com', 'instagram'],
  ['x.com', 'x'],
  ['twitter.com', 'twitter'],
  ['facebook.com', 'facebook'],
  ['reddit.com', 'reddit'],
  ['crunchyroll.com', 'crunchyroll']
]

export function getExternalMediaUrl(tab) {
  try {
    const fullPath = tab.route?.fullPath ?? tab.url?.split('#')[1]
    const mediaUrl = tab.route?.query?.url ?? new URL(fullPath, 'https://opentubex.invalid').searchParams.get('url')
    const url = new URL(mediaUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

export function getExternalMediaPlatformIcon(tab) {
  const hostname = getExternalMediaUrl(tab)?.hostname.toLowerCase().replace(/\.$/, '')
  const platform = EXTERNAL_MEDIA_PLATFORMS.find(([domain]) => hostname === domain || hostname?.endsWith(`.${domain}`))?.[1]
  return platform ? ['fab', platform] : null
}

export function getTabPageIcon(tab) {
  const path = tab?.route?.path ?? ''
  if (/^\/external-media(?:\/|$)/.test(path)) {
    return getExternalMediaPlatformIcon(tab) ?? ['fas', 'globe']
  }
  return PAGE_ICONS.find(([pattern]) => pattern.test(path))?.[1] ?? null
}
