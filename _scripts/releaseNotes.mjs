import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const NOTEWORTHY_LABEL = 'noteworthy-for-release'
const RELEASE_NOTE_MARKER = 'release-note'
const RELEASE_IMAGE_MARKER = 'release-note-image'
const MAX_IMAGE_HEIGHT = 300
const ALLOWED_IMAGE_HOSTS = new Set([
  'github.com',
  'private-user-images.githubusercontent.com',
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
])

function stripComments(value) {
  return value.replaceAll(/<!--[\s\S]*?-->/g, '').trim()
}

function extractMarkedSection(body, marker) {
  const startMarker = `<!-- ${marker}:start -->`
  const endMarker = `<!-- ${marker}:end -->`
  const start = body.indexOf(startMarker)
  const end = body.indexOf(endMarker)

  if (start === -1 || end === -1 || end < start) { return null }

  return stripComments(body.slice(start + startMarker.length, end))
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function extractHtmlAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2] ?? null
}

export function parseReleaseImage(section) {
  if (!section) { return null }

  const markdownImage = section.match(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/)

  if (markdownImage) {
    return {
      alt: markdownImage[1].trim(),
      url: markdownImage[2],
    }
  }

  const htmlImage = section.match(/<img\b[^>]*>/i)

  if (!htmlImage) { throw new Error('The release note image must be a Markdown image or an <img> tag.') }

  const url = extractHtmlAttribute(htmlImage[0], 'src')

  if (!url) { throw new Error('The release note image is missing its src attribute.') }

  return {
    alt: decodeHtml(extractHtmlAttribute(htmlImage[0], 'alt') ?? ''),
    url: decodeHtml(url),
  }
}

function validateImageUrl(value) {
  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error('The release note image has an invalid URL.')
  }

  if (url.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) { throw new Error('Release note images must be hosted by GitHub.') }

  return url
}

export function parseReleaseNote(body) {
  const note = extractMarkedSection(body, RELEASE_NOTE_MARKER)

  if (!note) { throw new Error('Fill in the release note section before merging this noteworthy PR.') }

  const imageSection = extractMarkedSection(body, RELEASE_IMAGE_MARKER)
  const image = parseReleaseImage(imageSection)

  if (image) { validateImageUrl(image.url) }

  return { image, note }
}

export function validatePullRequestEvent(event) {
  const pullRequest = event.pull_request

  if (!pullRequest) { throw new Error('The event does not contain a pull request.') }

  const isNoteworthy = pullRequest.labels.some(({ name }) => name === NOTEWORTHY_LABEL)

  if (!isNoteworthy) { return null }

  return parseReleaseNote(pullRequest.body ?? '')
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
  })

  if (!response.ok) { throw new Error(`Could not download release note image (${response.status}).`) }

  const finalUrl = validateImageUrl(response.url)

  if (!ALLOWED_IMAGE_HOSTS.has(finalUrl.hostname)) { throw new Error('The release note image redirected outside GitHub.') }

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

function listNoteworthyPullRequests(repository, target) {
  const output = execFileSync('gh', [
    'pr',
    'list',
    '--repo',
    repository,
    '--state',
    'merged',
    '--base',
    target,
    '--label',
    NOTEWORTHY_LABEL,
    '--limit',
    '1000',
    '--json',
    'body,mergeCommit,mergedAt,number,title,url',
  ], { encoding: 'utf8' })

  return JSON.parse(output)
}

function indentContinuationLines(value) {
  return value.split('\n').map((line, index) => index === 0 ? line : `  ${line}`).join('\n')
}

export async function renderReleaseNotes(pullRequests, loadImage = downloadImage) {
  if (pullRequests.length === 0) { throw new Error('No noteworthy pull requests were found between the selected refs.') }

  const highlights = []

  for (const pullRequest of pullRequests) {
    let parsed

    try {
      parsed = parseReleaseNote(pullRequest.body ?? '')
    } catch (error) {
      throw new Error(`PR #${pullRequest.number}: ${error.message}`, { cause: error })
    }

    let highlight = `- ${indentContinuationLines(parsed.note)}`

    if (parsed.image) {
      try {
        highlight += `\n  ${await normalizeReleaseImage(parsed.image, pullRequest.title, loadImage)}`
      } catch (error) {
        throw new Error(`PR #${pullRequest.number}: ${error.message}`, { cause: error })
      }
    }

    highlights.push(highlight)
  }

  return `# Highlights\n\n${highlights.join('\n\n')}\n`
}

async function validateEvent(eventPath) {
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  const releaseNote = validatePullRequestEvent(event)

  if (releaseNote) { console.log('Release note is valid.') } else { console.log(`PR does not have the ${NOTEWORTHY_LABEL} label.`) }
}

async function generate(outputPath) {
  const repository = process.env.GITHUB_REPOSITORY
  const previousTag = process.env.PREVIOUS_TAG
  const target = process.env.TARGET

  if (!repository || !previousTag || !target) { throw new Error('GITHUB_REPOSITORY, PREVIOUS_TAG, and TARGET are required.') }

  const pullRequests = listNoteworthyPullRequests(repository, target)
  const selectedPullRequests = selectPullRequests(pullRequests, previousTag, target)
  const releaseNotes = await renderReleaseNotes(selectedPullRequests)

  fs.writeFileSync(outputPath, releaseNotes)
  console.log(`Wrote ${selectedPullRequests.length} highlights to ${outputPath}.`)
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
