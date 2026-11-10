import { isAppHidden } from './appVisibility.js'
import { createInternetConnectivity, createInternetProbe, INTERNET_CHECK_URL } from './internetConnectivity.js'
import { classifyRequestFailure } from './api/requestDiagnostics.js'
import { createAbortError } from './api/requestErrors.js'
import { waitForRequest } from './api/requestWait.js'
import { ensureAndroidLocalNetworkAccess } from './androidLocalNetwork.js'

const nonNetworkErrors = new WeakSet()
// Chromium errors that retrying the same request cannot fix
const PERMANENT_REQUEST_ERRORS = new Set([
  'net::ERR_TOO_MANY_REDIRECTS',
  'net::ERR_UNSAFE_REDIRECT',
  'net::ERR_INVALID_REDIRECT',
  'net::ERR_BLOCKED_BY_CLIENT',
  'net::ERR_BLOCKED_BY_RESPONSE',
  'net::ERR_INVALID_URL',
  'net::ERR_DISALLOWED_URL_SCHEME',
  'net::ERR_UNKNOWN_URL_SCHEME',
])
export function isRecoverableNetworkError(error) {
  return !nonNetworkErrors.has(error) && classifyRequestFailure(error) === 'network'
}

/**
 * One connectivity listener for the app. Each origin gets one recovery probe,
 * so an unavailable optional service cannot block YouTube or another backend.
 */
export function createNetworkRecovery({ eventTarget, isOnline, visibilityTarget, isVisible, checkInternet, internetChecksEnabled = true, onChange = () => {}, onWaitingChange = () => {} }) {
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

  function waitingOrigins() {
    return [...origins].filter(([, origin]) => origin.probe).map(([key]) => key)
  }

  function wait(delay, signal, canAttempt, origin) {
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
        origin.wake = null
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
      origin.wake = connected
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
  async function run(originKey, task, { signal: callerSignal, retry = true, retryDuringOutage = false, isNetworkError = error => classifyRequestFailure(error) === 'network', onWait = () => {} } = {}) {
    const canAttempt = retryDuringOutage ? isDeviceOnline : isOnline
    const signal = callerSignal ? AbortSignal.any([callerSignal, shutdown.signal]) : shutdown.signal
    if (signal.aborted) throw createAbortError()
    if (connectivity) await waitForPromise(connectivity.ready, signal)
    if (signal.aborted) throw createAbortError()
    let origin = origins.get(originKey)
    if (!origin) {
      origin = { failed: false, probe: null, users: 0, wake: null, retryNow: false }
      origins.set(originKey, origin)
    }
    origin.users++
    try {
      for (;;) {
        if (signal.aborted) throw createAbortError()
        if (origin.probe) {
          onWait()
          // A cancelled probe must release its followers, not cancel them.
          await waitForPromise(origin.probe, signal)
          continue
        }
        if (!canAttempt() || origin.failed) {
          onWait()
          origin.failed = true
          let release
          origin.probe = new Promise(resolve => { release = resolve })
          onWaitingChange(waitingOrigins())
          try {
            let delay = 5000
            for (;;) {
              // Retry now during an attempt skips the next backoff.
              if (origin.retryNow) origin.retryNow = false
              else await wait(delay, signal, canAttempt, origin)
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
            origin.retryNow = false
            release()
            onWaitingChange(waitingOrigins())
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
    /** Origins whose requests wait for a recovery probe. */
    get waitingOrigins() { return waitingOrigins() },
    /** Ends the backoff of every waiting origin, for a user who wants to retry now. */
    retryNow() {
      for (const origin of origins.values()) {
        if (!origin.probe) continue
        if (origin.wake) origin.wake()
        else origin.retryNow = true
      }
    },
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
export function getWaitingOrigins() { return appRecovery?.waitingOrigins ?? [] }
export function retryWaitingRequests() { appRecovery?.retryNow() }

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
      onChange: state => connectionEvents.dispatchEvent(new CustomEvent('change', { detail: state })),
      onWaitingChange: origins => connectionEvents.dispatchEvent(new CustomEvent('waiting', { detail: origins }))
    })
  }
  return appRecovery
}

function isLocalHostname(hostname) {
  const host = hostname.replaceAll(/^\[|\]$/g, '').toLowerCase()
  if (host.includes(':')) return /^(::1$|::ffff:|f[cd]|fe[89ab])/.test(host)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return /^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(host)
  }
  return host === 'localhost' || /\.(localhost|local|lan|home\.arpa)$/.test(host)
}

/**
 * A captive portal can answer plain HTTP, but not HTTPS with a valid
 * certificate. A response from the HTTP cache proves nothing either, so only
 * requests that bypass it count, unless their transport keeps no cache.
 * @param {RequestInfo | URL} input
 * @param {RequestInit | undefined} init
 * @param {boolean} uncached
 */
function confirmsInternetReachability(input, init, uncached) {
  const request = input instanceof Request ? input : null
  const url = new URL(request?.url ?? input.toString(), location.href)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const cache = init?.cache ?? request?.cache ?? 'default'
  return url.protocol === 'https:' && !isLocalHostname(url.hostname) &&
    (uncached || !['GET', 'HEAD'].includes(method) || ['no-store', 'reload', 'no-cache'].includes(cache))
}

/**
 * Use the same queue for native HTTP and WebView requests. Set `uncached` for
 * transports without a response cache, whose responses always prove that the
 * internet is reachable.
 */
export function withNetworkRecovery(input, init, task, { uncached = false, ...options } = {}) {
  if (typeof window === 'undefined') return task(init?.signal)
  const request = input instanceof Request ? input : null
  const signal = init?.signal ?? request?.signal
  let url
  let confirmsInternet
  try {
    url = new URL(request?.url ?? input.toString(), location.href)
    confirmsInternet = confirmsInternetReachability(input, init, uncached)
  } catch (error) {
    return Promise.reject(error)
  }
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

/**
 * Waits in the queue of `url`'s origin until its server replies, for clients
 * with their own retries, such as Shaka Player, which resume a failed stream
 * once its server is reachable again. Unlike the queued fetch, this keeps
 * waiting while other internet hosts answer.
 * @param {string} url
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>} whether the server was unreachable, false when it answered at once
 */
export async function waitUntilReachable(url, signal) {
  const probe = createInternetProbe((input, init) => withoutNetworkRecovery(() => window.fetch(input, init)), url)
  let unreachable = false
  await initializeNetworkRecovery().run(new URL(url).origin, async probeSignal => {
    // Hostnames must stay out of the message, which classifies the failure
    if (!await probe(probeSignal)) throw new Error('Connection failed')
  }, { signal, retryDuringOutage: true, onWait: () => { unreachable = true } })
  return unreachable
}

let networkRecoveryBypasses = 0

/**
 * Sends the `window.fetch` calls that `callback` makes synchronously straight
 * to the network, for clients with their own retries, deadlines and reconnect
 * handling, such as Shaka Player.
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
export function withoutNetworkRecovery(callback) {
  networkRecoveryBypasses++
  try {
    return callback()
  } finally {
    networkRecoveryBypasses--
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.corsDisabled] a failed fetch cannot be a CORS failure
 * @param {(url: string) => Promise<string | null>} [options.getRequestError] the network error behind a failed fetch
 * @param {boolean} [options.checkInternet]
 * @param {boolean} [options.internetChecksEnabled]
 */
export function installNetworkFetch({ corsDisabled = false, getRequestError, checkInternet = false, internetChecksEnabled = true } = {}) {
  const windowFetch = window.fetch.bind(window)
  const pendingRequests = new Set()
  // WebKit can collect an AbortSignal.any() result that only a pending fetch
  // refers to, and the fetch then ignores its abort. A connectivity probe or
  // timeout never ended, so keep each request reachable until it settles.
  const nativeFetch = async (input, init) => {
    const request = [input, init]
    pendingRequests.add(request)
    try {
      return await windowFetch(input, init)
    } finally {
      pendingRequests.delete(request)
    }
  }
  // Fetch hides the network error behind a TypeError. A redirect loop, for
  // example, would otherwise be retried like a lost connection.
  const fetch = async (input, init) => {
    // During an outage, the HTTP cache could answer a read without the
    // network. Revalidate it with the server, so its success proves that the
    // internet is reachable again.
    if (appRecovery?.state === 'offline' && ['GET', 'HEAD'].includes((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()) &&
      (init?.cache ?? (input instanceof Request ? input.cache : 'default')) === 'default') {
      init = { ...init, cache: 'no-cache' }
    }
    let response
    try {
      response = await nativeFetch(input, init)
    } catch (error) {
      if (getRequestError && error?.name === 'TypeError') {
        let requestError = null
        try {
          requestError = await getRequestError(new URL(input instanceof Request ? input.url : input.toString(), location.href).href)
        } catch {}
        if (PERMANENT_REQUEST_ERRORS.has(requestError)) nonNetworkErrors.add(error)
      }
      throw error
    }
    try {
      if (confirmsInternetReachability(input, init, false)) appRecovery?.confirmInternetReachable()
    } catch {}
    return response
  }
  const probe = createInternetProbe(nativeFetch)
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
  const recoveringFetch = async (input, init) => withNetworkRecovery(input, init, async signal => {
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
      if (nonNetworkErrors.has(error) || classifyRequestFailure(error) !== 'network') return false
      if (error.name !== 'TypeError' || navigator.onLine === false || corsDisabled) return true
      // Browsers hide CORS failures behind the same TypeError as a lost route.
      // Use the shared connectivity check to distinguish an internet outage.
      const networkError = !await appRecovery.checkConnection()
      if (!networkError) nonNetworkErrors.add(error)
      return networkError
    }
  })
  window.fetch = async (input, init) => {
    if (networkRecoveryBypasses === 0) return recoveringFetch(input, init)
    try {
      // Bypassed requests still show that the internet is reachable.
      return await fetch(input, init)
    } catch (error) {
      // The caller retries on its own, but an outage must still be noticed.
      if (classifyRequestFailure(error) === 'network') appRecovery?.checkConnection().catch(() => {})
      throw error
    }
  }
}
