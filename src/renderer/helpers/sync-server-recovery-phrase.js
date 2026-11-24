// @ts-check
import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

import { preparePrivacyKey } from './sync-server-privacy-crypto.js'

export const RECOVERY_PHRASE_TYPO_MESSAGE =
  'This looks like a recovery phrase with a typo. Check each word and its order.'

const WORDS = new Set(wordlist)
const PHRASE_LENGTHS = new Set([12, 15, 18, 21, 24])

/** A random 12-word BIP39 phrase, which holds 128 bits of entropy. */
export function generateRecoveryPhrase() {
  return generateMnemonic(wordlist, 128)
}

/** @param {string} passphrase */
function phraseWords(passphrase) {
  return passphrase.trim().toLowerCase().split(/\s+/)
}

/**
 * Keyboards capitalize the first word or add spaces, so a passphrase made of
 * word-list words is compared in the form `generateRecoveryPhrase` returns.
 * @param {string} passphrase
 * @returns {string | null} The canonical phrase, or null for other passphrases
 */
export function normalizeRecoveryPhrase(passphrase) {
  const words = phraseWords(passphrase)
  return PHRASE_LENGTHS.has(words.length) && words.every(word => WORDS.has(word))
    ? words.join(' ')
    : null
}

/**
 * Whether the passphrase is a recovery phrase with a mistyped word: one that
 * is not in the word list or fails the phrase's checksum.
 * @param {string} passphrase
 */
function isMistypedRecoveryPhrase(passphrase) {
  const words = phraseWords(passphrase)
  if (!PHRASE_LENGTHS.has(words.length) || !words.every(word => /^[a-z]+$/.test(word))) return false
  const unknown = words.filter(word => !WORDS.has(word)).length
  if (unknown > 0) return unknown <= 2
  return !validateMnemonic(words.join(' '), wordlist)
}

/**
 * Derives the privacy key from a passphrase or recovery phrase. An existing
 * passphrase made of word-list words may differ from its canonical phrase in
 * case or spacing, so it is tried as typed when the canonical phrase fails.
 * A new key comes from the passphrase as given: it may be a custom passphrase
 * that only resembles a recovery phrase.
 * @param {string | null | undefined} payload Encrypted data the key must decrypt, if the account has any
 * @param {string} passphrase
 */
export async function preparePrivacyKeyFromPassphrase(payload, passphrase) {
  const phrase = normalizeRecoveryPhrase(passphrase)
  if (!payload) return preparePrivacyKey(payload, phrase ?? passphrase)

  let lastError
  for (const candidate of new Set([phrase ?? passphrase, passphrase])) {
    try {
      return await preparePrivacyKey(payload, candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw isMistypedRecoveryPhrase(passphrase) ? new Error(RECOVERY_PHRASE_TYPO_MESSAGE) : lastError
}
