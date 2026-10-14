import http, { createServer } from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { fetchCastMedia } from './castMediaServer.js'

/** `resolveAddresses` validates every hop, like the Cast relay, so redirects cannot reach private hosts. */
export function createMediaServer(mediaUrl, deviceAddress, token, upstreamHeaders = {}, resolveAddresses = async () => null) {
  return createServer(async (request, response) => {
    if (
      request.url !== `/${token}/video.mp4` ||
      !['GET', 'HEAD'].includes(request.method) ||
      request.socket.remoteAddress?.replace(/^::ffff:/, '') !== deviceAddress
    ) {
      response.writeHead(404).end()
      return
    }
    try {
      const controller = new AbortController()
      response.on('close', () => controller.abort())
      const timeout = setTimeout(() => controller.abort(), 10_000)
      const headers = new Headers(upstreamHeaders)
      if (request.headers.range) headers.set('Range', request.headers.range)
      let upstream
      let url = new URL(mediaUrl)
      try {
        for (let redirects = 0; ; redirects++) {
          const addresses = await resolveAddresses(url)
          if (!addresses) throw new Error('Media address is not allowed')
          upstream = await fetchCastMedia(url.protocol === 'https:' ? https : http, url, {
            method: request.method,
            headers,
            signal: controller.signal,
            addresses
          })
          const location = upstream.headers.get('location')
          if (![301, 302, 303, 307, 308].includes(upstream.status) || !location) break
          if (redirects >= 5) throw new Error('Too many media redirects')
          const nextUrl = new URL(location, url)
          if (!['http:', 'https:'].includes(nextUrl.protocol)) throw new Error('Unsupported media redirect')
          if (nextUrl.origin !== url.origin) {
            for (const name of ['Authorization', 'Cookie', 'Host', 'Proxy-Authorization', 'Origin', 'Referer']) headers.delete(name)
          }
          await upstream.body?.cancel()
          url = nextUrl
        }
      } finally {
        clearTimeout(timeout)
      }
      const responseHeaders = { 'content-type': 'video/mp4', 'transfermode.dlna.org': 'Streaming' }
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name)
        if (value) responseHeaders[name] = value
      }
      response.writeHead(upstream.status, responseHeaders)
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel()
        response.end()
        return
      }
      const stream = Readable.fromWeb(upstream.body)
      response.on('close', () => stream.destroy())
      stream.on('error', () => response.destroy()).pipe(response)
    } catch {
      if (!response.headersSent) response.writeHead(502).end()
      else response.destroy()
    }
  })
}
