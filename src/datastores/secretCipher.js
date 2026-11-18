// @ts-check

/** @typedef {import('./secretSettings.js').SecretCipher} SecretCipher */

/**
 * Electron's safeStorage, which keeps its key in the Keychain on macOS, DPAPI on
 * Windows and the Secret Service or KWallet on Linux. Without one of those,
 * Linux falls back to a key that is the same everywhere, so secrets stay
 * unencrypted instead.
 * @param {typeof import('electron')} electron
 * @returns {Promise<SecretCipher | null>}
 */
export async function createSafeStorageCipher({ app, safeStorage }) {
  // safeStorage only works once the app is ready.
  await app.whenReady()
  let available = await safeStorage.isAsyncEncryptionAvailable()
  // Values encrypted with Chromium's fallback key on Linux start with v10.
  if (available && process.platform === 'linux') {
    available = !(await safeStorage.encryptStringAsync('probe')).toString('latin1').startsWith('v10')
  }
  if (!available) {
    console.warn('Saving credentials unencrypted, as no system keyring is available')
    return null
  }
  return {
    encrypt: texts => Promise.all(texts.map(async text => (await safeStorage.encryptStringAsync(text)).toString('base64'))),
    decrypt: texts => Promise.all(texts.map(async text => {
      try {
        return (await safeStorage.decryptStringAsync(Buffer.from(text, 'base64'))).result
      } catch (error) {
        // Only a value this keyring's key cannot decrypt is deleted. Other
        // errors, such as a keyring that is temporarily unavailable, reject,
        // which keeps the secrets until it is available again.
        if (error instanceof Error && error.message.startsWith('Error while decrypting')) return null
        throw error
      }
    })),
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
