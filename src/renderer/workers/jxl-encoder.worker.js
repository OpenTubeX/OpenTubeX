// The single-threaded build avoids bundling the threaded variants, which need
// a cross-origin isolated context the app does not have.
import createJxlEncoder from '@jsquash/jxl/codec/enc/jxl_enc.js'
import { defaultOptions } from '@jsquash/jxl/meta.js'

globalThis.addEventListener('message', async ({ data: { imageData, quality } }) => {
  try {
    const encoder = await createJxlEncoder({ noInitialRun: true })
    const result = encoder.encode(imageData.data, imageData.width, imageData.height, {
      ...defaultOptions,
      // The default effort (7) takes about 20 seconds for a 4K frame.
      effort: 3,
      quality,
      lossless: quality === 100
    })
    if (!result) throw new Error('JPEG XL encoding failed')

    const { buffer } = result
    globalThis.postMessage({ buffer }, [buffer])
  } catch (error) {
    globalThis.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
})
