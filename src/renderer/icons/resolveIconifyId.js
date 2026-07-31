import faIconMap from './faIconMap.json'
import { currentIconPack } from './iconPackState'

/** @typedef {import('./iconPackState').IconPackId} IconPackId */

const PACK_PREFIX = {
  lucide: 'lucide',
  tabler: 'tabler',
  phosphor: 'ph',
  remix: 'ri',
  material: 'material-symbols'
}

const PACK_FIELD = {
  lucide: 'lucide',
  tabler: 'tabler',
  phosphor: 'ph',
  remix: 'ri',
  material: 'material'
}

/**
 * Normalize FA icon prop to [prefix, name].
 * @param {string | [string, string] | { prefix?: string, iconName?: string }} icon
 * @returns {[string, string] | null}
 */
export function normalizeFaIcon(icon) {
  if (!icon) {
    return null
  }
  if (Array.isArray(icon)) {
    if (icon.length >= 2) {
      return [icon[0], icon[1]]
    }
    if (icon.length === 1) {
      return ['fas', icon[0]]
    }
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

/**
 * Resolve an Iconify id for the active (or given) pack.
 * @param {string | [string, string]} icon
 * @param {IconPackId} [pack]
 * @returns {string | null}
 */
export function resolveIconifyId(icon, pack = currentIconPack.value) {
  if (pack === 'fontawesome') {
    return null
  }

  const normalized = normalizeFaIcon(icon)
  if (!normalized) {
    return null
  }

  const [prefix, name] = normalized

  const mapping = faIconMap[name]
  if (!mapping) {
    // Fall back to OpenTubeX custom glyphs when a pack has no native match.
    if (prefix === 'fac') {
      return `otx:${name}`
    }
    console.warn(`[icon-pack] no mapping for ${prefix}:${name}`)
    return null
  }

  // Prefer brand glyphs from Simple Icons when available (cleaner logos).
  if (prefix === 'fab' && mapping.simple) {
    return `simple-icons:${mapping.simple}`
  }

  // Solid bookmark → filled when the pack has a fill variant.
  if (name === 'bookmark' && prefix === 'fas') {
    if (pack === 'phosphor') {
      return 'ph:bookmark-simple-fill'
    }
    if (pack === 'tabler') {
      return 'tabler:bookmark-filled'
    }
    if (pack === 'remix') {
      return 'ri:bookmark-fill'
    }
    if (pack === 'material') {
      return 'material-symbols:bookmark'
    }
    if (pack === 'lucide') {
      return 'lucide:bookmark-filled'
    }
  }

  const field = PACK_FIELD[pack]
  const iconPrefix = PACK_PREFIX[pack]
  const mappedName = mapping[field]
  if (!mappedName) {
    return null
  }
  return `${iconPrefix}:${mappedName}`
}

/**
 * Human-readable name for the active pack’s glyph (no FA prefix).
 * @param {string | [string, string]} icon
 * @param {IconPackId} [pack]
 * @returns {string}
 */
export function resolvePackIconLabel(icon, pack = currentIconPack.value) {
  const normalized = normalizeFaIcon(icon)
  if (!normalized) {
    return ''
  }

  const [, name] = normalized

  if (pack === 'fontawesome') {
    return name
  }

  const iconifyId = resolveIconifyId(icon, pack)
  if (!iconifyId) {
    return name
  }

  // "simple-icons:youtube" / "ph:sort-ascending" / "otx:playlist-add"
  const colon = iconifyId.indexOf(':')
  return colon === -1 ? iconifyId : iconifyId.slice(colon + 1)
}
