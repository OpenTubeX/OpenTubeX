import { isAppHidden } from './appVisibility.js'
import { createInternetConnectivity, createInternetProbe, INTERNET_CHECK_URL } from './internetConnectivity.js'
import { classifyRequestFailure } from './api/requestDiagnostics.js'
import { createAbortError } from './api/requestErrors.js'
import { waitForRequest } from './api/requestWait.js'
import { ensureAndroidLocalNetworkAccess } from './androidLocalNetwork.js'

const nonNetworkErrors = new WeakSet()
export function isRecoverableNetworkError(error) {
  return !nonNetworkErrors.has(error) && classifyRequestFailure(error) === 'network'
}

/**
 * One connectivity listener for the app. Each origin gets one recovery probe,
 * so an unavailable optional service cannot block YouTube or another backend.
 */
export function createNetworkRecovery({ eventTarget, isOnline, visibilityTarget, isVisible, checkInternet, internetChecksEnabled = true, onChange = () => {} }) {
  const deviceEvents = eventTarget
  const isDeviceOnline = isOnline
  const connectivity = checkInternet ? createInternetConnectivity({ eventTarget, isOnline, probe: checkInternet, enabled: internetChecksEnabled, visibilityTarget, isVisible }) : null
  if (connectivity) {
    eventTarget = connectivity.events
    isOnline = () => connectivity.online
  }
  const shutdown = new AbortController()
  const origins = new Map()
  const delegatedSignals = new WeakMap()
  let state
  let restoredTimer
  let online = isOnline()

  function publish(next) {
    if (state === next) return
    clearTimeout(restoredTimer)
    state = next
    onChange(state)
    if (state === 'restored') restoredTimer = setTimeout(() => publish('online'), 3000)
  }

  function update() {
    // Only OS status and independent reachability checks set global status.
    // An individual origin can keep retrying without declaring an outage.
    if (!online) publish('offline')
    else if (state === 'offline') publish('restored')
    else if (!state) publish('online')
  }

  function connectivityChanged() {
    online = isOnline()
    update()
  }
  eventTarget.addEventListener('online', connectivityChanged)
  eventTarget.addEventListener('offline', connectivityChanged)
  update()

  function wait(delay, signal, canAttempt) {
    return new Promise((resolve, reject) => {
      let timer
      const targets = deviceEvents === eventTarget ? [eventTarget] : [eventTarget, deviceEvents]
      const finish = (error) => {
        clearTimeout(timer)
        for (const target of targets) {
          target.removeEventListener('online', connected)
          target.removeEventListener('offline', disconnected)
        }
        signal.removeEventListener('abort', aborted)
        if (error) reject(error)
        else resolve()
      }
      const connected = () => { if (canAttempt()) finish() }
      const disconnected = () => { if (!canAttempt()) clearTimeout(timer) }
      const aborted = () => finish(createAbortError())
      for (const target of targets) {
        target.addEventListener('online', connected)
        target.addEventListener('offline', disconnected)
      }
      signal.addEventListener('abort', aborted, { once: true })
      if (canAttempt()) timer = setTimeout(() => finish(), delay)
      if (signal.aborted) aborted()
    })
  }

  function waitForPromise(promise, signal) {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(createAbortError())
      signal.addEventListener('abort', aborted, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
      if (signal.aborted) aborted()
    })
  }

  /**
   * Requests that reach a real host keep their own backoff while the internet
   * check fails, so a blocked check endpoint cannot stop reachable services.
   */
  async function run(originKey, task, { signal: callerSignal, retry = true, retryDuringOutage = false, isNetworkError = error => classifyRequestFailure(error) === 'network' } = {}) {
    const canAttempt = retryDuringOutage ? isDeviceOnline : isOnline
    const signal = callerSignal ? AbortSignal.any([callerSignal, shutdown.signal]) : shutdown.signal
    if (signal.aborted) throw createAbortError()
    if (connectivity) await waitForPromise(connectivity.ready, signal)
    if (signal.aborted) throw createAbortError()
    let origin = origins.get(originKey)
    if (!origin) {
      origin = { failed: false, probe: null, users: 0 }
      origins.set(originKey, origin)
    }
    origin.users++
    try {
      for (;;) {
        if (signal.aborted) throw createAbortError()
        if (origin.probe) {
          // A cancelled probe must release its followers, not cancel them.
          await waitForPromise(origin.probe, signal)
          continue
        }
        if (!canAttempt() || origin.failed) {
          origin.failed = true
          let release
          origin.probe = new Promise(resolve => { release = resolve })
          try {
            let delay = 5000
            for (;;) {
              await wait(delay, signal, canAttempt)
              if (!canAttempt()) continue
              try {
                const result = await task(signal)
                origin.failed = false
                return result
              } catch (error) {
                if (signal.aborted) throw createAbortError()
                const networkError = await isNetworkError(error)
                if (!networkError) {
                  origin.failed = false
                  throw error
                }
                if (online && connectivity) await waitForPromise(connectivity.check(), signal)
                if (!retry) throw error
                origin.failed = true
                delay = Math.min(delay * 2, 60000)
              }
            }
          } finally {
            origin.probe = null
            release()
          }
        }
        try {
          return await task(signal)
        } catch (error) {
          if (signal.aborted || !await isNetworkError(error)) throw error
          if (online && connectivity) await waitForPromise(connectivity.check(), signal)
          if (!retry) throw error
          origin.failed = true
        }
      }
    } finally {
      origin.users--
      if (origin.users === 0) {
        origins.delete(originKey)
      }
    }
  }

  return {
    run,
    setInternetChecksEnabled(enabled) {
      connectivity?.setEnabled(enabled)
      if (!enabled && online) publish('online')
    },
    /** A response from an internet host proves reachability despite a failed check. */
    confirmInternetReachable() {
      connectivity?.confirmReachable()
    },
    get ready() { return connectivity?.ready ?? Promise.resolve(online) },
    checkConnection: () => connectivity?.check() ?? Promise.resolve(online),
    // A whole-operation retry can own its transport calls, including backend
    // fallback. Those calls must not wait in a second, nested recovery queue.
    // Callers that also set their own deadline, such as long polls, skip the
    // default wait for response headers.
    delegateRequests(signal, { ownDeadline = false } = {}) {
      delegatedSignals.set(signal, ownDeadline)
      return () => delegatedSignals.delete(signal)
    },
    ownsRequests(signal) { return delegatedSignals.has(signal) },
    ownsDeadline(signal) { return delegatedSignals.get(signal) === true },
    get state() { return state },
    dispose() {
      shutdown.abort()
      connectivity?.dispose()
      clearTimeout(restoredTimer)
      eventTarget.removeEventListener('online', connectivityChanged)
      eventTarget.removeEventListener('offline', connectivityChanged)
    }
  }
}

let appRecovery
export const connectionEvents = new EventTarget()
export function getConnectionState() { return appRecovery?.state ?? 'online' }

/** Lets a caller with its own retries handle a request's failures outside the recovery queue. */
export function delegateRequests(signal, options) {
  return appRecovery?.delegateRequests(signal, options) ?? (() => {})
}

export function initializeNetworkRecovery({ checkInternet, internetChecksEnabled } = {}) {
  if (!appRecovery) {
    appRecovery = createNetworkRecovery({
      checkInternet,
      internetChecksEnabled,
      eventTarget: window,
      visibilityTarget: typeof document === 'undefined' ? undefined : document,
      isVisible: () => !isAppHidden(),
      isOnline: () => navigator.onLine !== false,
      onChange: state => connectionEvents.dispatchEvent(new CustomEvent('change', { detail: state }))
    })
  }
  return appRecovery
}

function isLocalHostname(hostname) {
  const host = hostname.replaceAll(/^\[|\]$/g, '').toLowerCase()
  if (host.includes(':')) return /^(::1$|f[cd]|fe[89ab])/.test(host)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return /^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(host)
  }
  return host === 'localhost' || /\.(localhost|local|lan|home\.arpa)$/.test(host)
}

/** Use the same queue for native HTTP and WebView requests. */
export function withNetworkRecovery(input, init, task, options = {}) {
  if (typeof window === 'undefined') return task(init?.signal)
  const request = input instanceof Request ? input : null
  const signal = init?.signal ?? request?.signal
  let url
  try {
    url = new URL(request?.url ?? input.toString(), location.href)
  } catch (error) {
    return Promise.reject(error)
  }
  // A captive portal can answer plain HTTP, but not HTTPS with a valid certificate.
  const confirmsInternet = url.protocol === 'https:' && !isLocalHostname(url.hostname)
  const confirm = response => {
    if (confirmsInternet) appRecovery?.confirmInternetReachable()
    return response
  }
  if (appRecovery?.ownsRequests(signal)) {
    return task(signal).then(confirm, async error => {
      // Keep transport classification when the caller owns the retry policy.
      await options.isNetworkError?.(error)
      throw error
    })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return task(init?.signal ?? request?.signal)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  // YouTube's metadata and chat APIs use POST for read-only queries.
  const retry = ['GET', 'HEAD'].includes(method) ||
    (method === 'POST' && /(^|\.)youtube\.com$/.test(url.hostname) &&
      /^\/youtubei\/v1\/(browse|search|player|next|guide|get_transcript|navigation\/resolve_url|updated_metadata|live_chat\/get_live_chat(?:_replay)?)$/.test(url.pathname))
  return initializeNetworkRecovery().run(url.origin, task, { ...options, signal: init?.signal ?? request?.signal, retry, retryDuringOutage: true })
    .then(confirm)
}

export function installNetworkFetch({ corsDisabled = false, checkInternet = false, internetChecksEnabled = true } = {}) {
  const fetch = window.fetch.bind(window)
  const probe = createInternetProbe(fetch)
  let requestLocalPermission = true
  initializeNetworkRecovery({
    checkInternet: checkInternet
      ? async signal => {
        if (process.env.IS_CAPACITOR && !process.env.IS_IOS) {
          try {
            await waitForRequest(ensureAndroidLocalNetworkAccess({ url: INTERNET_CHECK_URL, requestPermission: requestLocalPermission }), signal)
          } catch (error) {
            if (error?.code === 'LOCAL_ACCESS_DENIED') requestLocalPermission = false
            throw error
          }
        }
        return probe(signal)
      }
      : undefined,
    internetChecksEnabled
  })
  window.fetch = async (input, init) => withNetworkRecovery(input, init, async signal => {
    if (signal && appRecovery.ownsDeadline(signal)) return fetch(input instanceof Request ? input.clone() : input, init)
    // A fetch can stall while the OS still reports online. Bound the wait for
    // response headers; media response bodies keep their streaming behavior.
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new DOMException('Connection timed out', 'TimeoutError')), 30000)
    try {
      return await fetch(input instanceof Request ? input.clone() : input, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }, {
    async isNetworkError(error) {
      if (classifyRequestFailure(error) !== 'network') return false
      if (error.name !== 'TypeError' || navigator.onLine === false || corsDisabled) return true
      // Browsers hide CORS failures behind the same TypeError as a lost route.
      // Use the shared connectivity check to distinguish an internet outage.
      const networkError = !await appRecovery.checkConnection()
      if (!networkError) nonNetworkErrors.add(error)
      return networkError
    }
  })
}
