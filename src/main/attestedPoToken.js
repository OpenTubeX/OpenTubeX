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
  let token
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    token = await mint()
    if (token.length <= MAX_ATTESTED_PO_TOKEN_LENGTH) break
  }
  return token
}
