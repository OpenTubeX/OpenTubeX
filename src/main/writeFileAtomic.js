// @ts-check
import { open, rename, unlink } from 'node:fs/promises'

/**
 * Replaces a file so that a crash or power loss leaves either its old or its
 * new content. Writers of the same file share the temporary file, so they must
 * not overlap.
 * @param {string} file
 * @param {string | Uint8Array} data
 * @param {{ mode?: number, temporaryFile?: string }} [options] `mode` applies
 * only to new files
 */
export async function writeFileAtomic(file, data, { mode, temporaryFile = `${file}.tmp` } = {}) {
  try {
    const handle = await open(temporaryFile, 'w', mode)
    try {
      await handle.writeFile(data)
      // Otherwise the rename can reach the disk before the data, leaving an
      // empty or partial file after a power loss.
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryFile, file)
  } catch (error) {
    await unlink(temporaryFile).catch(() => {})
    throw error
  }
}
