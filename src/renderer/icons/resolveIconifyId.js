import faAliasToCanon from './faAliasToCanon.json'
import faIconMap from './faIconMap.json'
import { currentIconPack } from './iconPackState.js'
import { normalizeFaIcon, resolveMappedIcon } from './iconMappingResolver.js'

/** @typedef {import('./iconPackState').IconPackId} IconPackId */

export { normalizeFaIcon }

/**
 * Resolve an Iconify id for the active (or given) pack.
 * @param {string | [string, string]} icon
 * @param {IconPackId} [pack]
 * @returns {string | null}
 */
export function resolveIconifyId(icon, pack = currentIconPack.value) {
  return resolveMappedIcon(icon, pack, faAliasToCanon, faIconMap)
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

  const iconifyId = resolveIconifyId(icon, pack)
  if (!iconifyId) {
    return name
  }

  // "simple-icons:youtube" / "ph:sort-ascending" / "otx:playlist-add"
  const colon = iconifyId.indexOf(':')
  return colon === -1 ? iconifyId : iconifyId.slice(colon + 1)
}
