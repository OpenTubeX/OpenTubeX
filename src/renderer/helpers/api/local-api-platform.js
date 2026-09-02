/**
 * Evaluates youtubei.js player code in the sandboxed deciphering frame shared
 * by the Electron and Capacitor renderers.
 * @param {{ output: string }} data
 * @returns {Promise<unknown>}
 */
export function evaluatePlayerScript(data) {
  return new Promise((resolve, reject) => {
    const iframe = document.getElementById('sigFrame')
    if (!iframe?.contentWindow) {
      reject(new Error('The player-script evaluator is unavailable'))
      return
    }

    const messageId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 10000)}`

    /** @param {MessageEvent} event */
    const listener = (event) => {
      if (event.source !== iframe.contentWindow || typeof event.data !== 'string') return

      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.id !== messageId) return

      window.removeEventListener('message', listener)
      if (message.error) {
        reject(message.error)
      } else {
        resolve(message.result)
      }
    }

    window.addEventListener('message', listener)
    iframe.contentWindow.postMessage(JSON.stringify({
      id: messageId,
      code: data.output,
    }), '*')
  })
}

/**
 * Generates a video-bound PO token through the isolated host implementation.
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @returns {Promise<string>}
 */
export async function generateContentPoToken(
  videoId,
  context,
  initialAttestationData,
  ytConfig
) {
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
