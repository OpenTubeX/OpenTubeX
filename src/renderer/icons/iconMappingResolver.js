/**
 * Normalize an icon prop to [prefix, name]. A plain name uses the `fas` prefix.
 *
 * The prefixes keep the names of the Font Awesome styles the app used before
 * the icon packs: `fas` for solid icons, `far` for the outlined variant some
 * icons have, `fab` for brand logos, and `fac` for the app's own glyphs.
 * @param {string | [string, string] | null | undefined} icon
 * @returns {[string, string] | null}
 */
export function normalizeIcon(icon) {
  if (typeof icon === 'string' && icon !== '') return ['fas', icon]
  if (Array.isArray(icon) && icon.length === 2) return [icon[0], icon[1]]
  return null
}

const PACK_PREFIX = {
  remix: 'ri',
  material: 'material-symbols'
}

const PACK_FIELD = {
  remix: 'ri',
  material: 'material'
}

/**
 * Resolve an Iconify id from the icon map.
 * @param {string | [string, string]} icon
 * @param {import('./iconPackState').IconPackId} pack
 * @param {Record<string, Record<string, string>>} mappings
 * @returns {string | null}
 */
export function resolveMappedIcon(icon, pack, mappings) {
  const normalized = normalizeIcon(icon)
  if (!normalized) return null

  const [prefix, name] = normalized
  const mapping = mappings[name]
  if (!mapping) {
    if (prefix === 'fac') return `otx:${name}`
    console.error(`[icon-pack] no mapping for ${prefix}:${name}`)
    return null
  }

  if (prefix === 'fab' && mapping.simple) {
    return `simple-icons:${mapping.simple}`
  }

  if (name === 'bookmark' && prefix === 'fas') {
    const filledBookmarks = {
      material: 'material-symbols:bookmark',
      remix: 'ri:bookmark-fill'
    }
    return filledBookmarks[pack]
  }

  const mappedName = mapping[PACK_FIELD[pack]]
  return mappedName ? `${PACK_PREFIX[pack]}:${mappedName}` : null
}
