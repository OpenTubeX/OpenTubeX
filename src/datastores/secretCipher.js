// @ts-check

/** @typedef {import('./secretSettings.js').SecretCipher} SecretCipher */

/**
 * Electron's safeStorage, which keeps its key in the Keychain on macOS, DPAPI on
 * Windows and the Secret Service or KWallet on Linux. Without one of those,
 * Linux would fall back to a key that is the same everywhere, so secrets stay
 * unencrypted instead.
 * @param {typeof import('electron')} electron
 * @returns {Promise<SecretCipher | null>}
 */
export async function createSafeStorageCipher({ app, safeStorage }) {
  // The backend is only known once the app is ready.
  await app.whenReady()
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null
  if (!safeStorage.isEncryptionAvailable() || backend === 'basic_text' || backend === 'unknown') {
    console.warn(`Saving credentials unencrypted, as no system keyring is available${backend ? ` (${backend})` : ''}`)
    return null
  }
  return {
    encrypt: async texts => texts.map(text => safeStorage.encryptString(text).toString('base64')),
    decrypt: async texts => {
      // Rejecting keeps the secrets until the keyring is available again.
      if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keyring is unavailable')
      return texts.map(text => {
        try {
          return safeStorage.decryptString(Buffer.from(text, 'base64'))
        } catch (error) {
          // Only a value this keyring's key cannot decrypt is deleted.
          if (!safeStorage.isEncryptionAvailable()) throw error
          return null
        }
      })
    },
  }
}

/**
 * The Android Keystore or the iOS Keychain, through the app's SecretStorage plugin.
 * @param {{ encrypt(options: { values: string[] }): Promise<{ values: string[] }>, decrypt(options: { values: string[] }): Promise<{ values: (string | null)[] }> }} plugin
 * @returns {SecretCipher}
 */
function createNativeCipher(plugin) {
  return {
    encrypt: async values => (await plugin.encrypt({ values })).values,
    decrypt: async values => (await plugin.decrypt({ values })).values,
  }
}

/** @type {Promise<SecretCipher | null> | null} */
let cipher = null

/**
 * This platform's cipher for secret settings, or null where secrets are stored
 * unencrypted.
 * @returns {Promise<SecretCipher | null>}
 */
export function getSecretCipher() {
  // Each branch only bundles for its platform.
  if (cipher) return cipher
  if (process.env.IS_ELECTRON_MAIN) {
    cipher = createSafeStorageCipher(require('electron'))
  } else if (process.env.IS_CAPACITOR) {
    cipher = Promise.resolve(createNativeCipher(require('@capacitor/core').registerPlugin('SecretStorage')))
  } else {
    cipher = Promise.resolve(null)
  }
  return cipher
}
