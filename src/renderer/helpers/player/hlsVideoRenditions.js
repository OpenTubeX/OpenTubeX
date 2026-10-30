import { parseHlsMediaAttributes } from './hlsAudioTracks.js'

/**
 * Twitch gives each quality a VIDEO group of its own and marks the source
 * quality's rendition DEFAULT=NO. A rendition alone in its group isn't chosen
 * over anything, but Shaka still leaves the variants of DEFAULT=NO renditions
 * out of automatic and default quality.
 * @param {string} manifest
 * @returns {string}
 */
export function ignoreLoneHlsVideoDefaults(manifest) {
  const lines = manifest.split('\n')
  const videoTags = new Map()
  const groupSizes = new Map()

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue

    const attributes = parseHlsMediaAttributes(line)
    if (attributes.get('TYPE') !== 'VIDEO') continue

    const group = attributes.get('GROUP-ID')
    videoTags.set(index, { attributes, group })
    groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1)
  }

  for (const [index, { attributes, group }] of videoTags) {
    if (groupSizes.get(group) !== 1 || attributes.get('DEFAULT') !== 'YES') continue

    attributes.set('DEFAULT', 'NO')
    lines[index] = '#EXT-X-MEDIA:' + [...attributes].map(([key, value]) => `${key}=${value}`).join(',')
  }

  return lines.join('\n')
}
