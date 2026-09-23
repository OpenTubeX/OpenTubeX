/**
 * Resolve a creator image from yt-dlp metadata or a public creator profile.
 * Only known first-party endpoints are requested; arbitrary extractor URLs
 * must not become main-process network requests.
 * @param {Record<string, unknown>} info
 * @param {(url: string, options: RequestInit) => Promise<Response>} fetchPage
 * @returns {Promise<string | null>}
 */
export async function resolveYtDlpCreatorAvatarUrl(info, fetchPage) {
  const httpsUrl = value => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' ? url.href : null
    } catch {
      return null
    }
  }

  const supplied = httpsUrl(info.channel_thumbnail) ?? httpsUrl(info.channel_avatar) ??
    httpsUrl(info.uploader_thumbnail) ?? httpsUrl(info.uploader_avatar)
  if (supplied) return supplied

  let pageUrl
  try {
    pageUrl = new URL(info.webpage_url)
  } catch {
    return null
  }
  if (pageUrl.protocol !== 'https:') return null

  let profileUrl = null
  let source = null
  const uploaderUrl = httpsUrl(info.uploader_url)
  if (['soundcloud.com', 'www.soundcloud.com'].includes(pageUrl.hostname) && uploaderUrl) {
    const url = new URL(uploaderUrl)
    if (['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) {
      profileUrl = url.href
      source = 'soundcloud'
    }
  } else if (['tiktok.com', 'www.tiktok.com'].includes(pageUrl.hostname) && uploaderUrl) {
    const url = new URL(uploaderUrl)
    if (['tiktok.com', 'www.tiktok.com'].includes(url.hostname)) {
      profileUrl = url.href
      source = 'tiktok'
    }
  } else if (pageUrl.hostname === 'clips.twitch.tv' && /^[a-zA-Z0-9_]+$/.test(info.channel ?? '')) {
    profileUrl = `https://www.twitch.tv/${info.channel}`
    source = 'twitch'
  } else if (['dailymotion.com', 'www.dailymotion.com'].includes(pageUrl.hostname) && /^[a-zA-Z0-9]+$/.test(info.uploader_id ?? '')) {
    profileUrl = `https://api.dailymotion.com/user/${info.uploader_id}?fields=avatar_360_url`
    source = 'dailymotion'
  }
  if (!profileUrl) return null

  try {
    const response = await fetchPage(profileUrl, {
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(3000)
    })
    if (!response.ok || Number(response.headers.get('content-length')) > 1_000_000) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes(source === 'dailymotion' ? 'application/json' : 'text/html')) return null
    const body = await response.text()
    if (body.length > 1_000_000) return null

    if (source === 'dailymotion') {
      return httpsUrl(JSON.parse(body).avatar_360_url)
    }
    if (source === 'tiktok') {
      const script = body.match(/<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
      const avatar = script?.match(/"avatarThumb":"((?:\\.|[^"\\])*)"/)?.[1]
      return avatar ? httpsUrl(JSON.parse(`"${avatar}"`)) : null
    }

    const imageMeta = [...body.matchAll(/<meta\b[^>]*>/gi)].find(([tag]) =>
      /\b(?:property|name)=["']og:image["']/i.test(tag))?.[0]
    const imageUrl = httpsUrl(imageMeta?.match(/\bcontent=["']([^"']+)/i)?.[1]?.replaceAll('&amp;', '&'))
    if (source === 'soundcloud' && !imageUrl?.includes('/avatars-')) return null
    if (source === 'twitch' && !imageUrl?.includes('profile_image')) return null
    return imageUrl
  } catch {
    return null
  }
}
