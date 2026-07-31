/**
 * Regenerates `src/renderer/icons/iconifyBundle.json` from `faIconMap.json`
 * and the installed `@iconify-json/*` packages.
 *
 * Usage: node _scripts/generateIconifyBundle.mjs
 */
import { writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { getIconData } from '@iconify/utils'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const faIconMap = require(join(root, 'src/renderer/icons/faIconMap.json'))
const lucideFilledBases = require(join(root, 'src/renderer/icons/lucideFilledBases.json'))
const customPackIcons = require(join(root, 'src/renderer/icons/customPackIcons.json'))

const COLLECTIONS = {
  lucide: require('@iconify-json/lucide/icons.json'),
  tabler: require('@iconify-json/tabler/icons.json'),
  ph: require('@iconify-json/ph/icons.json'),
  ri: require('@iconify-json/ri/icons.json'),
  'material-symbols': require('@iconify-json/material-symbols/icons.json'),
  'simple-icons': require('@iconify-json/simple-icons/icons.json')
}

const DEFAULT_SIZE = {
  lucide: 24,
  tabler: 24,
  ph: 256,
  ri: 24,
  'material-symbols': 24,
  'simple-icons': 24
}

/** @type {Record<string, object>} */
const out = {}

/**
 * @param {string} prefix
 * @param {string} name
 * @param {object} collection
 */
function add(prefix, name, collection) {
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

  let iconName = name
  // Lucide filled names are derived at runtime; bundle the stroke base instead.
  if (prefix === 'lucide' && lucideFilledBases[name]) {
    iconName = lucideFilledBases[name]
  }
  const data = getIconData(collection, iconName)
  if (!data) {
    throw new Error(`missing ${prefix}:${iconName}${iconName !== name ? ` (for ${name})` : ''}`)
  }
  out[`${prefix}:${iconName}`] = data
}

for (const mapping of Object.values(faIconMap)) {
  add('lucide', mapping.lucide, COLLECTIONS.lucide)
  add('tabler', mapping.tabler, COLLECTIONS.tabler)
  add('ph', mapping.ph, COLLECTIONS.ph)
  add('ri', mapping.ri, COLLECTIONS.ri)
  add('material-symbols', mapping.material, COLLECTIONS['material-symbols'])
  if (mapping.simple) {
    add('simple-icons', mapping.simple, COLLECTIONS['simple-icons'])
  }
}

add('ph', 'bookmark-simple-fill', COLLECTIONS.ph)
add('tabler', 'bookmark-filled', COLLECTIONS.tabler)
add('ri', 'bookmark-fill', COLLECTIONS.ri)
add('material-symbols', 'bookmark', COLLECTIONS['material-symbols'])
add('lucide', 'bookmark', COLLECTIONS.lucide)

// Ensure every custom pack glyph is present even if not referenced yet.
for (const id of Object.keys(customPackIcons)) {
  const [prefix, name] = id.split(':')
  add(prefix, name, COLLECTIONS[prefix])
}

const outPath = join(root, 'src/renderer/icons/iconifyBundle.json')
writeFileSync(outPath, `${JSON.stringify(out)}\n`)
console.log(`Wrote ${Object.keys(out).length} icons (${statSync(outPath).size} bytes) → ${outPath}`)
