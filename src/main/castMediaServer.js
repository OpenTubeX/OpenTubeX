import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import sax from 'sax'

const MAX_MANIFEST_SIZE = 2_000_000
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Chromium networking with manual redirects and explicitly scoped credentials. */
export function fetchCastMedia(network, url, { method, headers, signal }) {
  return new Promise((resolve, reject) => {
    const request = network.request({ url, method, redirect: 'manual', credentials: 'omit' })
    for (const [name, value] of headers) request.setHeader(name, value)
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { request.abort(); reject(signal.reason) }
    request.on('error', error => { cleanup(); reject(error) })
    request.on('redirect', (status, _method, location) => {
      cleanup()
      resolve(new Response(null, { status, headers: { location } }))
      request.abort()
    })
    request.on('response', incoming => {
      incoming.once('close', cleanup)
      incoming.once('end', cleanup)
      incoming.once('error', error => { cleanup(); reject(error) })
      try {
        const body = method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode)
          ? null
          : Readable.toWeb(incoming)
        if (body === null) incoming.resume()
        resolve(new Response(body, { status: incoming.statusCode, headers: incoming.headers }))
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
  function render(node, inheritedBase) {
    if (typeof node === 'string') return escapeXml(node)
    const bases = node.children.filter(child => typeof child !== 'string' && child.name.split(':').at(-1) === 'BaseURL')
    const effectiveBase = bases.length ? httpUrl(bases[0].children.join('').trim(), inheritedBase).href : inheritedBase
    const attributes = Object.entries(node.attributes).map(([name, value]) => {
      if (['media', 'initialization', 'sourceURL', 'href'].includes(name.split(':').at(-1))) {
        value = register(httpUrl(value, effectiveBase).href)
      }
      return ` ${name}="${escapeXml(value)}"`
    }).join('')
    const children = node.children.map(child => {
      if (bases.includes(child)) {
        return `<${child.name}>${escapeXml(register(httpUrl(child.children.join('').trim(), inheritedBase).href))}</${child.name}>`
      }
      return render(child, effectiveBase)
    }).join('')
    return `<${node.name}${attributes}>${children}</${node.name}>`
  }
  return root.children.map(node => render(node, base)).join('')
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
    if (value.startsWith('data:')) {
      if (!/^data:application\/dash\+xml(?:;charset=UTF-8)?,/i.test(value) || value.length > MAX_MANIFEST_SIZE * 3) {
        throw new Error('Unsupported Cast data URL')
      }
    } else httpUrl(value)
    const template = !value.startsWith('data:') && value.includes('$')
    const url = template ? httpUrl(value) : null
    const firstPlaceholder = url?.pathname.indexOf('$') ?? -1
    const directoryEnd = url ? url.pathname.lastIndexOf('/', firstPlaceholder < 0 ? url.pathname.length : firstPlaceholder) + 1 : 0
    const resource = template ? new URL(url.pathname.slice(0, directoryEnd), url).href : value
    let id = resourceIds.get(resource)
    if (id === undefined) {
      if (resources.length >= 65_536) throw new Error('Too many Cast resources')
      id = resources.length
      resourceIds.set(resource, id)
      resources.push({ url: resource, contentType })
    }
    const suffix = template
      ? url.pathname.slice(directoryEnd) + url.search
      : value.endsWith('/') ? '' : 'media'
    return `${origin}/${token}/${id}/${suffix}`
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
      if (resource.url.startsWith('data:')) {
        if (match[2] !== 'media') throw new Error('Invalid Cast resource path')
        data = decodeURIComponent(resource.url.slice(resource.url.indexOf(',') + 1))
        contentType = 'application/dash+xml'
      } else {
        url = httpUrl(resource.url)
        if (url.pathname.endsWith('/')) {
          const next = httpUrl(match[2], url)
          if (next.origin !== url.origin || !next.pathname.startsWith(url.pathname) || /%2e|%2f|%5c|%25/i.test(next.pathname)) throw new Error('Invalid Cast resource path')
          url = next
        } else if (match[2] !== 'media') throw new Error('Invalid Cast resource path')
        for (let redirects = 0; ; redirects++) {
          if (!await isAllowedUrl(url)) throw new Error('Unsupported Cast resource destination')
          const headers = new Headers(getHeaders(url.href) ?? {})
          headers.set('Accept-Encoding', 'identity')
          if (request.headers.range) headers.set('Range', request.headers.range)
          upstream = await fetchMedia(url.href, { headers, signal: controller.signal, redirect: 'manual', method: request.method })
          const location = upstream.headers.get('location')
          if (![301, 302, 303, 307, 308].includes(upstream.status) || !location) break
          if (redirects >= 5) throw new Error('Too many Cast media redirects')
          await upstream.body?.cancel()
          url = httpUrl(location, url)
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
        const rewritten = contentType === 'application/dash+xml'
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
