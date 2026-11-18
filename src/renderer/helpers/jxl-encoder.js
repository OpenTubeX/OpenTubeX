/**
 * Canvas cannot encode JPEG XL, so encode it with WebAssembly in a worker.
 * Each call uses a fresh worker that is terminated afterwards, which frees the
 * encoder's memory between the occasional screenshots.
 * @param {ImageData} imageData
 * @param {number} quality 0-100, where 100 is lossless
 * @returns {Promise<Blob>}
 */
export function encodeJxl(imageData, quality) {
  const worker = new Worker(
    new URL('../workers/jxl-encoder.worker.js', import.meta.url),
    { type: 'module', name: 'jxl-encoder' }
  )

  return new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data }) => {
      if (data.error) {
        reject(new Error(data.error))
      } else {
        resolve(new Blob([data.buffer], { type: 'image/jxl' }))
      }
    })
    worker.addEventListener('error', (event) => {
      reject(new Error(event.message || 'JPEG XL encoder failed'))
    })
    worker.postMessage({ imageData, quality }, [imageData.data.buffer])
  }).finally(() => worker.terminate())
}
