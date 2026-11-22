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
