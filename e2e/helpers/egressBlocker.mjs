import { once } from 'node:events'
import { createServer } from 'node:http'

/**
 * A proxy that refuses every request, which offline tests hand to the app
 * through the proxy environment variables. Playwright routes only intercept
 * renderer requests. This also stops the ones they miss from reaching real
 * hosts: `net.fetch` and `net.request` in the main process, which follow
 * Chromium's system proxy settings (read from these variables on Linux), and
 * child processes such as yt-dlp.
 */

/** @type {Promise<string> | undefined} */
let proxyUrl
/** @type {string[]} */
const blockedRequests = []

function startProxy() {
  const server = createServer((request, response) => {
    // Plain HTTP requests carry the absolute URL.
    blockedRequests.push(`${request.method} ${request.url}`)
    response.writeHead(403).end()
  })
  server.on('connect', (request, socket) => {
    blockedRequests.push(`CONNECT ${request.url}`)
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  server.listen(0, '127.0.0.1')
  // Keeps no worker alive after its last test.
  server.unref()
  return once(server, 'listening').then(() => `http://127.0.0.1:${server.address().port}`)
}

/**
 * @param {string[]} bypassHosts host patterns such as `*.example.test` that
 * `--host-resolver-rules` maps to local servers
 * @returns {Promise<Record<string, string>>}
 */
export async function egressBlockerEnv(bypassHosts) {
  proxyUrl ??= startProxy()
  const url = await proxyUrl
  // Chromium also bypasses loopback hosts implicitly. Child processes do not.
  const noProxy = ['localhost', '.localhost', '127.0.0.1', '::1', ...bypassHosts.map(host => host.replace(/^\*/, ''))].join(',')
  return {
    http_proxy: url,
    https_proxy: url,
    no_proxy: noProxy,
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    NO_PROXY: noProxy
  }
}

/** Returns and forgets the requests refused since the last call. */
export function takeBlockedRequests() {
  return blockedRequests.splice(0)
}
