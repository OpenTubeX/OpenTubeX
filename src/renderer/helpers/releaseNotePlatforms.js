// @ts-check

/** Platforms a release note can be limited to, with the names shown in its label. */
export const RELEASE_NOTE_PLATFORMS = new Map([
  ['android', 'Android'],
  ['ios', 'iOS'],
  ['linux', 'Linux'],
  ['macos', 'macOS'],
  ['windows', 'Windows'],
])

const DESKTOP_PLATFORMS = ['linux', 'macos', 'windows']
const DESKTOP_LABEL = 'Desktop'
const LABEL_NAMES = [...RELEASE_NOTE_PLATFORMS.values(), DESKTOP_LABEL].join('|')
// Release notes render the label in bold, and plain-text store notes keep it without.
const LABEL_PATTERN = new RegExp(`^(\\*\\*)?((?:${LABEL_NAMES})(?:, (?:${LABEL_NAMES}))*):\\1 `)

/**
 * Formats the label that marks a release note as limited to some platforms.
 * All three desktop platforms share one "Desktop" label.
 *
 * @param {string[]} platforms
 * @returns {string}
 */
export function formatPlatformLabel(platforms) {
  const names = []
  const isDesktop = DESKTOP_PLATFORMS.every((platform) => platforms.includes(platform))

  for (const [platform, name] of RELEASE_NOTE_PLATFORMS) {
    if (!platforms.includes(platform)) { continue }

    if (!isDesktop || !DESKTOP_PLATFORMS.includes(platform)) {
      names.push(name)
    } else if (!names.includes(DESKTOP_LABEL)) {
      names.push(DESKTOP_LABEL)
    }
  }

  return names.join(', ')
}

/**
 * Splits a release note item into its platforms and text. Items without a
 * label apply to every platform and return `null` platforms.
 *
 * @param {string} item
 * @returns {{ platforms: string[] | null, text: string }}
 */
export function parsePlatformLabel(item) {
  const match = LABEL_PATTERN.exec(item)

  if (match === null) {
    return { platforms: null, text: item }
  }

  const platforms = match[2].split(', ').flatMap((name) => {
    if (name === DESKTOP_LABEL) {
      return DESKTOP_PLATFORMS
    }

    return [...RELEASE_NOTE_PLATFORMS].filter(([, platformName]) => platformName === name).map(([platform]) => platform)
  })

  return { platforms, text: item.slice(match[0].length) }
}

/**
 * Whether a release note item applies to any of the given platforms.
 *
 * @param {string} item
 * @param {string[]} platforms
 * @returns {boolean}
 */
export function releaseNoteAppliesTo(item, platforms) {
  const labeled = parsePlatformLabel(item).platforms

  return labeled === null || labeled.some((platform) => platforms.includes(platform))
}

/**
 * Removes release note items that are labeled only for other platforms, along
 * with their indented images and any headings left without content.
 *
 * @param {string} markdown
 * @param {string[] | null} platforms `null` keeps every item.
 * @returns {string}
 */
export function filterReleaseNotesForPlatforms(markdown, platforms) {
  if (platforms === null) {
    return markdown
  }

  const lines = []
  let skippingItem = false

  for (const line of markdown.split('\n')) {
    const item = /^(?:[-*+]|\d+[.)]) (.*)$/.exec(line)

    if (item !== null) {
      skippingItem = !releaseNoteAppliesTo(item[1], platforms)
    } else if (/^\S/.test(line)) {
      skippingItem = false
    }

    // Blank lines can separate an item from its indented images, so they do not end it.
    if (!skippingItem || line.trim() === '') {
      lines.push(line)
    }
  }

  const headingLevel = (/** @type {string | undefined} */ line) => /^(#{1,6})\s/.exec(line ?? '')?.[1].length

  return lines
    .filter((line, index) => {
      const level = headingLevel(line)

      if (level === undefined) {
        return true
      }

      const next = lines.slice(index + 1).find((nextLine) => nextLine.trim() !== '')
      const nextLevel = headingLevel(next)

      // A closing tag such as </details> ends the section like the end of the notes does.
      return next !== undefined && !next.startsWith('</') && (nextLevel === undefined || nextLevel > level)
    })
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
}
