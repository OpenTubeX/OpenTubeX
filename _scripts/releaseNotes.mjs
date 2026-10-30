import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { formatPlatformLabel, RELEASE_NOTE_PLATFORMS } from '../src/renderer/helpers/releaseNotePlatforms.js'

export const RELEASE_NOTES_DIRECTORY = 'release-notes'
const RELEASE_NOTE_CATEGORIES = new Map([
  ['highlight', '## Highlights'],
  ['improvement', '## More improvements'],
  ['fix', '## Fixed bugs'],
])
const DESKTOP_PLATFORMS = ['linux', 'macos', 'windows']
const FRONT_MATTER_KEYS = new Set(['category', 'platforms', 'references'])
const MAX_NOTE_LENGTH = 300
const NO_RELEASE_NOTE_PATTERN = /^\s*-\s*\[[xX]\]\s+No release note needed\s*$/m
const MAX_IMAGE_HEIGHT = 300
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000
const ALLOWED_IMAGE_HOSTS = new Set([
  'github.com',
  'private-user-images.githubusercontent.com',
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
])
const ALLOWED_IMAGE_DOWNLOAD_HOSTS = new Set([
  ...ALLOWED_IMAGE_HOSTS,
  'github-production-user-asset-6210df.s3.amazonaws.com',
  'release-assets.githubusercontent.com',
])
// Each alias resolves one commit, so a batch stays well within GitHub's GraphQL node limit.
const COMMIT_BATCH_SIZE = 50
const PULL_REQUEST_FIELDS = `
  baseRefName
  baseRepository { nameWithOwner }
  closingIssuesReferences(first: 100) {
    nodes { number }
  }
  mergedAt
  number
`

function decodeHtml(value) {
  const entities = {
    '#39': '\'',
    amp: '&',
    gt: '>',
    lt: '<',
    quot: '"',
  }

  return value.replaceAll(/&(#39|amp|gt|lt|quot);/g, (entity, name) => entities[name])
}

function extractHtmlAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2] ?? null
}

function parseThemedReleaseImage(picture) {
  const content = picture
    .replace(/^<picture\s*>/i, '')
    .replace(/<\/picture\s*>$/i, '')
  const tags = [...content.matchAll(/<source\b[^>]*>|<img\b[^>]*>/gi)]
  let end = 0

  for (const tag of tags) {
    if (content.slice(end, tag.index).trim()) {
      throw new Error('A themed release note image may contain only two <source> tags and one <img> tag.')
    }

    end = tag.index + tag[0].length
  }

  if (content.slice(end).trim()) {
    throw new Error('A themed release note image may contain only two <source> tags and one <img> tag.')
  }

  const sources = new Map()
  let fallback = null

  for (const tag of tags) {
    if (/^<img\b/i.test(tag[0])) {
      if (fallback) { throw new Error('A themed release note image must contain exactly one <img> tag.') }

      const url = extractHtmlAttribute(tag[0], 'src')

      if (!url) { throw new Error('A themed release note image is missing its fallback src attribute.') }

      fallback = {
        alt: decodeHtml(extractHtmlAttribute(tag[0], 'alt') ?? ''),
        url: decodeHtml(url),
      }
      continue
    }

    const media = extractHtmlAttribute(tag[0], 'media')
    const theme = media?.match(/^\(prefers-color-scheme:\s*(dark|light)\)$/i)?.[1].toLowerCase()
    const url = extractHtmlAttribute(tag[0], 'srcset')

    if (!theme || !url || sources.has(theme)) {
      throw new Error('A themed release note image needs one dark and one light <source> tag.')
    }

    sources.set(theme, decodeHtml(url))
  }

  if (!fallback || sources.size !== 2 || !sources.has('dark') || !sources.has('light')) {
    throw new Error('A themed release note image needs one dark source, one light source, and one fallback image.')
  }

  if (fallback.url !== sources.get('dark')) {
    throw new Error('A themed release note image must use the dark source as its fallback image.')
  }

  return {
    alt: fallback.alt,
    darkUrl: sources.get('dark'),
    lightUrl: sources.get('light'),
    url: fallback.url,
  }
}

export function parseReleaseImages(section) {
  if (!section) { return [] }

  const matches = [...section.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)|<picture\s*>[\s\S]*?<\/picture\s*>|<img\b[^>]*>/gi)]
  let end = 0

  for (const match of matches) {
    if (section.slice(end, match.index).trim()) {
      throw new Error('Release note images must be Markdown images, <img> tags, or themed <picture> elements.')
    }

    end = match.index + match[0].length
  }

  if (section.slice(end).trim()) {
    throw new Error('Release note images must be Markdown images, <img> tags, or themed <picture> elements.')
  }

  const images = matches
    .map((match) => {
      if (match[1] !== undefined) {
        return {
          alt: match[1].trim(),
          url: match[2],
        }
      }

      if (/^<picture\b/i.test(match[0])) { return parseThemedReleaseImage(match[0]) }

      const url = extractHtmlAttribute(match[0], 'src')

      if (!url) { throw new Error('A release note image is missing its src attribute.') }

      return {
        alt: decodeHtml(extractHtmlAttribute(match[0], 'alt') ?? ''),
        url: decodeHtml(url),
      }
    })

  if (images.length === 0) {
    throw new Error('Release note images must be Markdown images, <img> tags, or themed <picture> elements.')
  }

  return images
}

function validateImageUrl(value, allowedHosts = ALLOWED_IMAGE_HOSTS) {
  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error('The release note image has an invalid URL.')
  }

  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) { throw new Error('Release note images must be hosted by GitHub.') }

  return url
}

export function validateDownloadedImageUrl(value) {
  return validateImageUrl(value, ALLOWED_IMAGE_DOWNLOAD_HOSTS)
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function probeJpeg(buffer) {
  let offset = 2

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const isStartOfFrame = [
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ].includes(marker)

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      offset += 2
      continue
    }

    const length = buffer.readUInt16BE(offset + 2)

    if (length < 2) { break }

    offset += length + 2
  }

  return null
}

function probeWebp(buffer) {
  const type = buffer.toString('ascii', 12, 16)

  if (type === 'VP8X' && buffer.length >= 30) {
    return {
      height: readUInt24LE(buffer, 27) + 1,
      width: readUInt24LE(buffer, 24) + 1,
    }
  }

  if (type === 'VP8 ' && buffer.length >= 30) {
    return {
      height: buffer.readUInt16LE(28) & 0x3fff,
      width: buffer.readUInt16LE(26) & 0x3fff,
    }
  }

  if (type === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21)

    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    }
  }

  return null
}

export function probeImageSize(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
    return {
      height: buffer.readUInt32BE(20),
      width: buffer.readUInt32BE(16),
    }
  }

  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return {
      height: buffer.readUInt16LE(8),
      width: buffer.readUInt16LE(6),
    }
  }

  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) { return probeJpeg(buffer) }

  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return probeWebp(buffer)
  }

  return null
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'image/*',
      'User-Agent': 'OpenTubeX-release-notes',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
  })

  if (!response.ok) { throw new Error(`Could not download release note image (${response.status}).`) }

  validateDownloadedImageUrl(response.url)

  return Buffer.from(await response.arrayBuffer())
}

function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export async function normalizeReleaseImage(image, fallbackAlt, loadImage = downloadImage) {
  const variants = [
    { theme: 'dark', url: validateImageUrl(image.url) },
    ...(image.lightUrl ? [{ theme: 'light', url: validateImageUrl(image.lightUrl) }] : []),
  ]
  const normalized = []

  for (const variant of variants) {
    const buffer = await loadImage(variant.url)
    const size = probeImageSize(buffer)

    if (!size) { throw new Error(`Could not determine the dimensions of ${variant.url}.`) }

    normalized.push({ ...variant, size })
  }

  const alt = image.alt || fallbackAlt
  // Limit tall images with a width so browsers derive the height. A fixed height
  // stretches the image when max-width shrinks it in narrow layouts.
  const limitedWidth = Math.min(...normalized.map(({ size }) => (
    Math.floor(size.width * Math.min(1, MAX_IMAGE_HEIGHT / size.height))
  )))
  const width = normalized.some(({ size }) => size.height > MAX_IMAGE_HEIGHT)
    ? ` width="${limitedWidth}"`
    : ''
  const darkUrl = escapeHtmlAttribute(normalized[0].url.href)

  if (normalized.length === 2) {
    const lightUrl = escapeHtmlAttribute(normalized[1].url.href)

    return `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${darkUrl}">\n  <source media="(prefers-color-scheme: light)" srcset="${lightUrl}">\n  <img src="${darkUrl}" alt="${escapeHtmlAttribute(alt)}"${width}>\n</picture>`
  }

  return `<img src="${darkUrl}" alt="${escapeHtmlAttribute(alt)}"${width}>`
}

// Release notes only need the keys below, so a small parser avoids installing
// dependencies in the workflows that read them.
function parseFrontMatter(text) {
  const metadata = {}

  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) { continue }

    const match = line.match(/^([a-z]+):\s*(.*?)\s*$/)

    if (!match) { throw new Error(`Invalid front matter line: ${line.trim()}`) }

    const [, key, value] = match

    if (!FRONT_MATTER_KEYS.has(key)) { throw new Error(`Unknown front matter key: ${key}.`) }

    if (Object.hasOwn(metadata, key)) { throw new Error(`Duplicate front matter key: ${key}.`) }

    const list = value.match(/^\[(.*)\]$/)

    metadata[key] = list ? list[1].split(',').map((item) => item.trim()).filter(Boolean) : value
  }

  return metadata
}

function parsePlatforms(value) {
  if (value === undefined) { return [] }

  if (!Array.isArray(value)) { throw new Error('Write platforms as a list, for example platforms: [android].') }

  const platforms = new Set()

  for (const platform of value) {
    const expanded = platform === 'desktop' ? DESKTOP_PLATFORMS : [platform]

    if (!RELEASE_NOTE_PLATFORMS.has(expanded[0])) {
      throw new Error(`Unknown platform: ${platform}. Use ${[...RELEASE_NOTE_PLATFORMS.keys(), 'desktop'].join(', ')}.`)
    }

    for (const item of expanded) { platforms.add(item) }
  }

  if (platforms.size === RELEASE_NOTE_PLATFORMS.size) { throw new Error('Leave out platforms when the change affects every platform.') }

  return [...RELEASE_NOTE_PLATFORMS.keys()].filter((platform) => platforms.has(platform))
}

function parseReferences(value) {
  if (value === undefined) { return undefined }

  if (!Array.isArray(value) || value.length === 0 || value.some((number) => !/^[1-9]\d*$/.test(number))) {
    throw new Error('Write references as a list of issue and pull request numbers, for example references: [2509].')
  }

  return value.map(Number)
}

export function validateNoteText(note) {
  if (!note) { throw new Error('Write the release note below the front matter.') }

  if (/^(?:[-*+]|#{1,6})\s/.test(note)) { throw new Error('Write the release note as plain text without a leading bullet or heading.') }

  if (/!\[|<(?:img|picture)\b/i.test(note)) { throw new Error('Separate images from the release note text with a blank line.') }

  if (/(?:^|[\s(,])#\d+\b/.test(note)) { throw new Error('Leave out pull request and issue references. They are added automatically.') }

  if (/^(?:on\s+)?(?:android|ios|linux|macos|windows|desktop|mobile)\b[^.,:]{0,20}[,:]/i.test(note)) {
    throw new Error('Set platforms in the front matter instead of naming the platform at the start of the release note.')
  }

  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Shorten the release note to ${MAX_NOTE_LENGTH} characters or less (it has ${note.length}).`)
  }

  if (!/[.!?][)"'*_`]*$/.test(note)) { throw new Error('End the release note with a period.') }
}

export function parseReleaseNoteFile(content) {
  const match = content.replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n?---\n([\s\S]*)$/)

  if (!match) { throw new Error('Start the file with front matter between two --- lines.') }

  const metadata = parseFrontMatter(match[1])

  if (!RELEASE_NOTE_CATEGORIES.has(metadata.category)) {
    throw new Error(`Set category to ${[...RELEASE_NOTE_CATEGORIES.keys()].join(', ')}.`)
  }

  const platforms = parsePlatforms(metadata.platforms)
  const references = parseReferences(metadata.references)
  const [noteBlock = '', ...imageBlocks] = match[2].trim().split(/\n[ \t]*\n/)
  const note = noteBlock.split('\n').map((line) => line.trim()).join(' ')

  validateNoteText(note)

  const images = parseReleaseImages(imageBlocks.join('\n\n').trim())

  for (const image of images) {
    validateImageUrl(image.url)
    if (image.lightUrl) { validateImageUrl(image.lightUrl) }
  }

  return { category: metadata.category, images, note, platforms, ...(references && { references }) }
}

export function isReleaseNoteFile(file) {
  const relative = path.posix.relative(RELEASE_NOTES_DIRECTORY, file.replaceAll(path.sep, '/'))

  return !relative.startsWith('..') && !relative.includes('/') && relative.endsWith('.md') && relative !== 'README.md'
}

export function readReleaseNotes(directory = RELEASE_NOTES_DIRECTORY) {
  const notes = []
  const errors = []

  for (const name of fs.readdirSync(directory).sort()) {
    if (name === 'README.md') { continue }

    const file = path.join(directory, name)

    try {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)) { throw new Error('Name release note files in kebab-case with an .md extension.') }

      notes.push({ file, ...parseReleaseNoteFile(fs.readFileSync(file, 'utf8')) })
    } catch (error) {
      errors.push(`${file}: ${error.message}`)
    }
  }

  if (errors.length > 0) { throw new Error(errors.join('\n')) }

  return notes
}

export function validatePullRequest(body, changedFiles) {
  if (NO_RELEASE_NOTE_PATTERN.test(body) || changedFiles.some(isReleaseNoteFile)) { return }

  throw new Error(`Add or update a release note in ${RELEASE_NOTES_DIRECTORY}/ (see ${RELEASE_NOTES_DIRECTORY}/README.md), or check "No release note needed" in the pull request description.`)
}

/**
 * Lists the commits that touched a release note since it was last added,
 * newest first. A reused file name does not pull in an earlier note's history.
 */
export function listReleaseNoteHistory(file) {
  // Merge commits list no files unless asked, which hides notes added while
  // resolving a merge, such as an upstream sync.
  const output = execFileSync('git', ['log', '--format=commit %H %ct', '--name-status', '--diff-merges=first-parent', 'HEAD', '--', file], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  const commits = []

  for (const line of output.split('\n')) {
    const commit = line.match(/^commit ([0-9a-f]+) (\d+)$/)

    if (commit) {
      commits.push({ oid: commit[1], time: Number(commit[2]) })
    } else if (line.startsWith('A\t')) {
      return { commits: commits.map(({ oid }) => oid), createdAt: commits.at(-1).time }
    }
  }

  // Notes that are not committed yet sort last.
  return { commits: commits.map(({ oid }) => oid), createdAt: Number.MAX_SAFE_INTEGER }
}

export function selectPullRequests(responses, { repository, target }) {
  const pullRequests = new Map()

  for (const response of responses) {
    for (const [alias, commit] of Object.entries(response.data.repository)) {
      for (const pullRequest of commit?.associatedPullRequests.nodes ?? []) {
        // Commits can also belong to open pull requests or to pull requests that
        // merged into another branch, so only keep those merged into the target.
        if (
          pullRequest.mergedAt &&
          pullRequest.baseRefName === target &&
          pullRequest.baseRepository.nameWithOwner.toLowerCase() === repository.toLowerCase()
        ) {
          const commitPullRequests = pullRequests.get(alias) ?? new Map()

          commitPullRequests.set(pullRequest.number, pullRequest)
          pullRequests.set(alias, commitPullRequests)
        }
      }
    }
  }

  return pullRequests
}

/** Looks up the pull requests merged into the target branch that contain each commit. */
export function listPullRequestsByCommit(repository, target, commits) {
  const [owner, repo] = repository.split('/')

  if (!owner || !repo) { throw new Error(`Invalid GitHub repository: ${repository}.`) }

  const byCommit = new Map()

  for (let index = 0; index < commits.length; index += COMMIT_BATCH_SIZE) {
    const batch = commits.slice(index, index + COMMIT_BATCH_SIZE)
    const aliases = batch.map((oid, offset) => `
    commit${offset}: object(oid: "${oid}") {
      ... on Commit {
        associatedPullRequests(first: 10) {
          nodes { ${PULL_REQUEST_FIELDS} }
        }
      }
    }`).join('')
    const response = JSON.parse(execFileSync('gh', [
      'api',
      'graphql',
      '-f',
      `query=query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${aliases} } }`,
      '-F',
      `owner=${owner}`,
      '-F',
      `repo=${repo}`,
    ], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }))

    for (const [alias, pullRequests] of selectPullRequests([response], { repository, target })) {
      byCommit.set(batch[Number(alias.slice('commit'.length))], [...pullRequests.values()])
    }
  }

  return byCommit
}

/** The issues closed by a note's pull requests followed by the pull requests themselves. */
export function formatReferences(pullRequests) {
  const sorted = [...new Map(pullRequests.map((pullRequest) => [pullRequest.number, pullRequest])).values()]
    .sort((left, right) => left.mergedAt.localeCompare(right.mergedAt))
  const issues = sorted.flatMap((pullRequest) => (pullRequest.closingIssuesReferences?.nodes ?? []).map((issue) => issue.number))

  return [...new Set([...issues, ...sorted.map((pullRequest) => pullRequest.number)])]
}

/** Adds each note's issue and pull request references and creation time from Git history. */
export function resolveReleaseNoteHistory(notes, { repository, target }) {
  const histories = notes.map((note) => listReleaseNoteHistory(note.file))
  const commits = [...new Set(histories.flatMap((history) => history.commits))]
  const pullRequests = listPullRequestsByCommit(repository, target, commits)

  return notes.map((note, index) => ({
    ...note,
    createdAt: histories[index].createdAt,
    // Notes added after their change merged list its references themselves.
    references: note.references ?? formatReferences(histories[index].commits.flatMap((commit) => pullRequests.get(commit) ?? [])),
  }))
}

function indentContinuationLines(value) {
  return value.split('\n').map((line, index) => index === 0 ? line : `  ${line}`).join('\n')
}

export async function renderReleaseNotes(notes, {
  emptyMessage = null,
  loadImage = downloadImage,
  onImageError = null,
} = {}) {
  const sections = new Map([...RELEASE_NOTE_CATEGORIES.keys()].map((category) => [category, []]))
  const sortedNotes = [...notes].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))

  for (const note of sortedNotes) {
    const label = note.platforms.length > 0 ? `**${formatPlatformLabel(note.platforms)}:** ` : ''
    const references = (note.references ?? []).map((number) => `#${number}`).join(', ')
    let releaseNote = `- ${label}${note.note}${references ? ` (${references})` : ''}`

    for (const image of note.images) {
      try {
        releaseNote += `\n  ${indentContinuationLines(await normalizeReleaseImage(image, note.note, loadImage))}`
      } catch (error) {
        const imageError = new Error(`${note.file}: ${error.message}`, { cause: error })

        if (onImageError) {
          onImageError(imageError)
          continue
        }

        throw imageError
      }
    }

    sections.get(note.category).push(releaseNote)
  }

  const renderedSections = [...RELEASE_NOTE_CATEGORIES]
    .filter(([category]) => sections.get(category).length > 0)
    .map(([category, heading]) => `${heading}\n\n${sections.get(category).join('\n')}`)

  if (renderedSections.length === 0) {
    if (emptyMessage !== null) { return `${emptyMessage}\n` }

    throw new Error(`No release notes were found in ${RELEASE_NOTES_DIRECTORY}/.`)
  }

  return `${renderedSections.join('\n\n')}\n`
}

function validate() {
  const notes = readReleaseNotes()

  console.log(`${notes.length} release notes are valid.`)
}

function validateEvent(eventPath) {
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  const pullRequest = event.pull_request

  if (!pullRequest) { throw new Error('The event does not contain a pull request.') }

  const changedFiles = execFileSync('gh', [
    'api',
    '--paginate',
    `repos/${event.repository.full_name}/pulls/${pullRequest.number}/files`,
    '--jq',
    '.[].filename',
  ], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }).split('\n').filter(Boolean)

  validatePullRequest(pullRequest.body ?? '', changedFiles)
  console.log('The pull request has a release note or does not need one.')
}

async function generate(outputPath, options) {
  const repository = process.env.GITHUB_REPOSITORY
  const target = process.env.TARGET_BRANCH

  if (!repository || !target) { throw new Error('GITHUB_REPOSITORY and TARGET_BRANCH are required.') }

  const notes = resolveReleaseNoteHistory(readReleaseNotes(), { repository, target })

  fs.writeFileSync(outputPath, await renderReleaseNotes(notes, options))
  console.log(`Rendered ${notes.length} release notes to ${outputPath}.`)
}

async function main() {
  const [command, argument] = process.argv.slice(2)

  if (command === 'validate' && !argument) { return validate() }

  if (command === 'validate-event' && argument) { return validateEvent(argument) }

  if (command === 'generate' && argument) { return generate(argument) }

  if (command === 'generate-nightly' && argument) {
    return generate(argument, {
      emptyMessage: 'No noteworthy changes since the latest release.',
      onImageError: (error) => console.warn(`${error.message} The image will be omitted from this nightly.`),
    })
  }

  throw new Error('Usage: releaseNotes.mjs <validate | validate-event EVENT_PATH | generate OUTPUT_PATH | generate-nightly OUTPUT_PATH>')
}

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
