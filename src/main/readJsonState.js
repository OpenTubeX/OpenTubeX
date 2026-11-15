// @ts-check
import { constants } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'

/**
 * Reads a JSON state file that the caller saves over later. A missing file
 * reads as `undefined`. A corrupt or invalid one is copied aside first, as the
 * next save replaces it, and also reads as `undefined`. A copy never replaces
 * an earlier one. Other errors, including a failed copy, propagate, so the
 * caller cannot save over a file it could not read.
 * @param {string} file
 * @param {string} label
 * @param {(value: unknown) => boolean} [isValid]
 * @returns {Promise<unknown>}
 */
export async function readJsonState(file, label, isValid = () => true) {
  let value
  try {
    value = JSON.parse(await readFile(file, 'utf8'))
    if (isValid(value)) return value
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    if (!(error instanceof SyntaxError)) throw error
  }
  console.error(`The saved ${label} is corrupt, starting empty`)
  await copyFile(file, `${file}.corrupt-${Date.now()}`, constants.COPYFILE_EXCL)
  return undefined
}
