import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE_IDENTIFIER = 'OpenTubeX.OpenTubeX'
const MAX_WINGET_TAGS = 16

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

export function cleanReleaseNotes(markdown) {
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
  notes = notes.replaceAll(/^#{1,6}\s+/gm, '')
  notes = notes.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  notes = notes.replaceAll(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  notes = notes.replaceAll(/^\[[^\]]+\]:\s+\S+.*$/gm, '')
  notes = notes.replaceAll(/(\*\*|__)(.*?)\1/g, '$2')
  notes = notes.replaceAll(/`([^`]+)`/g, '$1')
  notes = notes.replaceAll(/^\s*```.*$/gm, '')

  lines = notes
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*(?:image|badge)\s*$/i.test(line))
    .filter((line) => !/product\s*hunt/i.test(line))
    .filter((line) => !/^\s*https?:\/\/\S+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?\S*)?\s*$/i.test(line))

  return lines
    .join('\n')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/(^\s*-\s.*)\n\n(?=\s*-\s)/gm, '$1\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

function replaceScalar(manifest, key, value, { all = false } = {}) {
  const expression = new RegExp(`^(\\s*(?:-\\s*)?)${key}:.*$`, all ? 'gm' : 'm')
  const matches = manifest.match(expression) ?? []

  assert(matches.length > 0, `Missing ${key} in manifest`)

  return manifest.replace(expression, `$1${key}: ${value}`)
}

function replaceTags(manifest, tags) {
  const start = manifest.indexOf('\nTags:\n')
  const end = manifest.indexOf('\nReleaseNotes:', start)

  assert(start !== -1 && end !== -1, 'Could not find the Tags block')

  const replacement = `\nTags:\n${tags.map((tag) => `- ${tag}`).join('\n')}`
  return `${manifest.slice(0, start)}${replacement}${manifest.slice(end)}`
}

function replaceReleaseNotes(manifest, releaseNotes) {
  const start = manifest.indexOf('\nReleaseNotes: |-\n')
  const end = manifest.indexOf('\nReleaseNotesUrl:', start)

  assert(start !== -1 && end !== -1, 'Could not find the ReleaseNotes block')

  const indentedNotes = releaseNotes
    .split('\n')
    .map((line) => line ? `  ${line}` : '')
    .join('\n')
  const replacement = `\nReleaseNotes: |-\n${indentedNotes}`

  return `${manifest.slice(0, start)}${replacement}${manifest.slice(end)}`
}

function scalar(block, key) {
  return block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))?.[1].trim()
}

function validateInstallerManifest(manifest, { release, version }) {
  const expectedAssets = new Map([
    ['arm64', `opentubex-${version}-beta-setup-arm64.exe`],
    ['x64', `opentubex-${version}-beta-setup-x64.exe`],
  ])
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]))
  const installerBlocks = manifest
    .split('\n- Architecture: ')
    .slice(1)
    .map((block) => `Architecture: ${block}`)
  const productCodes = [...manifest.matchAll(/^\s*ProductCode:\s*(\S+)$/gm)]
    .map((match) => match[1])

  assert.equal(scalar(manifest, 'PackageIdentifier'), PACKAGE_IDENTIFIER)
  assert.equal(scalar(manifest, 'PackageVersion'), version)
  assert.equal(scalar(manifest, 'InstallerType'), 'nullsoft')
  assert.equal(scalar(manifest, 'ReleaseDate'), release.published_at.slice(0, 10))
  assert.match(manifest, /^Protocols:\n- opentubex$/m)
  assert(productCodes.length >= 2, 'Expected the package ProductCode in installer metadata')
  assert(productCodes.every((productCode) => productCode === productCodes[0]), 'ProductCode values do not match')
  assert.equal(manifest.match(/^\s*- DisplayName:\s*(.+)$/m)?.[1], `OpenTubeX ${version}`)
  assert.equal(installerBlocks.length, 4, 'Expected four installer entries')

  for (const architecture of ['x64', 'arm64']) {
    const assetName = expectedAssets.get(architecture)
    const asset = assets.get(assetName)

    assert(asset, `Missing release asset ${assetName}`)
    assert.match(asset.digest ?? '', /^sha256:[\da-f]{64}$/i, `Missing SHA-256 digest for ${assetName}`)

    for (const scope of ['user', 'machine']) {
      const block = installerBlocks.find((entry) =>
        scalar(entry, 'Architecture') === architecture && scalar(entry, 'Scope') === scope)

      assert(block, `Missing ${architecture} ${scope} installer`)
      assert.equal(scalar(block, 'InstallerUrl'), asset.browser_download_url)
      assert.equal(scalar(block, 'InstallerSha256').toLowerCase(), asset.digest.slice('sha256:'.length).toLowerCase())
      assert.equal(scalar(block, 'Custom'), scope === 'user' ? '/CURRENTUSER' : '/ALLUSERS')
    }
  }
}

function validateLocaleManifest(manifest, { releaseNotes, releaseUrl, tags, version }) {
  assert.equal(scalar(manifest, 'PackageIdentifier'), PACKAGE_IDENTIFIER)
  assert.equal(scalar(manifest, 'PackageVersion'), version)
  assert.equal(scalar(manifest, 'PackageName'), 'OpenTubeX')
  assert.equal(scalar(manifest, 'ReleaseNotesUrl'), releaseUrl)
  assert(!/<[^>]+>/.test(releaseNotes), 'Release notes still contain HTML')
  assert(!/!\[[^\]]*\]/.test(releaseNotes), 'Release notes still contain a Markdown image')
  assert(!/^\s*image\s*$/im.test(releaseNotes), 'Release notes still contain a stray image label')
  assert(!/product\s*hunt/i.test(releaseNotes), 'Release notes still contain a promotional block')

  for (const tag of tags) {
    assert.match(manifest, new RegExp(`^- ${tag}$`, 'm'))
  }
}

function parseArguments(args) {
  const values = {}

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]

    assert(key?.startsWith('--') && value, `Invalid argument ${key ?? ''}`)
    values[key.slice(2)] = value
  }

  for (const required of ['manifest-dir', 'release-json', 'topics-json']) {
    assert(values[required], `Missing --${required}`)
  }

  return values
}

export function prepareManifest({ manifestDirectory, release, topics }) {
  assert.match(release.tag_name, /^v\d+\.\d+\.\d+-beta$/)

  const version = release.tag_name.slice(1, -'-beta'.length)
  const releaseDate = release.published_at?.slice(0, 10)
  const releaseUrl = release.html_url
  const releaseNotes = cleanReleaseNotes(release.body ?? '')
  const tags = [...new Set(topics.names)].sort()

  assert.match(releaseDate ?? '', /^\d{4}-\d{2}-\d{2}$/)
  assert.match(releaseUrl ?? '', /^https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/releases\/tag\//)
  assert(releaseNotes, 'Release notes are empty after cleaning')
  assert(tags.length > 0, 'The repository has no GitHub topics')
  assert(tags.length <= MAX_WINGET_TAGS, `winget accepts at most ${MAX_WINGET_TAGS} tags`)

  for (const tag of tags) {
    assert.match(tag, /^[a-z0-9][a-z0-9-]{0,39}$/, `Invalid winget tag: ${tag}`)
  }

  const files = {
    installer: path.join(manifestDirectory, `${PACKAGE_IDENTIFIER}.installer.yaml`),
    locale: path.join(manifestDirectory, `${PACKAGE_IDENTIFIER}.locale.en-US.yaml`),
    version: path.join(manifestDirectory, `${PACKAGE_IDENTIFIER}.yaml`),
  }

  for (const file of Object.values(files)) {
    assert(fs.existsSync(file), `Missing generated manifest ${file}`)
  }

  let installerManifest = fs.readFileSync(files.installer, 'utf8').replaceAll('\r\n', '\n')
  let localeManifest = fs.readFileSync(files.locale, 'utf8').replaceAll('\r\n', '\n')
  const versionManifest = fs.readFileSync(files.version, 'utf8').replaceAll('\r\n', '\n')

  installerManifest = replaceScalar(installerManifest, 'ReleaseDate', releaseDate)
  installerManifest = replaceScalar(installerManifest, 'DisplayName', `OpenTubeX ${version}`, { all: true })
  localeManifest = replaceTags(localeManifest, tags)
  localeManifest = replaceReleaseNotes(localeManifest, releaseNotes)
  localeManifest = replaceScalar(localeManifest, 'ReleaseNotesUrl', releaseUrl)

  validateInstallerManifest(installerManifest, { release, version })
  validateLocaleManifest(localeManifest, { releaseNotes, releaseUrl, tags, version })
  assert.equal(scalar(versionManifest, 'PackageIdentifier'), PACKAGE_IDENTIFIER)
  assert.equal(scalar(versionManifest, 'PackageVersion'), version)

  fs.writeFileSync(files.installer, installerManifest)
  fs.writeFileSync(files.locale, localeManifest)

  return { releaseNotes, tags, version }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const release = JSON.parse(fs.readFileSync(args['release-json'], 'utf8'))
  const topics = JSON.parse(fs.readFileSync(args['topics-json'], 'utf8'))
  const result = prepareManifest({
    manifestDirectory: args['manifest-dir'],
    release,
    topics,
  })

  process.stdout.write(`Prepared and validated ${PACKAGE_IDENTIFIER} ${result.version}.\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
