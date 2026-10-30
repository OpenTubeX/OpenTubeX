/**
 * Twitch names each quality with a VIDEO rendition without a URI, and marks the
 * source quality DEFAULT=NO. Such a rendition is the variant's own video rather
 * than an alternative, but Shaka still leaves the variants of DEFAULT=NO
 * renditions out of automatic and default quality.
 * @param {string} manifest
 * @returns {string}
 */
export function ignoreMuxedHlsVideoDefaults(manifest) {
  return manifest.replaceAll(/^#EXT-X-MEDIA:(?=.*\bTYPE=VIDEO\b)(?!.*\bURI=).*$/gm, line => line.replace('DEFAULT=YES', 'DEFAULT=NO'))
}
