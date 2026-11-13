import { registerPlugin } from '@capacitor/core'

import { mintAttestedPoToken } from '../../../main/attestedPoToken'

const PoToken = registerPlugin('PoToken')

/**
 * Runs YouTube's BotGuard program in an isolated native WebView. Android and
 * iOS keep an attested BotGuard run and mint later tokens from it until it expires.
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @returns {Promise<string>}
 */
export function generateCapacitorPoToken(videoId, context, initialAttestationData, ytConfig) {
  const options = {
    videoId,
    sessionContext: JSON.stringify(context),
    initialAttestationData: JSON.stringify(initialAttestationData),
    ytConfig: JSON.stringify(ytConfig)
  }

  return mintAttestedPoToken(async () => (await PoToken.generate(options)).token)
}

/**
 * Mints a video-bound PO token from the native attestation without running BotGuard.
 * @param {string} videoId
 * @returns {Promise<string | null>} `null` without a valid, attested BotGuard run
 */
export async function mintCapacitorPoTokenFromAttestation(videoId) {
  return (await PoToken.mint({ videoId })).token ?? null
}
