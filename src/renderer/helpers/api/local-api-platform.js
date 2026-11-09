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
    // A timeout can also mean a stuck BotGuard program, which retrying cannot
    // fix. Wait for those only while the internet check reports an outage.
    async isNetworkError(error) {
      if (classifyRequestFailure(error) !== 'network') return false
      if (!/timed out/i.test(String(error?.message ?? error))) return true
      return !await initializeNetworkRecovery().checkConnection()
    }
  })
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
