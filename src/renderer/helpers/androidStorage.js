import { registerPlugin } from '@capacitor/core'
import { blobToDataUrl } from './fileData'

const AndroidStorage = process.env.IS_CAPACITOR ? registerPlugin('AndroidStorage') : null

/** Display external-storage document IDs as paths without changing the saved URI. */
export function displayAndroidPath(path) {
  if (!path?.startsWith('content://com.android.externalstorage.documents/')) return path
  try {
    const url = new URL(path)
    const id = url.pathname.match(/\/(?:document|tree)\/([^/]+)$/)?.[1]
    if (!id) return path
    const documentId = decodeURIComponent(id)
    const separator = documentId.indexOf(':')
    if (separator < 0) return path
    const volume = documentId.slice(0, separator)
    if (volume !== 'primary' && !/^[\da-f]+(?:-[\da-f]+)+$/i.test(volume)) return path
    return `${volume === 'primary' ? '/sdcard' : `/storage/${volume}`}/${documentId.slice(separator + 1)}`
  } catch {
    return path
  }
}

export async function chooseAndroidDirectory() {
  const result = await AndroidStorage.chooseDirectory()
  return result.path
}

/**
 * @param {string} fileName
 * @param {string | Blob} content
 * @param {string} mimeType
 * @param {string} [directory] Persisted Android document-tree URI; otherwise prompts for a file.
 * @returns {Promise<boolean>}
 */
export async function saveAndroidFile(fileName, content, mimeType, directory) {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content
  const dataUrl = await blobToDataUrl(blob)
  const result = await AndroidStorage.saveFile({ fileName, data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType, directory })
  return result.saved === true
}

function storageBytes(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

export async function getAndroidStorageUsage() {
  const result = await (AndroidStorage?.getUsage() ?? Promise.resolve({}))
  return {
    androidAppData: storageBytes(result.appDataBytes),
    androidCache: storageBytes(result.cacheBytes),
  }
}

export async function clearAndroidCache() {
  const result = await (AndroidStorage?.clearCache() ?? Promise.resolve({ cleared: false }))
  return result.cleared === true
}
