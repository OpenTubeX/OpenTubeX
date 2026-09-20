/* global FileReaderSync */
self.addEventListener('message', ({ data: { id, bytes } }) => {
  try {
    // Native Blob encoding avoids building one JavaScript string per chunk.
    const url = new FileReaderSync().readAsDataURL(new Blob([bytes]))
    self.postMessage({ id, data: url.slice(url.indexOf(',') + 1) })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
})
