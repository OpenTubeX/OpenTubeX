import fs from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import packageDetails from '../package.json' with { type: 'json' }

// F-Droid cuts "What's new" text after this many characters.
export const FDROID_CHANGELOG_LIMIT = 500
const FDROID_MORE = '…and more'
const LINE_WIDTH = 80
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function decodeHtml(value) {
  const namedEntities = {
    amp: '&',
    apos: '\'',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }

  return value.replaceAll(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    }

    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
    }

    return namedEntities[name.toLowerCase()] ?? entity
  })
}

function removePromotionSections(lines) {
  const promotionHeading = /^(#{1,6})\s+(?:donate|promotion|sponsors?|support(?: us| the project)?)\b/i
  let skippedHeadingLevel = null

  return lines.filter((line) => {
    const heading = line.match(/^(#{1,6})\s+/)

    if (skippedHeadingLevel !== null) {
      if (!heading || heading[1].length > skippedHeadingLevel) { return false }
      skippedHeadingLevel = null
    }

    const promotion = line.match(promotionHeading)

    if (promotion) {
      skippedHeadingLevel = promotion[1].length
      return false
    }

    return true
  })
}

function stripHtmlMarkup(value) {
  let plainText = ''

  for (let index = 0; index < value.length;) {
    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + 4)

      index = commentEnd === -1 ? value.length : commentEnd + 3
    } else if (value[index] === '<') {
      const tag = value.slice(index).match(/^<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\s*\/?>/i)

      if (tag) {
        index += tag[0].length
      } else {
        plainText += value[index]
        index += 1
      }
    } else {
      plainText += value[index]
      index += 1
    }
  }

  return plainText
}

// Removes images, HTML, links, and promotions but keeps Markdown headings and bullets.
function cleanMarkdown(markdown) {
  let notes = markdown.replaceAll('\r\n', '\n')

  notes = notes.replaceAll(/<(?:picture|svg|video)\b[^]*?<\/(?:picture|svg|video)>/gi, '')
  notes = notes.replaceAll(/<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>/gi, '')
  notes = notes.replaceAll(/<img\b[^>]*\/?\s*>/gi, '')
  notes = notes.replaceAll(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
  notes = notes.replaceAll(/\[!\[[^\]]*\]\[[^\]]*\]\]\[[^\]]*\]/g, '')
  notes = notes.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '')
  notes = notes.replaceAll(/!\[[^\]]*\]\[[^\]]*\]/g, '')

  const firstReleaseHeading = notes.search(/^##\s+\S/m)

  if (firstReleaseHeading !== -1) {
    notes = notes.slice(firstReleaseHeading)
  }

  let lines = removePromotionSections(notes.split('\n'))
  let inPromotionalQuote = false

  lines = lines.flatMap((line) => {
    if (/^>\s*\[!(?:IMPORTANT|NOTE|TIP)\]/i.test(line)) {
      inPromotionalQuote = true
      return []
    }

    if (inPromotionalQuote) {
      if (/^>/.test(line) || line.trim() === '') { return [] }
      inPromotionalQuote = false
    }

    return [line]
  })

  notes = lines.join('\n')
  notes = notes.replaceAll(/<br\s*\/?>/gi, '\n')
  notes = stripHtmlMarkup(notes)
  notes = decodeHtml(notes)
  notes = stripHtmlMarkup(notes)
  notes = notes.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  notes = notes.replaceAll(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  notes = notes.replaceAll(/^\[[^\]]+\]:\s+\S+.*$/gm, '')
  notes = notes.replaceAll(/(\*\*|__)(.*?)\1/g, '$2')
  notes = notes.replaceAll(/`([^`]+)`/g, '$1')
  notes = notes.replaceAll(/^\s*```.*$/gm, '')

  lines = notes
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*(?:#{1,6}\s+)?(?:image|badge)\s*$/i.test(line))
    .filter((line) => !/product\s*hunt/i.test(line))
    .filter((line) => !/^\s*https?:\/\/\S+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?\S*)?\s*$/i.test(line))

  return lines
    .join('\n')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/(^\s*-\s.*)\n\n(?=\s*-\s)/gm, '$1\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

/** Converts GitHub release notes to plain text with their headings and bullets. */
export function releaseNotesText(markdown) {
  return cleanMarkdown(markdown).replaceAll(/^#{1,6}\s+/gm, '')
}

/**
 * Splits GitHub release notes into headed sections of single-line items. Stores
 * cannot follow issue links, so trailing references such as (#12, #34) are dropped.
 * @param {string} markdown
 * @returns {{ heading: string | null, items: string[] }[]}
 */
export function releaseNoteSections(markdown) {
  const sections = []
  let item = null

  for (const line of cleanMarkdown(markdown).split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)

    if (heading) {
      sections.push({ heading: heading[1].trim(), items: [] })
      item = null
    } else if (!line.trim()) {
      item = null
    } else if (bullet || item === null) {
      if (sections.length === 0) { sections.push({ heading: null, items: [] }) }

      const { items } = sections.at(-1)

      items.push((bullet?.[1] ?? line).trim())
      item = items.length - 1
    } else {
      const { items } = sections.at(-1)

      items[item] = `${items[item]} ${line.trim()}`
    }
  }

  return sections
    .map(({ heading, items }) => ({
      heading,
      items: items.map((text) => text.replace(/\s*\(#\d+(?:,\s*#\d+)*\)$/, '')).filter(Boolean),
    }))
    .filter(({ items }) => items.length > 0)
}

function renderFdroidChangelog(entries, hasMore) {
  const sections = []

  for (const { heading, item } of entries) {
    if (sections.length === 0 || sections.at(-1).heading !== heading) { sections.push({ heading, items: [] }) }

    sections.at(-1).items.push(`• ${item}`)
  }

  const text = sections.map(({ heading, items }) => [heading, ...items].filter(Boolean).join('\n')).join('\n\n')

  return hasMore ? `${text}\n${FDROID_MORE}` : text
}

/** Picks the items, in order, that fit F-Droid's "What's new" limit. */
export function fdroidChangelog(markdown, limit = FDROID_CHANGELOG_LIMIT) {
  const entries = releaseNoteSections(markdown).flatMap(({ heading, items }) => items.map((item) => ({ heading, item })))
  const complete = renderFdroidChangelog(entries, false)

  if (complete.length <= limit) { return complete }

  const selected = []

  for (const entry of entries) {
    if (renderFdroidChangelog([...selected, entry], true).length <= limit) { selected.push(entry) }
  }

  if (selected.length > 0) { return renderFdroidChangelog(selected, true) }

  return `${renderFdroidChangelog(entries.slice(0, 1), false).slice(0, limit - 1).replace(/\s+\S*$/, '')}…`
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** Converts release notes to an AppStream release description body. */
export function appStreamDescription(markdown) {
  return releaseNoteSections(markdown).flatMap(({ heading, items }) => [
    ...(heading ? [`<p>${escapeXml(heading)}</p>`] : []),
    '<ul>',
    ...items.map((item) => `  <li>${escapeXml(item)}</li>`),
    '</ul>',
  ]).join('\n')
}

function wrap(text, firstPrefix, nextPrefix) {
  const lines = []
  let line = ''

  for (const word of text.split(/\s+/)) {
    const prefix = lines.length === 0 ? firstPrefix : nextPrefix

    if (line && prefix.length + line.length + 1 + word.length > LINE_WIDTH) {
      lines.push(`${prefix}${line}`)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }

  lines.push(`${lines.length === 0 ? firstPrefix : nextPrefix}${line}`)
  return lines.join('\n')
}

function maintainer() {
  return `${packageDetails.author.name} <${packageDetails.author.email}>`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Renders a Debian changelog entry for the current package version. */
export function debianChangelog(markdown, date = new Date()) {
  const sections = releaseNoteSections(markdown).map(({ heading, items }) => [
    ...(heading ? [`  [ ${heading} ]`] : []),
    ...items.map((item) => wrap(item, '  * ', '    ')),
  ].join('\n'))
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  const timestamp = `${WEEKDAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${time} +0000`

  return `${packageDetails.name} (${packageDetails.version}) stable; urgency=medium

${sections.join('\n\n')}

 -- ${maintainer()}  ${timestamp}
`
}

/** Renders an RPM %changelog entry for the current package version. */
export function rpmChangelog(markdown, date = new Date()) {
  const items = releaseNoteSections(markdown).flatMap(({ items }) => items)
  const day = `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()}`
  const entry = [
    `* ${day} ${maintainer()} - ${packageDetails.version}`,
    ...items.map((item) => wrap(item, '- ', '  ')),
  ].join('\n')

  // rpmbuild expands macros in %changelog.
  return `${entry.replaceAll('%', '%%')}\n`
}

const FORMATS = {
  appstream: appStreamDescription,
  debian: (markdown) => debianChangelog(markdown, sourceDate()),
  fdroid: fdroidChangelog,
  rpm: (markdown) => rpmChangelog(markdown, sourceDate()),
}

function sourceDate() {
  const epoch = process.env.SOURCE_DATE_EPOCH

  return epoch ? new Date(Number(epoch) * 1000) : new Date()
}

function main() {
  const [format, inputPath] = process.argv.slice(2)

  if (!FORMATS[format] || !inputPath) {
    throw new Error(`Usage: storeReleaseNotes.mjs <${Object.keys(FORMATS).join(' | ')}> RELEASE_NOTES_MARKDOWN`)
  }

  const output = FORMATS[format](fs.readFileSync(inputPath, 'utf8'))

  if (!output.trim()) { throw new Error('The release notes have no items.') }

  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
