import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

// Kept out of the cache directory, which "Clear cache" and the OS can empty
// behind the in-memory images, and out of iCloud backups.
const directory = Directory.LibraryNoCloud
const folder = 'tab-previews'
const isValidName = name => /^[\w-]+$/.test(name)
const filePath = name => `${folder}/${name}.json`

// One queue keeps a removal from racing an earlier write of the same image.
let queue = Promise.resolve()
function enqueue(operation) {
  const result = queue.then(operation)
  queue = result.catch(() => {})
  return result
}

async function listFiles() {
  let files
  try {
    ({ files } = await Filesystem.readdir({ path: folder, directory }))
  } catch (error) {
    // The folder does not exist until the first image is stored. Any other
    // failure must not pass for an empty cache.
    const exists = await Filesystem.stat({ path: folder, directory }).then(() => true, () => false)
    if (exists) throw error
    return []
  }
  return files.filter(file => file.type !== 'directory' && file.name.endsWith('.json'))
}

/**
 * @param {string} prefix
 * @returns {Promise<Map<string, object>>} stored entries by name
 */
export function readStoredTabImages(prefix) {
  return enqueue(async () => {
    const entries = new Map()
    for (const file of await listFiles()) {
      const name = file.name.slice(0, -'.json'.length)
      if (!name.startsWith(prefix)) continue
      try {
        const { data } = await Filesystem.readFile({ path: filePath(name), directory, encoding: Encoding.UTF8 })
        const entry = JSON.parse(data)
        if (typeof entry?.image === 'string' && entry.image.startsWith('data:image/')) entries.set(name, entry)
      } catch (error) {
        console.warn('Failed to read cached tab image:', error)
      }
    }
    return entries
  })
}

export function writeStoredTabImage(name, entry) {
  if (!isValidName(name)) return Promise.resolve()
  return enqueue(() => Filesystem.writeFile({
    path: filePath(name),
    data: JSON.stringify(entry),
    directory,
    encoding: Encoding.UTF8,
    recursive: true
  })).catch(error => console.warn('Failed to cache tab image:', error))
}

export function removeStoredTabImage(name) {
  if (!isValidName(name)) return Promise.resolve()
  return enqueue(() => Filesystem.deleteFile({ path: filePath(name), directory }))
    .catch(() => {})
}

/** @param {string} prefix */
export function removeStoredTabImages(prefix) {
  return enqueue(async () => {
    for (const file of await listFiles()) {
      if (!file.name.startsWith(prefix)) continue
      await Filesystem.deleteFile({ path: `${folder}/${file.name}`, directory }).catch(() => {})
    }
  })
}

export function clearStoredTabImages() {
  return enqueue(async () => {
    try {
      await Filesystem.rmdir({ path: folder, directory, recursive: true })
    } catch (error) {
      if ((await listFiles()).length > 0) throw error
    }
  })
}

/** @returns {Promise<number>} */
export function getStoredTabImagesSize() {
  return enqueue(async () => (await listFiles()).reduce((total, file) => total + (file.size || 0), 0))
}
