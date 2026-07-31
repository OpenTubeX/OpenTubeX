import { computed, ref } from 'vue'

export const ICON_PACKS = /** @type {const} */ ([
  { id: 'material', label: 'Material Symbols' },
  { id: 'fontawesome', label: 'Font Awesome (legacy)' },
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
  return 'material'
}

/** @type {import('vue').Ref<IconPackId>} */
const iconPack = ref(readStoredPack())

export const currentIconPack = computed(() => iconPack.value)

/**
 * @param {IconPackId} pack
 */
export function setIconPack(pack) {
  if (!VALID_PACK_IDS.has(pack)) {
    return
  }
  iconPack.value = pack
  try {
    localStorage.setItem(STORAGE_KEY, pack)
  } catch {
    // ignore
  }
}
