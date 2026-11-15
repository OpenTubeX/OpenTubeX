/**
 * Normalize a legacy semantic icon prop to [prefix, name].
 * @param {string | [string, string] | { prefix?: string, iconName?: string }} icon
 * @returns {[string, string] | null}
 */
export function normalizeFaIcon(icon) {
  if (!icon) return null
  if (Array.isArray(icon)) {
    if (icon.length >= 2) return [icon[0], icon[1]]
    if (icon.length === 1) return ['fas', icon[0]]
    return null
  }
  if (typeof icon === 'string') {
    if (icon.includes(' ')) {
      const [prefix, name] = icon.split(/\s+/)
      return [prefix, name]
    }
    return ['fas', icon]
  }
  if (typeof icon === 'object' && icon.iconName) {
    return [icon.prefix || 'fas', icon.iconName]
  }
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
 * Resolve an Iconify id using the generated alias and mapping data.
 * @param {string | [string, string]} icon
 * @param {import('./iconPackState').IconPackId} pack
 * @param {Record<string, string>} aliases
 * @param {Record<string, Record<string, string>>} mappings
 * @returns {string | null}
 */
export function resolveMappedIcon(icon, pack, aliases, mappings) {
  const normalized = normalizeFaIcon(icon)
  if (!normalized) return null

  const [prefix, rawName] = normalized
  const name = aliases[rawName] || rawName
  const mapping = mappings[name] ?? mappings[rawName]
  if (!mapping) {
    if (prefix === 'fac') return `otx:${rawName}`
    console.warn(`[icon-pack] no mapping for ${prefix}:${rawName}`)
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
