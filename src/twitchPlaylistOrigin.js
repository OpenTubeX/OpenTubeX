export function applyTwitchPlaylistOrigin(url, requestHeaders) {
  if (
    (url.hostname === 'playlist.ttvnw.net' || url.hostname.endsWith('.playlist.ttvnw.net')) &&
    url.pathname.startsWith('/v1/playlist/')
  ) {
    requestHeaders.Origin = 'https://www.twitch.tv'
  }
}
