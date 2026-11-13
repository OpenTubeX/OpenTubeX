import { PlayerScriptEvaluator } from './player-script-evaluator.js'
import { initializeNetworkRecovery, withNetworkRecovery } from '../networkRecovery.js'
import { classifyRequestFailure } from './requestDiagnostics.js'

const playerScriptEvaluator = new PlayerScriptEvaluator(() => new Worker(
  new URL('./player-script-worker.js', import.meta.url),
  { name: 'player-script-worker' }
))

/**
 * Interprets youtubei.js player code in a worker shared by Electron and Capacitor.
 * @param {{ output: string }} data
 * @returns {Promise<unknown>}
 */
export function evaluatePlayerScript(data) {
  return playerScriptEvaluator.evaluate(data.output)
}

/** Loads the player-script interpreter before the first video needs it. */
export function prewarmPlayerScriptEvaluator() {
  playerScriptEvaluator.prewarm()
}

const STUCK_BOTGUARD = /PO token (?:generation|minting) timed out|VM operation timed out/

/**
 * Generates a video-bound PO token through the isolated host implementation.
 * BotGuard loads in its own view, outside `window.fetch`, so its runs wait in
 * YouTube's recovery queue like the requests before and after them.
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @param {() => boolean} [isNeeded] rechecked before each retry
 * @returns {Promise<string | undefined>}
 */
export function generateContentPoToken(videoId, context, initialAttestationData, ytConfig, isNeeded = () => true) {
  return withNetworkRecovery('https://www.youtube.com/', undefined, async () => {
    if (!isNeeded()) return undefined
    return await generateHostPoToken(videoId, context, initialAttestationData, ytConfig)
  }, {
    // A job or VM deadline can also mean a stuck BotGuard program, which
    // retrying cannot fix. Wait for those only while the internet check
    // reports an outage. Their messages are ours or bgutils', so they are
    // English on every platform, unlike iOS's localized request timeouts.
    async isNetworkError(error) {
      if (classifyRequestFailure(error) !== 'network') return false
      if (!STUCK_BOTGUARD.test(String(error?.message ?? error))) return true
      return !await initializeNetworkRecovery().checkConnection()
    }
  })
}

/**
 * Mints a video-bound PO token from an existing BotGuard attestation.
 * @param {string} videoId
 * @returns {Promise<string | null>} `null` when BotGuard would have to run first
 */
export async function mintContentPoTokenFromAttestation(videoId) {
  if (process.env.IS_ELECTRON) return await window.ftElectron.mintPoToken(videoId)
  if (process.env.IS_CAPACITOR) {
    const { mintCapacitorPoTokenFromAttestation } = await import('./capacitor-po-token')
    return await mintCapacitorPoTokenFromAttestation(videoId)
  }
  return null
}

async function generateHostPoToken(videoId, context, initialAttestationData, ytConfig) {
  if (process.env.IS_ELECTRON) {
    return window.ftElectron.generatePoToken(
      videoId,
      JSON.stringify(context),
      JSON.stringify(initialAttestationData),
      JSON.stringify(ytConfig)
    )
  }

  if (process.env.IS_CAPACITOR) {
    const { generateCapacitorPoToken } = await import('./capacitor-po-token')
    return generateCapacitorPoToken(
      videoId,
      context,
      initialAttestationData,
      ytConfig
    )
  }

  throw new Error('PO token generation is unavailable on this platform')
}
