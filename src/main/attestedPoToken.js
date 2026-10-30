/**
 * BotGuard returns a longer token when it doesn't trust the attestation. YouTube
 * serves such a session about a minute of media, then withholds the rest
 * pending attestation. Another BotGuard run usually returns an attested token.
 */
const MAX_ATTESTED_PO_TOKEN_LENGTH = 120
const MAX_ATTEMPTS = 3

/**
 * @param {() => Promise<string>} mint
 * @returns {Promise<string>}
 */
export async function mintAttestedPoToken(mint) {
  let token = await mint()
  for (let attempt = 1; attempt < MAX_ATTEMPTS && token.length > MAX_ATTESTED_PO_TOKEN_LENGTH; attempt++) {
    try {
      token = await mint()
    } catch {
      // Playback can still recover from a session pending attestation
      break
    }
  }
  return token
}
