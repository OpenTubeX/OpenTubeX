import { computed, ref } from 'vue'
import { registerMappedIcons } from './registerMappedIcons.js'

export const ICON_PACKS = /** @type {const} */ ([
  { id: 'fontawesome', label: 'Font Awesome (legacy)' },
  { id: 'material', label: 'Material Symbols' },
  { id: 'tabler', label: 'Tabler' },
  { id: 'phosphor', label: 'Phosphor' },
  { id: 'lucide', label: 'Lucide' },
  { id: 'remix', label: 'Remix Icon' },
])

/** @typedef {(typeof ICON_PACKS)[number]['id']} IconPackId */

const STORAGE_KEY = 'otx-icon-pack-preview-v2'

/** @type {Set<IconPackId>} */
const VALID_PACK_IDS = new Set(ICON_PACKS.map((pack) => pack.id))

/**
 * @returns {IconPackId}
 */
function readStoredPack() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && VALID_PACK_IDS.has(/** @type {IconPackId} */ (stored))) {
      return /** @type {IconPackId} */ (stored)
    }
  } catch {
    // ignore (private mode / unavailable storage)
  }
  return 'fontawesome'
}

/** @type {import('vue').Ref<IconPackId>} */
const iconPack = ref(readStoredPack())
let selectionSequence = 0

export const currentIconPack = computed(() => iconPack.value)

/**
 * @param {IconPackId} pack
 * @returns {Promise<boolean>} whether the pack became the active selection
 */
export async function setIconPack(pack) {
  if (!VALID_PACK_IDS.has(pack)) {
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
  try {
    localStorage.setItem(STORAGE_KEY, pack)
  } catch {
    // ignore
  }
  return true
}
