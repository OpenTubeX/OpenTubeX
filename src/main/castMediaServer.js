import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { Readable, pipeline } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import sax from 'sax'
import { isNonPublicNetworkAddress } from './utils.js'

const MAX_MANIFEST_SIZE = 2_000_000
export const MAX_CAST_SUBTITLE_BYTES = 8 * 1024 * 1024
const MAX_RESOURCES = 65_536
const HLS_RESOURCE_GRACE_MS = 120_000
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Resolve once; the transport must connect only to this validated address set. */
export async function resolveCastMediaAddresses(url, allowedPrivateOrigin, resolveHost) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, '')
  try {
    const endpoints = isIP(hostname) ? [{ address: hostname }] : (await resolveHost(hostname)).endpoints
    if (!endpoints.length || endpoints.some(({ address }) => !isIP(address) ||
      (url.origin !== allowedPrivateOrigin && isNonPublicNetworkAddress(address)))) return null
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

/** Rewrites resource URLs while retaining DASH ranges and segment templates. */
export function rewriteCastDash(xml, base, register, dashContext) {
  if (xml.length > MAX_MANIFEST_SIZE) throw new Error('Cast manifest is too large')
  const parser = sax.parser(true)
  const root = { children: [] }
  const stack = [root]
  parser.onopentag = tag => {
    const node = { name: tag.name, attributes: tag.attributes, children: [] }
    stack.at(-1).children.push(node)
    stack.push(node)
  }
  parser.onclosetag = () => stack.pop()
  parser.ontext = text => stack.at(-1).children.push(text)
  parser.oncdata = parser.ontext
  parser.ondoctype = () => { throw new Error('Unsupported Cast manifest doctype') }
  parser.write(xml).close()
  if (root.children.find(node => typeof node !== 'string')?.name.split(':').at(-1) !== (dashContext?.rootName ?? 'MPD')) {
    throw new Error('Invalid Cast DASH manifest')
  }
  function resolveUrls(values, bases) {
    const urls = new Set()
    for (const value of values) {
      for (const base of bases) {
        urls.add(httpUrl(value, base).href)
        if (urls.size > MAX_RESOURCES) throw new Error('Too many Cast resource alternatives')
      }
    }
    return [...urls]
  }
  function registerUrls(urls, contentType) {
    return register(urls.length === 1 ? urls[0] : urls, contentType)
  }
  function renderAttributes(node, bases, inheritedBases = bases) {
    const element = node.name.split(':').at(-1)
    return Object.entries(node.attributes).map(([name, value]) => {
      const attribute = name.split(':').at(-1)
      // Resolve-to-zero tells the DASH client to remove an element without fetching it.
      if (attribute === 'href' && ['Period', 'AdaptationSet', 'SegmentList'].includes(element) && value !== 'urn:mpeg:dash:resolve-to-zero:2013') {
        // XLinks resolve against the document; imported media inherits the
        // containing DASH element's bases when the receiver replaces the node.
        value = register(httpUrl(value, base).href, 'application/dash+xml', undefined, { rootName: element, bases: inheritedBases })
      } else if (['media', 'initialization', 'sourceURL'].includes(attribute) ||
          (attribute === 'href' && value !== 'urn:mpeg:dash:resolve-to-zero:2013') ||
          (attribute === 'index' && ['SegmentTemplate', 'SegmentURL'].includes(element)) ||
          (attribute === 'bitstreamSwitching' && element === 'SegmentTemplate')) {
        value = registerUrls(resolveUrls([value], bases))
      }
      return ` ${name}="${escapeXml(value)}"`
    }).join('')
  }
  function render(node, inheritedBases) {
    if (typeof node === 'string') return escapeXml(node)
    const name = node.name.split(':').at(-1)
    // Patch operations need the original MPD context to resolve their URLs.
    // Use full MPD refreshes until the relay supports that context.
    if (name === 'PatchLocation') return ''
    if (name === 'Location') {
      // Manifest refreshes resolve against the original document, not media BaseURL.
      const url = register(httpUrl(node.children.join('').trim(), base).href, 'application/dash+xml')
      return `<${node.name}${renderAttributes(node, [base])}>${escapeXml(url)}</${node.name}>`
    }
    const bases = node.children.filter(child => typeof child !== 'string' && child.name.split(':').at(-1) === 'BaseURL')
    const effectiveBases = bases.length ? resolveUrls(bases.map(child => child.children.join('').trim()), inheritedBases) : inheritedBases
    const attributes = renderAttributes(node, effectiveBases, inheritedBases)
    const children = node.children.map(child => {
      if (bases.includes(child)) {
        return `<${child.name}${renderAttributes(child, inheritedBases)}>${escapeXml(registerUrls(resolveUrls([child.children.join('').trim()], inheritedBases)))}</${child.name}>`
      }
      return render(child, effectiveBases)
    }).join('')
    return `<${node.name}${attributes}>${children}</${node.name}>`
  }
  return root.children.map(node => render(node, dashContext?.bases ?? [base])).join('')
}

export function rewriteCastHls(text, base, register, parentVariables = {}) {
  if (text.length > MAX_MANIFEST_SIZE || !text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid Cast HLS manifest')
  const variables = new Map()
  let variableSnapshot = {}
  let nextIsPlaylist = false
  function substitute(value) {
    return value.replaceAll(/\{\$([a-zA-Z0-9_-]+)\}/g, (_, name) => {
      if (!variables.has(name)) throw new Error('Undefined HLS variable')
      return variables.get(name)
    })
  }
  function resource(value, playlist = false) {
    // Resolve variables before URL parsing; keep the receiver on exact resources.
    return register(httpUrl(value, base).href, playlist ? 'application/x-mpegurl' : undefined, variableSnapshot)
  }
  return text.split('\n').map(line => {
    if (line.startsWith('#EXT-X-DEFINE:')) {
      const attributes = Object.fromEntries([...line.matchAll(/([A-Z]+)="([^"]*)"/g)].map(([, name, value]) => [name, substitute(value)]))
      const definitions = ['NAME', 'IMPORT', 'QUERYPARAM'].filter(name => Object.hasOwn(attributes, name))
      if (definitions.length !== 1) throw new Error('Invalid HLS variable definition')
      const name = attributes[definitions[0]]
      let value
      if (definitions[0] === 'NAME') value = attributes.VALUE
      else if (definitions[0] === 'IMPORT') value = Object.hasOwn(parentVariables, name) ? parentVariables[name] : undefined
      else value = new URL(base).searchParams.get(name) ?? undefined
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || variables.has(name) || value === undefined || /["\r\n]/.test(value)) {
        throw new Error('Invalid HLS variable definition')
      }
      variables.set(name, value)
      variableSnapshot = Object.fromEntries(variables)
      // Definitions, imports and query parameters have already been consumed.
      return ''
    }
    if (line.trim() && !line.startsWith('#')) {
      const result = resource(substitute(line.trim()), nextIsPlaylist)
      nextIsPlaylist = false
      return result
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) nextIsPlaylist = true
    const playlist = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line)
    return line.replaceAll(/"([^"\r\n]*)"/g, (_, value) => `"${substitute(value)}"`)
      .replaceAll(/URI="([^"]+)"/g, (_, url) => `URI="${resource(url, playlist)}"`)
  }).join('\n')
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
  const graceMs = Math.max(HLS_RESOURCE_GRACE_MS, (duration + longest) * 1000, target * 3000)
  if (!Number.isFinite(graceMs)) throw new Error('Invalid Cast HLS duration')
  return graceMs
}

/** A session-scoped endpoint; only registered resources are fetchable. */
export function createCastMediaServer(source, deviceAddress, token, getHeaders = () => ({}), isAllowedUrl = () => false, fetchMedia = fetch) {
  const resources = new Map()
  const resourceIds = new Map()
  let nextResourceId = 0
  let origin
  function collectExpiredResources() {
    // Follow session roots and active requests. Rendition-report cycles also
    // become unreachable when their parent playlist drops them.
    const reachable = new Set()
    const pending = [...resources.values()].filter(resource => resource.persistent || resource.active).map(resource => resource.id)
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
      if (value.startsWith('data:')) {
        const supported = /^data:application\/dash\+xml(?:;charset=UTF-8)?,/i.test(value) ||
          (contentType === 'text/vtt' && /^data:text\/vtt;charset=utf-8,/i.test(value))
        const limit = contentType === 'text/vtt' ? MAX_CAST_SUBTITLE_BYTES : MAX_MANIFEST_SIZE
        if (!supported || value.length > limit * 3 + 64) {
          throw new Error('Unsupported Cast data URL')
        }
      } else httpUrl(value)
      const template = !hlsVariables && !dashContext && !value.startsWith('data:') && value.includes('$')
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
        graceMs: HLS_RESOURCE_GRACE_MS,
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
      'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges',
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
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      let data
      let contentType = resource.contentType
      let upstream
      let url
      let manifest = false
      if (resource.urls[0].startsWith('data:')) {
        if (match[2] !== 'media') throw new Error('Invalid Cast resource path')
        data = decodeURIComponent(resource.urls[0].slice(resource.urls[0].indexOf(',') + 1))
        const limit = contentType === 'text/vtt' ? MAX_CAST_SUBTITLE_BYTES : MAX_MANIFEST_SIZE
        if (Buffer.byteLength(data) > limit) throw new Error('Cast data is too large')
        contentType ??= 'application/dash+xml'
      } else {
        for (const [index, candidate] of resource.urls.entries()) {
          const attempt = new AbortController()
          const signal = AbortSignal.any([controller.signal, attempt.signal])
          const attemptTimeout = resource.urls.length > 1 ? setTimeout(() => attempt.abort(), 5000) : null
          try {
            url = httpUrl(candidate)
            if (url.pathname.endsWith('/')) {
              const next = httpUrl(match[2], url)
              if (next.origin !== url.origin || !next.pathname.startsWith(url.pathname) || /%2e|%2f|%5c|%25/i.test(next.pathname)) throw new Error('Invalid Cast resource path')
              url = next
            } else if (match[2] !== 'media') throw new Error('Invalid Cast resource path')
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
      if (data !== undefined) {
        const references = new Set()
        const hls = contentType !== 'text/vtt' && contentType !== 'application/dash+xml'
        if (hls) collectExpiredResources()
        const rewritten = contentType === 'text/vtt'
          ? data
          : contentType === 'application/dash+xml'
            ? rewriteCastDash(data, url?.href, register, resource.dashContext)
            : rewriteCastHls(data, url.href, (value, type, variables) => register(value, type, variables, undefined, references), resource.hlsVariables)
        if (hls) {
          const graceMs = hlsResourceGrace(data)
          for (const id of references) {
            const child = resources.get(id)
            child.graceMs = Math.max(child.graceMs, graceMs)
          }
          resource.references = references
          collectExpiredResources()
        }
        response.writeHead(200, { ...cors, 'content-type': contentType, 'content-length': Buffer.byteLength(rewritten) })
        response.end(request.method === 'HEAD' ? undefined : rewritten)
        return
      }
      const headers = { ...cors, 'content-type': contentType ?? 'application/octet-stream' }
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
    setOrigin(value) { origin = value },
    register,
    mediaUrl() { return register(source.url, source.contentType) }
  }
}
