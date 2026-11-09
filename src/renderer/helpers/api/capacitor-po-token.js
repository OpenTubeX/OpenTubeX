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
