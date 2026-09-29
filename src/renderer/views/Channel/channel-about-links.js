function externalUrl(endpoint) {
  const rawUrl = endpoint?.toURL()
  if (!rawUrl) return null

  try {
    let url = new URL(rawUrl)
    if (['youtube.com', 'www.youtube.com'].includes(url.hostname) && url.pathname === '/redirect') {
      url = new URL(url.searchParams.get('q'))
    }

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function proxiedFaviconUrl(icons) {
  const rawUrl = (icons.find(icon => icon.width >= 32) ?? icons.at(-1))?.url
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' ||
        !/^encrypted-tbn\d+\.gstatic\.com$/.test(url.hostname) ||
        url.pathname !== '/favicon-tbn') return null
    return url.href
  } catch {
    return null
  }
}

export function getChannelAboutLinks(about) {
  const links = about.primary_links ?? about.metadata?.links ?? []

  return links.flatMap(link => {
    const url = externalUrl(link.endpoint ?? link.link?.endpoint)
    const title = link.title?.text
    const iconUrl = proxiedFaviconUrl(link.icon ?? link.favicon ?? [])
    return url && title ? [{ title, url, iconUrl }] : []
  })
}
