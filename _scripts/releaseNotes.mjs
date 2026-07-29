import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const NOT_NOTEWORTHY_CATEGORY = 'Not noteworthy'
const RELEASE_NOTE_CATEGORIES = new Map([
  ['Highlights', '# Highlights'],
  ['More improvements', '## More improvements'],
  ['Fixed bugs', '## Fixed bugs'],
])
const RELEASE_NOTE_CATEGORY_MARKER = 'release-note-category'
const RELEASE_NOTE_MARKER = 'release-note'
const RELEASE_IMAGE_MARKER = 'release-note-image'
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
])
const MERGED_PULL_REQUESTS_QUERY = `
query($owner: String!, $repo: String!, $base: String!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      first: 100
      after: $endCursor
      states: MERGED
      baseRefName: $base
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        body
        mergeCommit { oid }
        mergedAt
        number
        title
        url
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`

function extractMarkedSection(body, marker) {
  const startMarker = `<!-- ${marker}:start -->`
  const endMarker = `<!-- ${marker}:end -->`
  const start = body.indexOf(startMarker)
  const end = body.indexOf(endMarker)

  if (start === -1 || end === -1 || end < start) { return null }

  return body.slice(start + startMarker.length, end).trim()
}

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

export function parseReleaseImages(section) {
  if (!section) { return [] }

  const images = [...section.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)|<img\b[^>]*>/gi)]
    .map((match) => {
      if (match[1] !== undefined) {
        return {
          alt: match[1].trim(),
          url: match[2],
        }
      }

      const url = extractHtmlAttribute(match[0], 'src')

      if (!url) { throw new Error('A release note image is missing its src attribute.') }

      return {
        alt: decodeHtml(extractHtmlAttribute(match[0], 'alt') ?? ''),
        url: decodeHtml(url),
      }
    })

  if (images.length === 0) {
    throw new Error('Release note images must be Markdown images or <img> tags.')
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

export function parseReleaseNote(body) {
  const note = extractMarkedSection(body, RELEASE_NOTE_MARKER)

  if (!note) { throw new Error('Fill in the release note section before merging this noteworthy PR.') }

  const imageSection = extractMarkedSection(body, RELEASE_IMAGE_MARKER)
  const images = parseReleaseImages(imageSection)

  for (const image of images) { validateImageUrl(image.url) }

  return { images, note }
}

export function parseReleaseNoteCategory(body) {
  const section = extractMarkedSection(body, RELEASE_NOTE_CATEGORY_MARKER)

  if (!section) { throw new Error('Select one release note category.') }

  const selected = [...section.matchAll(/^\s*-\s*\[[xX]\]\s+(.+?)\s*$/gm)]
    .map((match) => match[1])

  if (selected.length !== 1) { throw new Error('Select exactly one release note category.') }

  const category = selected[0]

  if (category !== NOT_NOTEWORTHY_CATEGORY && !RELEASE_NOTE_CATEGORIES.has(category)) {
    throw new Error(`Unknown release note category: ${category}.`)
  }

  return category
}

function parsePullRequestReleaseNote(body) {
  const category = parseReleaseNoteCategory(body)

  if (category === NOT_NOTEWORTHY_CATEGORY) { return { category } }

  return {
    category,
    ...parseReleaseNote(body),
  }
}

export function validatePullRequestEvent(event) {
  const pullRequest = event.pull_request

  if (!pullRequest) { throw new Error('The event does not contain a pull request.') }

  return parsePullRequestReleaseNote(pullRequest.body ?? '')
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
  const url = validateImageUrl(image.url)
  const buffer = await loadImage(url)
  const size = probeImageSize(buffer)

  if (!size) { throw new Error(`Could not determine the dimensions of ${url}.`) }

  const alt = image.alt || fallbackAlt
  const height = size.height > MAX_IMAGE_HEIGHT ? ` height="${MAX_IMAGE_HEIGHT}"` : ''

  return `<img src="${escapeHtmlAttribute(url.href)}" alt="${escapeHtmlAttribute(alt)}"${height}>`
}

function gitIsAncestor(ancestor, descendant) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    stdio: 'ignore',
  })

  if (result.status === 0) { return true }

  if (result.status === 1) { return false }

  throw new Error(`Could not compare Git commits ${ancestor} and ${descendant}.`)
}

export function selectPullRequests(pullRequests, previousTag, target) {
  if (!gitIsAncestor(previousTag, target)) { throw new Error(`${previousTag} is not an ancestor of ${target}.`) }

  return pullRequests
    .filter(({ mergeCommit }) => {
      const commit = mergeCommit?.oid

      return commit &&
        gitIsAncestor(commit, target) &&
        !gitIsAncestor(commit, previousTag)
    })
    .sort((left, right) => left.mergedAt.localeCompare(right.mergedAt))
}

export function normalizePullRequestPages(pages) {
  return pages.flatMap((page) => page.data.repository.pullRequests.nodes)
}

export function listMergedPullRequests(repository, target) {
  const [owner, repo] = repository.split('/')

  if (!owner || !repo) { throw new Error(`Invalid GitHub repository: ${repository}.`) }

  const output = execFileSync('gh', [
    'api',
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `query=${MERGED_PULL_REQUESTS_QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `repo=${repo}`,
    '-F',
    `base=${target}`,
  ], { encoding: 'utf8' })

  return normalizePullRequestPages(JSON.parse(output))
}

function indentContinuationLines(value) {
  return value.split('\n').map((line, index) => index === 0 ? line : `  ${line}`).join('\n')
}

export async function renderReleaseNotes(pullRequests, loadImage = downloadImage) {
  const sections = new Map([...RELEASE_NOTE_CATEGORIES.keys()].map((category) => [category, []]))

  for (const pullRequest of pullRequests) {
    const body = pullRequest.body ?? ''

    // Pull requests merged before categories were introduced have no marker and are not release-note candidates.
    if (extractMarkedSection(body, RELEASE_NOTE_CATEGORY_MARKER) === null) { continue }

    let parsed

    try {
      parsed = parsePullRequestReleaseNote(body)
    } catch (error) {
      throw new Error(`PR #${pullRequest.number}: ${error.message}`, { cause: error })
    }

    if (parsed.category === NOT_NOTEWORTHY_CATEGORY) { continue }

    let releaseNote = `- ${indentContinuationLines(parsed.note)}`

    for (const image of parsed.images) {
      try {
        releaseNote += `\n  ${await normalizeReleaseImage(image, pullRequest.title, loadImage)}`
      } catch (error) {
        throw new Error(`PR #${pullRequest.number}: ${error.message}`, { cause: error })
      }
    }

    sections.get(parsed.category).push(releaseNote)
  }

  const renderedSections = [...RELEASE_NOTE_CATEGORIES]
    .filter(([category]) => sections.get(category).length > 0)
    .map(([category, heading]) => `${heading}\n\n${sections.get(category).join('\n')}`)

  if (renderedSections.length === 0) {
    throw new Error('No noteworthy pull requests were found between the selected refs.')
  }

  return `${renderedSections.join('\n\n')}\n`
}

async function validateEvent(eventPath) {
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  const releaseNote = validatePullRequestEvent(event)

  console.log(`Release note category is valid: ${releaseNote.category}.`)
}

async function generate(outputPath) {
  const repository = process.env.GITHUB_REPOSITORY
  const previousTag = process.env.PREVIOUS_TAG
  const targetBranch = process.env.TARGET_BRANCH
  const targetSha = process.env.TARGET_SHA

  if (!repository || !previousTag || !targetBranch || !targetSha) {
    throw new Error('GITHUB_REPOSITORY, PREVIOUS_TAG, TARGET_BRANCH, and TARGET_SHA are required.')
  }

  const pullRequests = listMergedPullRequests(repository, targetBranch)
  const selectedPullRequests = selectPullRequests(pullRequests, previousTag, targetSha)
  const releaseNotes = await renderReleaseNotes(selectedPullRequests)

  fs.writeFileSync(outputPath, releaseNotes)
  console.log(`Processed ${selectedPullRequests.length} pull requests and wrote ${outputPath}.`)
}

async function main() {
  const [command, argument] = process.argv.slice(2)

  if (command === 'validate-event' && argument) { return validateEvent(argument) }

  if (command === 'generate' && argument) { return generate(argument) }

  throw new Error('Usage: releaseNotes.mjs <validate-event EVENT_PATH | generate OUTPUT_PATH>')
}

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
