import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const MEDIA_REPOSITORY = 'OpenTubeX/media'
const MEDIA_RELEASE = 'attachments'
const MAX_RELEASE_ASSETS = 1000
const MIME_EXTENSIONS = new Map([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

function usage() {
  return `Usage:
  node _scripts/releaseNoteMedia.mjs FILE [--alt ALT_TEXT]
  node _scripts/releaseNoteMedia.mjs --dark FILE --light FILE --alt ALT_TEXT`
}

function fail(message) {
  throw new Error(`${message}\n\n${usage()}`)
}

function readOptions(args) {
  let parsed

  try {
    parsed = parseArgs({
      allowPositionals: true,
      args,
      options: {
        alt: { type: 'string' },
        dark: { type: 'string' },
        light: { type: 'string' },
      },
      strict: true,
    })
  } catch (error) {
    fail(error.message)
  }

  const { values, positionals } = parsed
  const hasThemeOption = values.dark !== undefined || values.light !== undefined

  if (hasThemeOption) {
    if (!values.dark || !values.light || positionals.length > 0) {
      fail('Themed media requires both --dark and --light and no positional file.')
    }

    return {
      alt: values.alt || path.basename(values.dark, path.extname(values.dark)),
      inputs: [
        { path: values.dark, theme: 'dark' },
        { path: values.light, theme: 'light' },
      ],
    }
  }

  if (positionals.length !== 1) { fail('Provide one media file.') }

  return {
    alt: values.alt || path.basename(positionals[0], path.extname(positionals[0])),
    inputs: [{ path: positionals[0], theme: null }],
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  })

  if (result.error) { throw result.error }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} exited with status ${result.status}.`)
  }

  return result.stdout.trim()
}

function getReleaseAssetCount(releaseTag) {
  let releaseId

  try {
    releaseId = run('gh', [
      'api',
      `repos/${MEDIA_REPOSITORY}/releases/tags/${releaseTag}`,
      '--jq',
      '.id',
    ])
  } catch (error) {
    if (error.message.includes('(HTTP 404)')) { return null }
    throw error
  }

  const pageCounts = run('gh', [
    'api',
    `repos/${MEDIA_REPOSITORY}/releases/${releaseId}/assets?per_page=100`,
    '--paginate',
    '--jq',
    'length',
  ])

  if (!pageCounts) { return 0 }

  return pageCounts.split('\n').reduce((total, value) => {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Could not count assets in release ${releaseTag}.`)
    }

    return total + Number(value)
  }, 0)
}

function createRolloverRelease(releaseTag) {
  run('gh', [
    'release',
    'create',
    releaseTag,
    '--repo',
    MEDIA_REPOSITORY,
    '--title',
    releaseTag,
    '--notes',
    `Continues ${MEDIA_RELEASE} because the earlier releases do not have enough asset slots.`,
    '--latest=false',
  ])
}

export function selectReleaseTag(requiredSlots, {
  countAssets = getReleaseAssetCount,
  createRelease = createRolloverRelease,
  maxReleaseAssets = MAX_RELEASE_ASSETS,
} = {}) {
  let releaseNumber = 1

  while (true) {
    const releaseTag = releaseNumber === 1 ? MEDIA_RELEASE : `${MEDIA_RELEASE}-${releaseNumber}`
    const assetCount = countAssets(releaseTag)

    if (assetCount !== null) {
      if (assetCount + requiredSlots <= maxReleaseAssets) { return releaseTag }
      releaseNumber += 1
      continue
    }

    if (releaseNumber === 1) {
      throw new Error(`Release not found: ${MEDIA_RELEASE}`)
    }

    try {
      createRelease(releaseTag)
    } catch (error) {
      // Another upload may have created the release after our lookup.
      if (countAssets(releaseTag) === null) { throw error }
    }
  }
}

function slugify(value) {
  return value
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'media'
}

function prepareMedia(input, timestamp, tempDirectory) {
  const sourcePath = path.resolve(input.path)

  if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Media file not found: ${sourcePath}`)
  }

  const mimeType = run('file', ['-b', '--mime-type', sourcePath])
  const imageExtension = MIME_EXTENSIONS.get(mimeType)

  if (!imageExtension && !VIDEO_MIME_TYPES.has(mimeType)) {
    throw new Error(`Expected a PNG, JPEG, GIF, WebP, MP4, MOV, or WebM file, got ${mimeType}.`)
  }

  const checksum = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex').slice(0, 10)
  const sourceName = path.basename(sourcePath, path.extname(sourcePath))
  const themeSuffix = input.theme ? `-${input.theme}` : ''
  const extension = imageExtension ?? 'webp'
  const assetName = `${timestamp}-${slugify(sourceName)}${themeSuffix}-${checksum}.${extension}`
  const uploadPath = path.join(tempDirectory, assetName)

  if (imageExtension) {
    fs.copyFileSync(sourcePath, uploadPath)
  } else {
    run('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', sourcePath,
      '-map', '0:v:0',
      '-vf', "fps=10,scale=w='min(800,iw)':h=-2:flags=lanczos",
      '-an',
      '-loop', '0',
      '-c:v', 'libwebp_anim',
      '-quality', '65',
      '-compression_level', '4',
      uploadPath,
    ])
  }

  return {
    assetName,
    theme: input.theme,
    uploadPath,
  }
}

function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function renderMediaMarkup(media, alt) {
  const safeAlt = escapeHtmlAttribute(alt)

  if (media.length === 1) {
    return `<img src="${escapeHtmlAttribute(media[0].url)}" alt="${safeAlt}">`
  }

  const dark = media.find(({ theme }) => theme === 'dark')
  const light = media.find(({ theme }) => theme === 'light')

  if (!dark || !light) { throw new Error('Themed media needs a dark and a light asset.') }

  return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${escapeHtmlAttribute(dark.url)}">
  <source media="(prefers-color-scheme: light)" srcset="${escapeHtmlAttribute(light.url)}">
  <img alt="${safeAlt}" src="${escapeHtmlAttribute(dark.url)}">
</picture>`
}

function upload(media, releaseTag) {
  execFileSync('gh', [
    'release',
    'upload',
    releaseTag,
    ...media.map(({ uploadPath }) => uploadPath),
    '--repo',
    MEDIA_REPOSITORY,
  ], {
    stdio: 'inherit',
  })
}

function main() {
  const options = readOptions(process.argv.slice(2))
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'opentubex-release-media-'))

  try {
    const timestamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const media = options.inputs.map((input) => prepareMedia(input, timestamp, tempDirectory))
    const releaseTag = selectReleaseTag(media.length)

    for (const item of media) {
      item.url = `https://github.com/${MEDIA_REPOSITORY}/releases/download/${releaseTag}/${item.assetName}`
    }

    upload(media, releaseTag)

    console.log('\nPaste this inside the release-note-image markers:\n')
    console.log(renderMediaMarkup(media, options.alt))
    console.log('\nDelete the uploaded assets with:')
    for (const { assetName } of media) {
      console.log(`gh release delete-asset ${releaseTag} ${assetName} --repo ${MEDIA_REPOSITORY} --yes`)
    }
  } finally {
    fs.rmSync(tempDirectory, { force: true, recursive: true })
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
