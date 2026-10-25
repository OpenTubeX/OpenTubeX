/** Cookies acquired while extracting external media stay in memory. */
const externalStreamCookies = new WeakMap()
const externalStreamHeaders = new WeakMap()
const externalStoryboardHeaders = new WeakMap()
const externalManifestHeaders = new WeakMap()
const MAX_STORYBOARD_HEADER_URLS = 50_000
const EXTERNAL_STREAM_HEADER_NAMES = new Set([
  'accept', 'accept-language', 'origin', 'referer', 'sec-fetch-mode', 'user-agent'
])

export function registerExternalStreamHeaders(webContents, formats) {
  const existing = externalStreamHeaders.get(webContents) ?? new Map()
  const storyboards = externalStoryboardHeaders.get(webContents) ?? new Map()
  const manifestScopes = externalManifestHeaders.get(webContents) ?? new Map()
  for (const format of formats) {
    const headers = Object.fromEntries(Object.entries(format.http_headers ?? {})
      .filter(([name, value]) => EXTERNAL_STREAM_HEADER_NAMES.has(name.toLowerCase()) &&
        typeof value === 'string' && !/[\r\n]/.test(value)))
    if (Object.keys(headers).length === 0 && format.protocol !== 'mhtml') continue
    const fragmentUrls = format.protocol === 'mhtml' && Array.isArray(format.fragments)
      ? format.fragments.map(fragment => fragment.url)
      : []
    for (const candidate of [format.url, format.manifest_url, ...fragmentUrls]) {
      if (typeof candidate !== 'string' || !/^https?:\/\//.test(candidate)) continue
      let streamUrl
      try { streamUrl = new URL(candidate) } catch { continue }
      const exact = format.protocol === 'mhtml' ? storyboards : existing
      exact.delete(candidate)
      exact.set(candidate, headers)
      if (exact.size > (format.protocol === 'mhtml' ? MAX_STORYBOARD_HEADER_URLS : 256)) {
        exact.delete(exact.keys().next().value)
      }

      if (['m3u8', 'm3u8_native', 'dash', 'http_dash_segments'].includes(format.protocol)) {
        const scope = `${streamUrl.origin}${new URL('.', streamUrl).pathname}`
        manifestScopes.delete(scope)
        manifestScopes.set(scope, headers)
        if (manifestScopes.size > 256) manifestScopes.delete(manifestScopes.keys().next().value)
      }
    }
  }
  externalStreamHeaders.set(webContents, existing)
  externalStoryboardHeaders.set(webContents, storyboards)
  externalManifestHeaders.set(webContents, manifestScopes)
}

export function getYtDlpExternalStreamHeaders(webContents, requestUrl) {
  const exact = externalStreamHeaders.get(webContents)?.get(requestUrl) ??
    externalStoryboardHeaders.get(webContents)?.get(requestUrl)
  if (exact) return exact

  const scopes = externalManifestHeaders.get(webContents)
  if (!scopes?.size) return null
  // This runs for every media request, so match scopes (origin + directory) as strings.
  const request = new URL(requestUrl)
  const location = request.origin + request.pathname
  let match = null
  for (const [scope, headers] of scopes) {
    // The most recently registered scope wins.
    if (location.startsWith(scope)) match = headers
  }
  return match
}

export function isYtDlpStoryboardUrl(webContents, requestUrl) {
  return externalStoryboardHeaders.get(webContents)?.has(requestUrl) ?? false
}

export function isYtDlpHttpStoryboardUrl(webContents, requestUrl) {
  return requestUrl.startsWith('http:') && isYtDlpStoryboardUrl(webContents, requestUrl)
}

export function registerExternalStreamCookies(webContents, formats, cookieFileContents) {
  const hosts = new Set(formats.flatMap(format => [
    format.url,
    format.manifest_url,
    ...(format.protocol === 'mhtml' && Array.isArray(format.fragments)
      ? format.fragments.map(fragment => fragment.url)
      : [])
  ])
    .filter(url => typeof url === 'string')
    .map(url => {
      try {
        const parsed = new URL(url)
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname : null
      } catch { return null }
    }).filter(Boolean))
  if (hosts.size === 0) return

  const cookieFileEntries = cookieFileContents.split(/\r?\n/).flatMap(line => {
    const fields = line.replace(/^#HttpOnly_/, '').split('\t')
    if (fields.length !== 7 || fields[0].startsWith('#')) return []
    const [domain, includeSubdomains, path, secure, expires, name, value] = fields
    const cookieDomain = domain.replace(/^\./, '').toLowerCase()
    if (!['TRUE', 'FALSE'].includes(includeSubdomains)) return []
    if (![...hosts].some(host => host === cookieDomain || (includeSubdomains === 'TRUE' && host.endsWith(`.${cookieDomain}`)))) return []
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !value ||
      !/^[\x20-\x7e]+$/.test(value) || value.includes(';')) return []
    return [{
      domain: cookieDomain,
      includeSubdomains: includeSubdomains === 'TRUE',
      path,
      secure: secure === 'TRUE',
      expires: Math.min(Number(expires) || Infinity, Date.now() / 1000 + 3600),
      name,
      value
    }]
  })

  // yt-dlp scopes each format's cookies to its URL. Use those in browser-cookie
  // mode so the browser's entire cookie jar never needs to be written to disk.
  const formatEntries = cookieFileContents === ''
    ? formats.flatMap(format => {
        if (typeof format.cookies !== 'string' || typeof format.url !== 'string') return []
        let url
        try { url = new URL(format.url) } catch { return [] }
        if (!['http:', 'https:'].includes(url.protocol)) return []
        const entries = []
        let cookie = null
        for (const part of format.cookies.split('; ')) {
          const separator = part.indexOf('=')
          const name = separator === -1 ? part : part.slice(0, separator)
          const rawValue = separator === -1 ? '' : part.slice(separator + 1)
          // Python's cookie serializer quotes values containing characters such
          // as '=' and can escape characters with three-digit octal sequences.
          const value = rawValue.startsWith('"') && rawValue.endsWith('"')
            ? rawValue.slice(1, -1).replaceAll(/\\(?:([0-3][0-7]{2})|([\s\S]))/g,
                (_match, octal, character) => octal ? String.fromCharCode(parseInt(octal, 8)) : character)
            : rawValue
          // Decode only RFC 6265 cookie octets; retain Python's wire encoding
          // when the value needs quotes or escapes to be parsed correctly.
          const cookieValue = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(value) ? value : rawValue
          if (name === 'Domain' || name === 'Path' || name === 'Expires' || name === 'Secure' || name === 'Version') {
            if (cookie === null) continue
            const domain = value.replace(/^\./, '').toLowerCase()
            if (name === 'Domain' && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) {
              entries.pop()
              cookie = null
            } else if (name === 'Path' && value.startsWith('/')) cookie.path = value
            else if (name === 'Expires') cookie.expires = Math.min(Number(value) || Infinity, Date.now() / 1000 + 3600)
            else if (name === 'Secure') cookie.secure = true
          } else if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && cookieValue &&
            /^[\x20-\x7e]+$/.test(cookieValue) && !cookieValue.includes(';')) {
            cookie = {
              domain: url.hostname,
              includeSubdomains: false,
              path: '/',
              secure: false,
              expires: Date.now() / 1000 + 3600,
              name,
              value: cookieValue
            }
            entries.push(cookie)
          }
        }
        return entries
      })
    : []
  const cookieEntries = [...cookieFileEntries, ...formatEntries]
  const existing = externalStreamCookies.get(webContents) ?? new Map()
  for (const host of hosts) {
    // Filter before deduplicating so a host-only cookie cannot replace a
    // subdomain-inclusive cookie needed by a different stream host.
    const cookies = [...new Map(cookieEntries
      .filter(cookie => host === cookie.domain ||
        (cookie.includeSubdomains && host.endsWith(`.${cookie.domain}`)))
      .map(cookie => [JSON.stringify([cookie.domain, cookie.path, cookie.name]), cookie])
    ).values()]
    existing.set(host, cookies)
  }
  externalStreamCookies.set(webContents, existing)
}

export function getYtDlpExternalStreamCookieHeader(webContents, requestUrl) {
  if (isYtDlpHttpStoryboardUrl(webContents, requestUrl)) return null
  const url = new URL(requestUrl)
  const cookies = externalStreamCookies.get(webContents)?.get(url.hostname)
  if (!cookies) return null
  const now = Date.now() / 1000
  const matching = cookies.filter(cookie =>
    now < cookie.expires &&
    (url.hostname === cookie.domain || (cookie.includeSubdomains && url.hostname.endsWith(`.${cookie.domain}`))) &&
    (url.pathname === cookie.path ||
      url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`)) &&
    (!cookie.secure || url.protocol === 'https:')
  )
  return matching.length > 0 ? matching.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') : null
}
