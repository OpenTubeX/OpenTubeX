/** Inline Cast manifests use percent-encoded UTF-8, as supplied by playback. */
export function getInlineCastManifestType(value) {
  if (typeof value !== 'string') return null
  return /^data:(application\/(?:dash\+xml|x-mpegurl|vnd\.apple\.mpegurl))(?:;charset=UTF-8)?,/i.exec(value)?.[1].toLowerCase() ?? null
}
