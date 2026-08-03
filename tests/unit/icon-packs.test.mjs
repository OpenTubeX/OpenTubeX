import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  normalizeFaIcon,
  resolveMappedIcon,
} from '../../src/renderer/icons/iconMappingResolver.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const iconRoot = path.join(repoRoot, 'src/renderer/icons')
const packs = ['lucide', 'material', 'phosphor', 'remix', 'tabler']
const aliases = await readJson('faAliasToCanon.json')
const mapping = await readJson('faIconMap.json')

function resolveIconifyId(icon, pack) {
  return resolveMappedIcon(icon, pack, aliases, mapping)
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(iconRoot, file), 'utf8'))
}

test('normalizes supported Font Awesome icon forms', () => {
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
    resolveIconifyId(['fas', 'external-link-alt'], 'lucide'),
    'lucide:square-arrow-out-up-right'
  )
  assert.equal(resolveIconifyId(['fab', 'youtube'], 'tabler'), 'simple-icons:youtube')
  assert.equal(resolveIconifyId(['fas', 'bookmark'], 'phosphor'), 'ph:bookmark-simple-fill')
  assert.equal(resolveIconifyId(['far', 'bookmark'], 'phosphor'), 'ph:bookmark-simple')
  assert.equal(resolveIconifyId(['fac', 'unmapped-custom'], 'material'), 'otx:unmapped-custom')
})

test('every mapped glyph is present in its generated pack bundle', async () => {
  const filledBases = await readJson('lucideFilledBases.json')

  for (const pack of packs) {
    const bundle = await readJson(`iconifyBundles/${pack}.json`)
    for (const [name, entry] of Object.entries(mapping)) {
      const iconifyId = resolveIconifyId(['fas', name], pack)
      const bundledId = pack === 'lucide' && filledBases[iconifyId?.split(':')[1]]
        ? `lucide:${filledBases[iconifyId.split(':')[1]]}`
        : iconifyId
      assert.ok(bundle[bundledId], `${pack} bundle is missing ${bundledId}`)

      if (entry.simple) {
        assert.ok(
          bundle[`simple-icons:${entry.simple}`],
          `${pack} bundle is missing simple-icons:${entry.simple}`
        )
      }
    }
  }
})
