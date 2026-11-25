/**
 * Regenerates the per-pack bundles from `faIconMap.json`
 * and the installed `@iconify-json/*` packages.
 *
 * Usage: node _scripts/generateIconifyBundle.mjs
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { getIconData } from '@iconify/utils'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const faIconMap = require(join(root, 'src/renderer/icons/faIconMap.json'))
const customPackIcons = require(join(root, 'src/renderer/icons/customPackIcons.json'))

const COLLECTIONS = {
  ri: require('@iconify-json/ri/icons.json'),
  'material-symbols': require('@iconify-json/material-symbols/icons.json'),
  'simple-icons': require('@iconify-json/simple-icons/icons.json')
}

const DEFAULT_SIZE = {
  ri: 24,
  'material-symbols': 24,
  'simple-icons': 24
}

const PACK_PREFIXES = {
  material: 'material-symbols',
  remix: 'ri'
}

const PACK_FIELDS = {
  material: 'material',
  remix: 'ri'
}

/** @type {Record<string, Record<string, object>>} */
const bundles = Object.fromEntries(Object.keys(PACK_PREFIXES).map(pack => [pack, {}]))

/**
 * @param {string} prefix
 * @param {string} name
 * @param {object} collection
 */
function add(out, prefix, name, collection) {
  const id = `${prefix}:${name}`

  if (customPackIcons[id]) {
    const custom = customPackIcons[id]
    out[id] = {
      body: custom.body,
      width: custom.width ?? DEFAULT_SIZE[prefix] ?? 24,
      height: custom.height ?? DEFAULT_SIZE[prefix] ?? 24
    }
    return
  }

  const data = getIconData(collection, name)
  if (!data) {
    throw new Error(`missing ${prefix}:${name}`)
  }
  out[id] = data
}

for (const [pack, prefix] of Object.entries(PACK_PREFIXES)) {
  const out = bundles[pack]
  for (const mapping of Object.values(faIconMap)) {
    const name = mapping[PACK_FIELDS[pack]]
    add(out, prefix, name, COLLECTIONS[prefix])
    if (mapping.simple) {
      add(out, 'simple-icons', mapping.simple, COLLECTIONS['simple-icons'])
    }
  }
}

add(bundles.remix, 'ri', 'bookmark-fill', COLLECTIONS.ri)
add(bundles.material, 'material-symbols', 'bookmark', COLLECTIONS['material-symbols'])

// Ensure every custom pack glyph is present even if not referenced yet.
for (const id of Object.keys(customPackIcons)) {
  const [prefix, name] = id.split(':')
  const pack = Object.entries(PACK_PREFIXES).find(([, packPrefix]) => packPrefix === prefix)?.[0]
  if (!pack) throw new Error(`unknown custom icon prefix: ${prefix}`)
  add(bundles[pack], prefix, name, COLLECTIONS[prefix])
}

const outputDirectory = join(root, 'src/renderer/icons/iconifyBundles')
mkdirSync(outputDirectory, { recursive: true })
rmSync(join(root, 'src/renderer/icons/iconifyBundle.json'), { force: true })

for (const [pack, bundle] of Object.entries(bundles)) {
  const outPath = join(outputDirectory, `${pack}.json`)
  writeFileSync(outPath, `${JSON.stringify(bundle)}\n`)
  console.log(
    `Wrote ${Object.keys(bundle).length} ${pack} icons ` +
    `(${statSync(outPath).size} bytes) → ${outPath}`
  )
}
