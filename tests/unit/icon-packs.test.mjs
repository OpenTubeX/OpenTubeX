import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  normalizeFaIcon,
  resolveMappedIcon,
} from '../../src/renderer/icons/iconMappingResolver.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rendererRoot = path.join(repoRoot, 'src/renderer')
const iconRoot = path.join(rendererRoot, 'icons')
const packs = ['material', 'remix']
const aliases = await readJson('faAliasToCanon.json')
const mapping = await readJson('faIconMap.json')

function resolveIconifyId(icon, pack) {
  return resolveMappedIcon(icon, pack, aliases, mapping)
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(iconRoot, file), 'utf8'))
}

test('normalizes supported semantic icon forms', () => {
  assert.deepEqual(normalizeFaIcon('search'), ['fas', 'search'])
  assert.deepEqual(normalizeFaIcon('far bookmark'), ['far', 'bookmark'])
  assert.deepEqual(normalizeFaIcon(['fab', 'youtube']), ['fab', 'youtube'])
  assert.deepEqual(normalizeFaIcon(['circle']), ['fas', 'circle'])
  assert.deepEqual(
    normalizeFaIcon({ prefix: 'far', iconName: 'bookmark' }),
    ['far', 'bookmark']
  )
  assert.equal(normalizeFaIcon(null), null)
})

test('resolves aliases, brands, filled bookmarks, and custom fallbacks', () => {
  assert.equal(
    resolveIconifyId(['fas', 'external-link-alt'], 'material'),
    'material-symbols:open-in-new-down'
  )
  assert.equal(resolveIconifyId(['fab', 'youtube'], 'remix'), 'simple-icons:youtube')
  assert.equal(resolveIconifyId(['fas', 'house'], 'material'), 'material-symbols:home-outline')
  assert.equal(resolveIconifyId(['fas', 'house'], 'remix'), 'ri:home-5-line')
  assert.equal(resolveIconifyId(['fas', 'bookmark'], 'remix'), 'ri:bookmark-fill')
  assert.equal(resolveIconifyId(['far', 'bookmark'], 'remix'), 'ri:bookmark-line')
  assert.equal(
    resolveIconifyId(['fac', 'back-to-tab'], 'material'),
    'material-symbols:back-to-tab-rounded'
  )
  assert.equal(
    resolveIconifyId(['fac', 'back-to-tab'], 'remix'),
    'ri:arrow-go-back-line'
  )
  assert.equal(resolveIconifyId(['fac', 'unmapped-custom'], 'material'), 'otx:unmapped-custom')
})

test('every mapped glyph is present in its generated pack bundle', async () => {
  for (const pack of packs) {
    const bundle = await readJson(`iconifyBundles/${pack}.json`)
    for (const [name, entry] of Object.entries(mapping)) {
      const iconifyId = resolveIconifyId(['fas', name], pack)
      assert.ok(bundle[iconifyId], `${pack} bundle is missing ${iconifyId}`)

      if (entry.simple) {
        assert.ok(
          bundle[`simple-icons:${entry.simple}`],
          `${pack} bundle is missing simple-icons:${entry.simple}`
        )
      }
    }
  }
})

test('every semantic icon the renderer asks for has a mapping', async () => {
  // `fac` icons are the project's own glyphs and resolve to the otx: collection
  // without a mapping entry, so they are not part of this.
  const iconPattern = /\[\s*['"](fas|far|fab)['"]\s*,\s*['"]([a-z0-9-]+)['"]\s*\]/g
  const unmapped = new Map()

  for (const file of await readRendererSources()) {
    const source = await readFile(file, 'utf8')
    for (const [, prefix, name] of source.matchAll(iconPattern)) {
      if (resolveIconifyId([prefix, name], 'material') == null) {
        unmapped.set(`${prefix}:${name}`, path.relative(repoRoot, file))
      }
    }
  }

  assert.deepEqual(
    Object.fromEntries(unmapped),
    {},
    'these icons are missing from the supported icon packs'
  )
})

test('renderer icons use the icon-pack-aware component', async () => {
  const legacyUsages = []

  for (const file of await readRendererSources()) {
    const source = await readFile(file, 'utf8')
    if (/<(?:font-awesome-icon|FontAwesomeIcon)\b/.test(source)) {
      legacyUsages.push(path.relative(repoRoot, file))
    }
  }

  assert.deepEqual(legacyUsages, [])
})

async function readRendererSources() {
  const files = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      // The icon data itself lists names that are not icon usages
      if (entry.isDirectory() && entryPath !== iconRoot) {
        await walk(entryPath)
      } else if (entry.isFile() && /\.(?:vue|js)$/.test(entry.name)) {
        files.push(entryPath)
      }
    }
  }
  await walk(rendererRoot)
  return files
}
