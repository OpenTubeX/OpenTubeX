import { applySyncServerUserAgent } from '../syncServerUserAgent.js'
import { applyTwitchPlaylistOrigin } from '../twitchPlaylistOrigin.js'
import { extractExpiryTimestamp, ImageCache } from './ImageCache.js'
import { RendererCors } from './rendererCors.js'
import { appendYouTubeTimeZonePreference, isOpenTubeXUrl } from './utils.js'

/**
 * Install the request rules used by the renderer and the optional in-memory
 * image cache. Electron objects and account/stream lookups are passed in by
 * the application after their owners have initialized.
 */
export function configureRequestNetworking({
  session,
  protocol,
  net,
  productName,
  replaceHttpCache,
  invidiousAuthorizations,
  getExternalStreamHeaders,
  getExternalStreamCookieHeader,
  isStoryboardUrl,
  imageCache = replaceHttpCache ? new ImageCache() : null
}) {
  const fixedUserAgent = session.getUserAgent()
    .split(' ')
    .filter(part => !part.includes('Electron') && !part.includes(productName))
    .join(' ')
  session.setUserAgent(fixedUserAgent)

  for (const url of ['https://www.youtube.com', 'https://youtube.com']) {
    session.cookies.set({ url, name: 'CONSENT', value: 'YES+', sameSite: 'no_restriction' })
  }
  session.cookies.set({
    url: 'https://www.youtube.com',
    name: 'SOCS',
    value: 'CAI',
    sameSite: 'no_restriction'
  })

  const rendererCors = new RendererCors()
  const storyboardRequestIds = new Set()
  session.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'http://*/*'], types: ['xhr', 'media', 'image'] }, (details, callback) => {
    // Capture the app's original Origin before the YouTube header adjustments.
    const originalOrigin = new Headers(details.requestHeaders).get('Origin')
    let { requestHeaders } = details
    const { url, webContents } = details
    const urlObj = new URL(url)

    if (webContents && isOpenTubeXUrl(webContents.getURL())) {
      applySyncServerUserAgent(requestHeaders)
    }

    if (url.startsWith('https://www.youtube.com/youtubei/')) {
      requestHeaders.Referer = 'https://www.youtube.com/'
      requestHeaders.Origin = 'https://www.youtube.com'
      requestHeaders['Sec-Fetch-Site'] = 'same-origin'
      requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
      requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
    } else if (
      url.startsWith('https://www.youtube.com/watch') ||
      (urlObj.hostname === 'www.youtube.com' && urlObj.pathname === '/')
    ) {
      delete requestHeaders.Referer
      delete requestHeaders.Origin
      requestHeaders['Sec-Fetch-Dest'] = 'document'
      requestHeaders['Sec-Fetch-Mode'] = 'navigate'
      requestHeaders['Sec-Fetch-Site'] = 'none'
      requestHeaders['Sec-Fetch-User'] = '?1'
      requestHeaders.Cookie = appendYouTubeTimeZonePreference(
        requestHeaders.Cookie,
        Intl.DateTimeFormat().resolvedOptions().timeZone
      )
    } else if (url === 'https://www.youtube.com/sw.js_data' || url.startsWith('https://www.youtube.com/api/timedtext')) {
      requestHeaders.Referer = 'https://www.youtube.com/sw.js'
      requestHeaders['Sec-Fetch-Site'] = 'same-origin'
      requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
    } else if (
      urlObj.origin.endsWith('.googleusercontent.com') ||
      urlObj.origin.endsWith('.ggpht.com') ||
      urlObj.origin.endsWith('.ytimg.com')
    ) {
      requestHeaders.Referer = 'https://www.youtube.com/'
      requestHeaders.Origin = 'https://www.youtube.com'
    } else if (urlObj.origin.endsWith('.googlevideo.com') && urlObj.pathname === '/videoplayback') {
      requestHeaders.Referer = 'https://www.youtube.com/'
      requestHeaders.Origin = 'https://www.youtube.com'
      delete requestHeaders['Content-Type']
    } else if (urlObj.origin === 'https://ipwho.is') {
      requestHeaders = {}
    } else if (webContents) {
      const authorization = invidiousAuthorizations.getForRequest(webContents.id, url)
      if (authorization) requestHeaders.Authorization = authorization
    }

    if (webContents && isOpenTubeXUrl(webContents.getURL())) {
      Object.assign(requestHeaders, getExternalStreamHeaders(webContents, url))
      applyTwitchPlaylistOrigin(urlObj, requestHeaders)
      if (isStoryboardUrl(webContents, url)) storyboardRequestIds.add(details.id)
      if (url.startsWith('http:') && storyboardRequestIds.has(details.id)) {
        for (const name of Object.keys(requestHeaders)) {
          if (name.toLowerCase() === 'cookie') delete requestHeaders[name]
        }
      } else {
        const streamCookies = getExternalStreamCookieHeader(webContents, url)
        if (streamCookies !== null) {
          const names = new Set(streamCookies.split('; ').map(cookie => cookie.split('=')[0]))
          const existing = (requestHeaders.Cookie ?? '').split('; ')
            .filter(cookie => cookie && !names.has(cookie.split('=')[0]))
          requestHeaders.Cookie = [...existing, streamCookies].join('; ')
        }
      }
    }

    rendererCors.rememberRequest({ ...details, requestHeaders }, originalOrigin)
    // eslint-disable-next-line n/no-callback-literal
    callback({ requestHeaders })
  })

  const httpRequestFilter = { urls: ['https://*/*', 'http://*/*'] }
  session.webRequest.onHeadersReceived(httpRequestFilter, (details, callback) => {
    const { url, responseHeaders } = details
    if (responseHeaders && (
      url === 'https://www.youtube.com/sw.js_data' ||
      url === 'https://www.youtube.com/iframe_api' ||
      url.startsWith('https://www.youtube.com/watch?')
    )) {
      delete responseHeaders['set-cookie']
      delete responseHeaders['content-security-policy']
      delete responseHeaders['cross-origin-opener-policy']
      delete responseHeaders['report-to']
      delete responseHeaders['reporting-endpoints']
    }

    // eslint-disable-next-line n/no-callback-literal
    callback({ responseHeaders, ...rendererCors.allowResponse(details) })
  })
  session.webRequest.onCompleted(httpRequestFilter, details => {
    rendererCors.forgetRequest(details)
    storyboardRequestIds.delete(details.id)
  })
  session.webRequest.onErrorOccurred(httpRequestFilter, details => {
    rendererCors.forgetRequest(details)
    storyboardRequestIds.delete(details.id)
  })

  if (replaceHttpCache) {
    protocol.handle('imagecache', request => {
      const [requestUrl, rawWebContentsId] = request.url.split('#')
      return new Promise((resolve, reject) => {
        const url = decodeURIComponent(requestUrl.substring(13))
        if (imageCache.has(url)) {
          const cached = imageCache.get(url)
          resolve(new Response(cached.data, { headers: { 'content-type': cached.mimeType } }))
          return
        }

        let headers
        if (rawWebContentsId) {
          const authorization = invidiousAuthorizations.getForRequest(parseInt(rawWebContentsId), url)
          if (authorization) headers = { Authorization: authorization }
        }

        const newRequest = net.request({ method: request.method, url, headers })
        // Electron rejects some headers. Origin and Referrer are also excluded
        // so image fetches do not disclose the renderer origin to YouTube.
        const blacklistedHeaders = ['content-length', 'host', 'trailer', 'te', 'upgrade', 'cookie2', 'keep-alive', 'transfer-encoding', 'origin', 'referrer']
        for (const header of Object.keys(request.headers)) {
          if (!blacklistedHeaders.includes(header.toLowerCase())) {
            newRequest.setHeader(header, request.headers[header])
          }
        }

        newRequest.on('response', response => {
          const chunks = []
          response.on('data', chunk => { chunks.push(chunk) })
          response.on('end', () => {
            const data = Buffer.concat(chunks)
            const expiryTimestamp = extractExpiryTimestamp(response.headers)
            const mimeType = response.headers['content-type']
            imageCache.add(url, mimeType, data, expiryTimestamp)
            resolve(new Response(data, { headers: { 'content-type': mimeType } }))
          })
          response.on('error', error => {
            console.error('image cache error', error)
            reject(error)
          })
        })
        newRequest.on('error', err => { console.error(err) })
        newRequest.end()
      })
    })

    session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'], types: ['image'] }, (details, callback) => {
      let redirectURL = `imagecache://${encodeURIComponent(details.url)}`
      if (details.webContents) redirectURL += `#${details.webContents.id}`
      // eslint-disable-next-line n/no-callback-literal
      callback({ redirectURL })
    })
  }
}
