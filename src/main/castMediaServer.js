import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { Readable, pipeline } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import sax from 'sax'
import { isNonPublicNetworkAddress } from './utils.js'

const MAX_MANIFEST_SIZE = 2_000_000
export const MAX_CAST_SUBTITLE_BYTES = 8 * 1024 * 1024
const MAX_RESOURCES = 65_536
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
export function rewriteCastDash(xml, base, register) {
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
  if (root.children.find(node => typeof node !== 'string')?.name.split(':').at(-1) !== 'MPD') {
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
  function renderAttributes(node, bases) {
    const element = node.name.split(':').at(-1)
    return Object.entries(node.attributes).map(([name, value]) => {
      const attribute = name.split(':').at(-1)
      if (['media', 'initialization', 'sourceURL', 'href'].includes(attribute) ||
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
    if (['Location', 'PatchLocation'].includes(name)) {
      // Manifest refreshes resolve against the original document, not media BaseURL.
      const url = register(httpUrl(node.children.join('').trim(), base).href,
        name === 'Location' ? 'application/dash+xml' : 'application/dash-patch+xml')
      return `<${node.name}${renderAttributes(node, [base])}>${escapeXml(url)}</${node.name}>`
    }
    const bases = node.children.filter(child => typeof child !== 'string' && child.name.split(':').at(-1) === 'BaseURL')
    const effectiveBases = bases.length ? resolveUrls(bases.map(child => child.children.join('').trim()), inheritedBases) : inheritedBases
    const attributes = renderAttributes(node, effectiveBases)
    const children = node.children.map(child => {
      if (bases.includes(child)) {
        return `<${child.name}${renderAttributes(child, inheritedBases)}>${escapeXml(registerUrls(resolveUrls([child.children.join('').trim()], inheritedBases)))}</${child.name}>`
      }
      return render(child, effectiveBases)
    }).join('')
    return `<${node.name}${attributes}>${children}</${node.name}>`
  }
  return root.children.map(node => render(node, [base])).join('')
}

export function rewriteCastHls(text, base, register) {
  if (text.length > MAX_MANIFEST_SIZE || !text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid Cast HLS manifest')
  return text.split('\n').map(line => {
    if (line.trim() && !line.startsWith('#')) return register(httpUrl(line.trim(), base).href)
    return line.replaceAll(/URI="([^"]+)"/g, (_, url) => `URI="${register(httpUrl(url, base).href)}"`)
  }).join('\n')
}

/** A session-scoped endpoint; only registered resources are fetchable. */
export function createCastMediaServer(source, deviceAddress, token, getHeaders = () => ({}), isAllowedUrl = () => false, fetchMedia = fetch) {
  const resources = []
  const resourceIds = new Map()
  let origin
  function register(value, contentType) {
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
      const template = !value.startsWith('data:') && value.includes('$')
      const url = template ? httpUrl(value) : null
      const firstPlaceholder = url?.pathname.indexOf('$') ?? -1
      const directoryEnd = url ? url.pathname.lastIndexOf('/', firstPlaceholder < 0 ? url.pathname.length : firstPlaceholder) + 1 : 0
      return {
        url: template ? new URL(url.pathname.slice(0, directoryEnd), url).href : value,
        suffix: template ? url.pathname.slice(directoryEnd) + url.search : value.endsWith('/') ? '' : 'media'
      }
    })
    const key = JSON.stringify(candidates)
    let id = resourceIds.get(key)
    if (id === undefined) {
      if (resources.length >= MAX_RESOURCES) throw new Error('Too many Cast resources')
      id = resources.length
      resourceIds.set(key, id)
      resources.push({ urls: candidates.map(candidate => candidate.url), contentType })
    }
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
    const resource = resources[Number(match[1])]
    if (!resource) { response.writeHead(404).end(); return }
    if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return }
    const controller = new AbortController()
    response.on('close', () => controller.abort())
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
        const rewritten = contentType === 'text/vtt'
          ? data
          : contentType === 'application/dash+xml'
            ? rewriteCastDash(data, url?.href, register)
            : rewriteCastHls(data, url.href, register)
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
