// @ts-check
import { SECRET_SETTINGS } from '../nonTransferableSettings.js'

/**
 * Encrypts and decrypts with a key the system keeps, such as the OS keychain.
 * `decrypt` returns null for a value this key cannot decrypt, and rejects
 * only when the system could not be asked.
 * @typedef {object} SecretCipher
 * @property {(texts: string[]) => Promise<string[]>} encrypt
 * @property {(texts: string[]) => Promise<(string | null)[]>} decrypt
 */

/**
 * @typedef {{ _id: string, value?: unknown, encryptedValue?: string }} SettingDocument
 */

/** @param {unknown} doc */
function isEncrypted(doc) {
  return typeof (/** @type {SettingDocument} */ (doc)?.encryptedValue) === 'string'
}

/**
 * The document that stores a setting. A secret is encrypted when a cipher is
 * available, and otherwise stored as it is.
 * @param {string} _id
 * @param {unknown} value
 * @param {Promise<SecretCipher | null>} cipherPromise
 * @returns {Promise<SettingDocument>}
 */
export async function encodeSetting(_id, value, cipherPromise) {
  if (!SECRET_SETTINGS.has(_id) || value === undefined) return { _id, value }
  try {
    const cipher = await cipherPromise
    if (cipher) {
      const [encryptedValue] = await cipher.encrypt([JSON.stringify(value)])
      return { _id, encryptedValue }
    }
  } catch (error) {
    console.error(`Unable to encrypt the ${_id} setting, saving it unencrypted`, error)
  }
  return { _id, value }
}

/**
 * Decrypts the secrets among saved settings. A secret this device's keyring
 * cannot decrypt, such as one copied from another computer, is deleted, so the
 * user signs in again. When there is no keyring or it could not be asked, such
 * as when KWallet has not started yet, the secrets are only left out, so they
 * come back once it is available.
 * @template {SettingDocument} T
 * @param {T[]} docs
 * @param {import('@seald-io/nedb').default} datastore
 * @param {Promise<SecretCipher | null>} cipherPromise
 * @returns {Promise<T[]>}
 */
export async function decodeSettings(docs, datastore, cipherPromise) {
  const encrypted = docs.filter(isEncrypted)
  if (encrypted.length === 0) return docs
  /** @type {(string | null)[]} */
  let texts
  try {
    const cipher = await cipherPromise
    if (!cipher) {
      console.warn('Leaving out saved credentials, as no system keyring is available to decrypt them')
      return docs.filter(doc => !isEncrypted(doc))
    }
    texts = await cipher.decrypt(encrypted.map(doc => /** @type {string} */ (doc.encryptedValue)))
  } catch (error) {
    console.error('Unable to decrypt saved credentials', error)
    return docs.filter(doc => !isEncrypted(doc))
  }
  /** @type {Map<T, unknown>} */
  const values = new Map()
  for (const [index, doc] of encrypted.entries()) {
    const text = texts[index]
    let value
    try {
      value = text === null ? undefined : JSON.parse(text)
    } catch {}
    if (value === undefined) {
      console.warn(`Deleting the saved ${doc._id} setting, which cannot be decrypted on this device`)
      // Only if it was not saved again in the meantime.
      await datastore.removeAsync({ _id: doc._id, encryptedValue: doc.encryptedValue }, {})
    } else {
      values.set(doc, value)
    }
  }
  return docs.flatMap(doc => {
    if (!isEncrypted(doc)) return [doc]
    if (!values.has(doc)) return []
    const decoded = /** @type {T} */ ({ _id: doc._id, value: values.get(doc) })
    return [decoded]
  })
}

/**
 * The secrets in the copies of the settings kept for older versions, which
 * also saved Invidious credentials in the instance URL, as `user:password@`.
 */
// What follows the scheme, with a slash added so the address always ends with one
const AUTHORITY = "substr(json_extract(data, '$.value'), instr(json_extract(data, '$.value'), '://') + 3) || '/'"
const OLDER_COPY_SECRETS = `json_extract(data, '$._id') IN (SELECT value FROM json_each(?)) OR
  (json_extract(data, '$._id') = 'defaultInvidiousInstance' AND instr(json_extract(data, '$.value'), '://') > 0 AND
    instr(${AUTHORITY}, '@') BETWEEN 1 AND instr(${AUTHORITY}, '/'))`

/**
 * Encrypts secrets saved by a version that stored them as they are, and deletes
 * the ones this device's keyring cannot decrypt. Then removes their old content from
 * the database file and from the copies kept for older versions.
 * @param {import('@seald-io/nedb').default & { vacuumAsync?: () => Promise<void>, removeOlderCopiesAsync?: (condition: string, params?: unknown[]) => Promise<void> }} datastore
 * @param {Promise<SecretCipher | null>} cipherPromise
 */
export async function migrateSecretSettings(datastore, cipherPromise) {
  const docs = /** @type {SettingDocument[]} */ (await datastore.findAsync({ _id: { $in: [...SECRET_SETTINGS] } }))
  /** @type {SecretCipher | null} */
  let cipher = null
  try {
    cipher = await cipherPromise
  } catch {}
  const decoded = await decodeSettings(docs, datastore, cipherPromise)
  // Without a keyring, secrets are only left out, so nothing was deleted.
  let changed = cipher !== null && decoded.length < docs.length
  let encryptedAll = cipher !== null
  const plaintext = docs.filter(doc => !isEncrypted(doc) && doc.value !== undefined)
  if (plaintext.length > 0) {
    if (cipher) {
      try {
        const encrypted = await cipher.encrypt(plaintext.map(doc => JSON.stringify(doc.value)))
        for (const [index, { _id }] of plaintext.entries()) {
          await datastore.updateAsync({ _id }, { _id, encryptedValue: encrypted[index] }, {})
        }
        changed = true
      } catch (error) {
        encryptedAll = false
        console.error('Unable to encrypt saved credentials', error)
      }
    }
  }
  // The copies kept for older versions and recovery would still hold them
  // unencrypted. An older version then asks to sign in again.
  if (encryptedAll) {
    try {
      await datastore.removeOlderCopiesAsync?.(OLDER_COPY_SECRETS, [JSON.stringify([...SECRET_SETTINGS])])
    } catch (error) {
      console.error('Unable to remove saved credentials from older copies of the settings', error)
    }
  }
  // Rebuilding the file drops the deleted rows, which SQLite otherwise keeps
  // in free pages until they are reused.
  if (changed) {
    try {
      await datastore.vacuumAsync?.()
    } catch (error) {
      console.error('Unable to compact the settings database', error)
    }
  }
}
