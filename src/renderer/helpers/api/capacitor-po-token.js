import { registerPlugin } from '@capacitor/core'

const PoToken = registerPlugin('PoToken')

/**
 * Runs YouTube's BotGuard program in an isolated native WebView.
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @returns {Promise<string>}
 */
export async function generateCapacitorPoToken(videoId, context, initialAttestationData, ytConfig) {
  const { token } = await PoToken.generate({
    videoId,
    sessionContext: JSON.stringify(context),
    initialAttestationData: JSON.stringify(initialAttestationData),
    ytConfig: JSON.stringify(ytConfig)
  })

  return token
}
