import iconMap from './iconMap.json'
import { currentIconPack } from './iconPackState.js'
import { normalizeIcon, resolveMappedIcon } from './iconMappingResolver.js'

/** @typedef {import('./iconPackState').IconPackId} IconPackId */

export { normalizeIcon }

/**
 * Resolve an Iconify id for the active (or given) pack.
 * @param {string | [string, string]} icon
 * @param {IconPackId} [pack]
 * @returns {string | null}
 */
export function resolveIconifyId(icon, pack = currentIconPack.value) {
  return resolveMappedIcon(icon, pack, iconMap)
}
