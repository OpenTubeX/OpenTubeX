import { computed, ref } from 'vue'
import { registerMappedIcons } from './registerMappedIcons.js'

export const ICON_PACKS = /** @type {const} */ ([
  'material',
  'remix',
])

/** @typedef {(typeof ICON_PACKS)[number]} IconPackId */

/** @type {Set<IconPackId>} */
const VALID_PACK_IDS = new Set(ICON_PACKS)

/**
 * @param {unknown} pack
 * @returns {pack is IconPackId}
 */
export function isIconPack(pack) {
  return typeof pack === 'string' && VALID_PACK_IDS.has(/** @type {IconPackId} */ (pack))
}

/** @type {import('vue').Ref<IconPackId>} */
const iconPack = ref('material')
let selectionSequence = 0

export const currentIconPack = computed(() => iconPack.value)

/**
 * @param {IconPackId} pack
 * @returns {Promise<boolean>} whether the pack became the active selection
 */
export async function setIconPack(pack) {
  if (!isIconPack(pack)) {
    return false
  }
  const sequence = ++selectionSequence
  try {
    await registerMappedIcons(pack)
  } catch (error) {
    if (sequence === selectionSequence) {
      console.error(`[icon-pack] failed to load ${pack}; keeping ${iconPack.value}`, error)
    }
    return false
  }
  if (sequence !== selectionSequence) return false
  iconPack.value = pack
  return true
}
