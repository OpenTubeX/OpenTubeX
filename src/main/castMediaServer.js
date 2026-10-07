import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { Readable, pipeline } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { rewriteCastDash, rewriteCastHls, MAX_MANIFEST_SIZE, MAX_CAST_SUBTITLE_BYTES } from '../castManifestRewrite.js'
import { isNonPublicNetworkAddress } from './utils.js'
import { getInlineCastManifestType } from '../castManifest.js'
export { rewriteCastDash, rewriteCastHls, MAX_CAST_SUBTITLE_BYTES } from '../castManifestRewrite.js'

const MAX_RESOURCES = 65_536
const MIN_RESOURCE_GRACE_MS = 120_000

/** Resolve once; the transport must connect only to this validated address set. */
export async function resolveCastMediaAddresses(url, authorizePrivateUrl, resolveHost) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, '')
  try {
    const endpoints = isIP(hostname) ? [{ address: hostname }] : (await resolveHost(hostname)).endpoints
    if (!endpoints.length || endpoints.some(({ address }) => !isIP(address))) return null
    if (endpoints.some(({ address }) => isNonPublicNetworkAddress(address)) && !await authorizePrivateUrl?.(url)) return null
    return endpoints.map(({ address }) => ({ address, family: isIP(address) }))
  } catch { return null }
}

/** Node HTTP(S) with pinned DNS, manual redirects and explicitly scoped credentials. */
export function fetchCastMedia(network, url, { method, headers, signal, addresses, proxy = 'DIRECT' }) {
  return new Promise((resolve, reject) => {
    // Node cannot enforce this pin through Chromium's proxy transport. Fail closed
    // instead of silently bypassing the user's configured/system proxy.
    if (proxy !== 'DIRECT') throw new Error('Cast media requires a direct route for validated DNS')
    const parsedUrl = httpUrl(url)
    const hostname = parsedUrl.hostname.replaceAll(/^\[|\]$/g, '')
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(({ address, family }) => !isIP(address) || isIP(address) !== family) ||
      (isIP(hostname) && !addresses.some(({ address }) => address === hostname))) {
      throw new Error('Missing validated Cast destination')
    }
    signal.throwIfAborted()
    const destinations = addresses.map(({ address, family }) => ({ address, family }))
    const request = network.request({
      protocol: parsedUrl.protocol,
      hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      // A fresh socket cannot reuse a connection from a previous DNS validation.
      agent: false,
      autoSelectFamily: true,
      lookup(_hostname, options, callback) {
        const candidates = options.family ? destinations.filter(endpoint => endpoint.family === options.family) : destinations
        if (!candidates.length) callback(new Error('No validated Cast destination for this address family'))
        else if (options.all) callback(null, candidates)
        else callback(null, candidates[0].address, candidates[0].family)
      }
    })
    for (const [name, value] of headers) request.setHeader(name, value)
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { request.destroy(); reject(signal.reason) }
    request.on('error', error => { cleanup(); reject(error) })
    request.on('response', incoming => {
      incoming.once('close', cleanup)
      incoming.once('end', cleanup)
      incoming.once('error', error => { cleanup(); reject(error) })
      try {
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item)
        }
        if (method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode) ||
          ([301, 302, 303, 307, 308].includes(incoming.statusCode) && responseHeaders.has('location'))) {
          resolve(new Response(null, { status: incoming.statusCode, headers: responseHeaders }))
          incoming.destroy()
          cleanup()
          return
        }
        let stream = incoming
        // Preserve fetch's decoded-body behavior even when a server ignores identity.
        const decoders = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }
        const encodings = (responseHeaders.get('content-encoding') ?? '').split(',').map(value => value.trim()).filter(value => value && value !== 'identity')
        for (const encoding of encodings.reverse()) {
          if (!Object.hasOwn(decoders, encoding)) throw new Error('Unsupported Cast content encoding')
          const decoder = decoders[encoding]()
          pipeline(stream, decoder, () => {})
          stream = decoder
        }
        resolve(new Response(Readable.toWeb(stream), { status: incoming.statusCode, headers: responseHeaders }))
      } catch (error) { incoming.destroy(); cleanup(); reject(error) }
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else request.end()
  })
}

function httpUrl(value, base) {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported Cast resource URL')
  return url
}

function applyHlsReloadQuery(url, query) {
  if (query.length > 512) throw new Error('Invalid HLS reload query')
  const directives = new URLSearchParams(query)
  const names = new Set()
  for (const [name, value] of directives) {
    const valid = name === '_HLS_skip'
      ? ['YES', 'v2'].includes(value)
      : ['_HLS_msn', '_HLS_part'].includes(name) && /^\d{1,20}$/.test(value)
    if (!valid || names.has(name)) throw new Error('Invalid HLS reload query')
    names.add(name)
  }
  if (directives.has('_HLS_part') && !directives.has('_HLS_msn') && !url.searchParams.has('_HLS_msn')) throw new Error('Invalid HLS reload query')
  if (!names.size) return
  // Preserve signed query encoding and repeated upstream parameters exactly.
  const original = url.search ? url.search.slice(1).split('&') : []
  url.search = [...original.filter(part => !names.has(new URLSearchParams(part).keys().next().value)), directives.toString()].join('&')
}

function hlsResourceGrace(text) {
  let duration = 0
  let longest = 0
  let target = 0
  for (const line of text.split('\n')) {
    const value = Number(line.match(/^#EXTINF:([\d.]+)/)?.[1] ??
      (line.startsWith('#EXT-X-PART:') ? line.replaceAll(/"[^"]*"/g, '""').match(/(?:[:,])DURATION=([\d.]+)/)?.[1] : undefined))
    if (Number.isFinite(value)) { duration += value; longest = Math.max(longest, value) }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) target = Number(line.slice(line.indexOf(':') + 1)) || 0
  }
  // Include a full playlist plus a segment, and at least three target durations
  // for partial segments. The minimum also covers delayed receiver requests.
  const graceMs = Math.max(MIN_RESOURCE_GRACE_MS, (duration + longest) * 1000, target * 3000)
  if (!Number.isFinite(graceMs)) throw new Error('Invalid Cast HLS duration')
  return graceMs
}

function dashResourceGrace(attributes) {
  function duration(value) {
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value ?? '')
    // Calendar units use their longest duration to keep retirement conservative.
    const seconds = [366 * 86400, 31 * 86400, 86400, 3600, 60, 1]
    return match ? match.slice(1).reduce((total, part, index) => total + Number(part ?? 0) * seconds[index], 0) * 1000 : 0
  }
  const graceMs = Math.max(MIN_RESOURCE_GRACE_MS,
    duration(attributes.timeShiftBufferDepth) + duration(attributes.maxSegmentDuration) + 2 * duration(attributes.minimumUpdatePeriod))
  if (!Number.isFinite(graceMs)) throw new Error('Invalid Cast DASH duration')
  return graceMs
}

/** A session-scoped endpoint; only registered resources are fetchable. */
export function createCastMediaServer(source, deviceAddress, token, getHeaders = () => ({}), isAllowedUrl = () => false, fetchMedia = fetch) {
  const resources = new Map()
  const resourceIds = new Map()
  let nextResourceId = 0
  let currentDashManifest = null
  let origin
  function collectExpiredResources() {
    // Follow session roots and active requests. Rendition-report cycles also
    // become unreachable when their parent playlist drops them.
    const reachable = new Set()
    const pending = [...resources.values()].filter(resource => resource.persistent || resource.active || resource === currentDashManifest).map(resource => resource.id)
    while (pending.length) {
      const id = pending.pop()
      if (reachable.has(id)) continue
      reachable.add(id)
      const resource = resources.get(id)
      if (resource) {
        for (const reference of resource.references) if (!reachable.has(reference)) pending.push(reference)
      }
    }
    const now = Date.now()
    for (const resource of resources.values()) {
      if (reachable.has(resource.id)) resource.expiresAt = undefined
      else {
        resource.expiresAt ??= now + resource.graceMs
        if (resource.expiresAt <= now) {
          resources.delete(resource.id)
          resourceIds.delete(resource.key)
        }
      }
    }
  }
  function register(value, contentType, hlsVariables, dashContext, references) {
    const values = Array.isArray(value) ? value : [value]
    const candidates = values.map(value => {
      const inline = /^data:/i.test(value)
      if (inline) {
        const inlineType = getInlineCastManifestType(value)
        const supported = (inlineType && (contentType === undefined || contentType === inlineType)) ||
          (contentType === 'text/vtt' && /^data:text\/vtt;charset=utf-8,/i.test(value))
        const limit = contentType === 'text/vtt' ? MAX_CAST_SUBTITLE_BYTES : MAX_MANIFEST_SIZE
        if (!supported || value.length > limit * 3 + 64) {
          throw new Error('Unsupported Cast data URL')
        }
      } else httpUrl(value)
      const template = !hlsVariables && !dashContext && !inline && value.includes('$')
      const url = template ? httpUrl(value) : null
      const firstPlaceholder = url?.pathname.indexOf('$') ?? -1
      const directoryEnd = url ? url.pathname.lastIndexOf('/', firstPlaceholder < 0 ? url.pathname.length : firstPlaceholder) + 1 : 0
      return {
        url: template ? new URL(url.pathname.slice(0, directoryEnd), url).href : value,
        suffix: template ? url.pathname.slice(directoryEnd) + url.search : value.endsWith('/') ? '' : 'media'
      }
    })
    // Keep variable contexts in resource identity rather than a session-long
    // intern table, so retiring a resource also releases its import context.
    const key = JSON.stringify([candidates, contentType, hlsVariables, dashContext])
    let id = resourceIds.get(key)
    if (id === undefined) {
      if (resources.size >= MAX_RESOURCES) throw new Error('Too many Cast resources')
      id = nextResourceId++
      resourceIds.set(key, id)
      resources.set(id, {
        id,
        key,
        urls: candidates.map(candidate => candidate.url),
        contentType,
        hlsVariables,
        dashContext,
        references: new Set(),
        graceMs: MIN_RESOURCE_GRACE_MS,
        active: 0,
        persistent: false
      })
    }
    if (references) references.add(id)
    else resources.get(id).persistent = true
    return `${origin}/${token}/${id}/${candidates[0].suffix}`
  }
  const server = createServer(async (request, response) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Range',
      'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Date',
    }
    const match = new RegExp(`^/${token}/(\\d+)/(.*)$`).exec(request.url ?? '')
    if (request.socket.remoteAddress?.replace(/^::ffff:/, '') !== deviceAddress || !match ||
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      response.writeHead(404).end()
      return
    }
    const resource = resources.get(Number(match[1]))
    if (!resource) { response.writeHead(404).end(); return }
    if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return }
    resource.active++
    const controller = new AbortController()
    response.on('close', () => { resource.active--; controller.abort() })
    let timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      let data
      let contentType = resource.contentType
      let upstream
      let url
      let manifest = false
      if (/^data:/i.test(resource.urls[0])) {
        if (match[2] !== 'media') throw new Error('Invalid Cast resource path')
        data = decodeURIComponent(resource.urls[0].slice(resource.urls[0].indexOf(',') + 1))
        const limit = contentType === 'text/vtt' ? MAX_CAST_SUBTITLE_BYTES : MAX_MANIFEST_SIZE
        if (Buffer.byteLength(data) > limit) throw new Error('Cast data is too large')
        contentType ??= getInlineCastManifestType(resource.urls[0])
      } else {
        for (const [index, candidate] of resource.urls.entries()) {
          const attempt = new AbortController()
          const signal = AbortSignal.any([controller.signal, attempt.signal])
          let attemptTimeout
          try {
            url = httpUrl(candidate)
            let path = match[2]
            const queryStart = path.indexOf('?')
            const hls = ['application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(resource.contentType) ||
              (resource.contentType === undefined && /\.m3u8$/i.test(url.pathname))
            const reloadQuery = queryStart >= 0 && hls ? path.slice(queryStart + 1) : undefined
            if (reloadQuery !== undefined) path = path.slice(0, queryStart)
            if (url.pathname.endsWith('/')) {
              const next = httpUrl(path, url)
              if (next.origin !== url.origin || !next.pathname.startsWith(url.pathname) || /%2e|%2f|%5c|%25/i.test(next.pathname)) throw new Error('Invalid Cast resource path')
              url = next
            } else if (path !== 'media') throw new Error('Invalid Cast resource path')
            if (reloadQuery !== undefined) applyHlsReloadQuery(url, reloadQuery)
            const blockingReload = hls && /^\d{1,20}$/.test(url.searchParams.get('_HLS_msn') ?? '') &&
              (!url.searchParams.has('_HLS_part') || /^\d{1,20}$/.test(url.searchParams.get('_HLS_part')))
            if (index === 0 && blockingReload) {
              // Manifest grace covers three target durations and a full media
              // window. Before the first playlist, only the receiver can cancel
              // the blocking wait; restore the body deadline once headers arrive.
              clearTimeout(timeout)
              timeout = resource.hlsTimingKnown
                ? setTimeout(() => controller.abort(), Math.min(2_147_483_647, resource.graceMs + 15_000))
                : undefined
            }
            if (resource.urls.length > 1 && !blockingReload) attemptTimeout = setTimeout(() => attempt.abort(), 5000)
            for (let redirects = 0; ; redirects++) {
              const addresses = await isAllowedUrl(url)
              if (!addresses) throw new Error('Unsupported Cast resource destination')
              const headers = new Headers(getHeaders(url.href) ?? {})
              headers.set('Accept-Encoding', 'identity')
              if (request.headers.range) headers.set('Range', request.headers.range)
              upstream = await fetchMedia(url.href, { headers, signal, redirect: 'manual', method: request.method, addresses })
              const location = upstream.headers.get('location')
              if (![301, 302, 303, 307, 308].includes(upstream.status) || !location) break
              if (redirects >= 5) throw new Error('Too many Cast media redirects')
              await upstream.body?.cancel()
              url = httpUrl(location, url)
            }
            if (!upstream.ok && index < resource.urls.length - 1) {
              await upstream.body?.cancel()
              continue
            }
            break
          } catch (error) {
            if (controller.signal.aborted || index === resource.urls.length - 1) throw error
          } finally { clearTimeout(attemptTimeout) }
        }
        if (timeout === undefined) timeout = setTimeout(() => controller.abort(), 15_000)
        contentType ??= upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        if (url.pathname.endsWith('.mpd')) contentType = 'application/dash+xml'
        if (/\.m3u8$/i.test(url.pathname)) contentType = 'application/x-mpegurl'
        manifest = ['application/dash+xml', 'application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(contentType)
        if (upstream.ok && request.method !== 'HEAD' && manifest) {
          if (Number(upstream.headers.get('content-length')) > MAX_MANIFEST_SIZE) throw new Error('Cast manifest is too large')
          data = ''
          const decoder = new TextDecoder()
          for await (const chunk of upstream.body) {
            data += decoder.decode(chunk, { stream: true })
            if (data.length > MAX_MANIFEST_SIZE) throw new Error('Cast manifest is too large')
          }
          data += decoder.decode()
        }
      }
      clearTimeout(timeout)
      const date = upstream?.headers.get('date')
      if (data !== undefined) {
        const references = new Set()
        const isManifest = contentType !== 'text/vtt'
        const dash = contentType === 'application/dash+xml'
        let dashAttributes
        const registerResource = (value, type, variables, context) => register(value, type, variables, context, references)
        if (isManifest) collectExpiredResources()
        const rewritten = contentType === 'text/vtt'
          ? data
          : dash
            ? rewriteCastDash(data, url?.href, registerResource, resource.dashContext, attributes => { dashAttributes = attributes })
            : rewriteCastHls(data, url?.href ?? resource.urls[0], registerResource, resource.hlsVariables)
        if (isManifest) {
          const graceMs = dash
            ? resource.dashContext ? resource.graceMs : dashResourceGrace(dashAttributes)
            : hlsResourceGrace(data)
          if (!dash) {
            resource.graceMs = Math.max(resource.graceMs, graceMs)
            resource.hlsTimingKnown = true
          }
          for (const id of references) {
            const child = resources.get(id)
            child.graceMs = Math.max(child.graceMs, graceMs)
          }
          if (dash && !resource.dashContext) {
            // Location advances the full MPD rather than keeping a chain of
            // obsolete manifests and all their old segment windows reachable.
            if (currentDashManifest && currentDashManifest !== resource) currentDashManifest.references.clear()
            currentDashManifest = resource
          }
          resource.references = references
          collectExpiredResources()
        }
        response.writeHead(200, { ...cors, ...(date ? { date } : {}), 'content-type': contentType, 'content-length': Buffer.byteLength(rewritten) })
        response.end(request.method === 'HEAD' ? undefined : rewritten)
        return
      }
      const headers = { ...cors, 'content-type': contentType ?? 'application/octet-stream' }
      if (date) headers.date = date
      const encoded = upstream.headers.get('content-encoding') && upstream.headers.get('content-encoding') !== 'identity'
      for (const name of encoded || manifest ? [] : ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name)
        if (value) headers[name] = value
      }
      response.writeHead(upstream.status, headers)
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel()
        response.end()
      } else {
        const stream = Readable.fromWeb(upstream.body)
        response.on('close', () => stream.destroy())
        stream.on('error', () => response.destroy()).pipe(response)
      }
    } catch {
      if (!response.headersSent) response.writeHead(502, cors).end()
      else response.destroy()
    } finally { clearTimeout(timeout) }
  })
  return {
    server,
    async listen(localAddress) {
      if (isIP(localAddress) !== 4) throw new Error('Cast requires an IPv4 network interface')
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, localAddress, () => { server.removeListener('error', reject); resolve() })
      })
      origin = `http://${localAddress}:${server.address().port}`
    },
    close() { server.close(); server.closeAllConnections() },
    setOrigin(value) { origin = value },
    register,
    mediaUrl() { return register(source.url, source.contentType) }
  }
}
