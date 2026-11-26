// The build's browser targets (see _scripts/minimizers.js) include engines
// without these: Android WebViews before Chrome 120 that the Play Store does
// not update, such as Huawei's, Firefox before 124 and Safari before 17.4.
// Import this before any other module.

if (typeof AbortSignal.any !== 'function') {
  // Sources hold the combined signal strongly until one of them aborts. Unlike
  // the native version, a combined signal can then outlive its last other
  // reference, but its abort can never be lost while a request still waits.
  AbortSignal.any = function any(sources) {
    const controller = new AbortController()
    sources = Array.from(sources)
    const aborted = sources.find(source => source.aborted)
    if (aborted) {
      controller.abort(aborted.reason)
      return controller.signal
    }
    const listeners = sources.map(source => [source, () => {
      for (const [other, listener] of listeners) other.removeEventListener('abort', listener)
      controller.abort(source.reason)
    }])
    for (const [source, listener] of listeners) source.addEventListener('abort', listener)
    return controller.signal
  }
}

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve
    let reject
    const promise = new this((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

if (typeof URL.canParse !== 'function') {
  URL.canParse = function canParse(url, base) {
    try {
      // eslint-disable-next-line no-new
      new URL(url, base)
      return true
    } catch {
      return false
    }
  }
}
