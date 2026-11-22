const OUTLINE_PATTERN = /<outline\b((?:[^>"']|"[^"]*"|'[^']*')*)>|<\/outline\s*>/gi
const ATTRIBUTE_PATTERN = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXmlEntities(value) {
  return value.replaceAll(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (entity, decimal, hex, name) => {
    if (name !== undefined) {
      return NAMED_ENTITIES[name.toLowerCase()] ?? entity
    }
    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16)
    return codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity
  })
}

/**
 * Read the feeds of an OPML subscription list. Imported files are not markup for
 * the app, so this reads the outline attributes as text instead of using a DOM
 * parser. Like an HTML parser, it accepts malformed XML and ignores the case of
 * attribute names.
 * @param {string} content
 * @returns {{ xmlUrl: string, title: string | null, folders: string[] }[]} `folders`
 * names the outlines that contain the feed, outermost first, except an
 * outermost one containing every feed
 */
export function parseOpmlFeeds(content) {
  // Commented-out outlines are not subscriptions
  const markup = content.replaceAll(/<!--[\s\S]*?(?:-->|$)/g, '')
  const body = markup.search(/<body[\s>]/i)
  if (body === -1) {
    return []
  }
  const feeds = []
  /** The names of the open outlines, `null` for ones without a name */
  const openOutlines = []
  for (const [tag, attributes] of markup.slice(body).matchAll(OUTLINE_PATTERN)) {
    if (attributes === undefined) {
      openOutlines.pop()
      continue
    }
    const values = new Map()
    for (const [, name, doubleQuoted, singleQuoted] of attributes.matchAll(ATTRIBUTE_PATTERN)) {
      values.set(name.toLowerCase(), decodeXmlEntities(doubleQuoted ?? singleQuoted))
    }
    if (values.has('xmlurl')) {
      feeds.push({
        xmlUrl: values.get('xmlurl'),
        // Some apps only name feeds with the outline text
        title: values.get('title') ?? values.get('text') ?? null,
        folders: openOutlines.filter(name => name !== null),
      })
    }
    if (!tag.endsWith('/>')) {
      const name = (values.get('text') ?? values.get('title'))?.trim()
      openOutlines.push(!values.has('xmlurl') && name ? name : null)
    }
  }
  // Exports wrap all feeds in one outline, such as "YouTube Subscriptions",
  // which does not group them. Folders inside it are kept even when they hold every feed.
  const wrapper = feeds[0]?.folders[0]
  if (wrapper !== undefined && feeds.every(feed => feed.folders[0] === wrapper)) {
    for (const feed of feeds) {
      feed.folders.shift()
    }
  }
  return feeds
}

/**
 * The YouTube channel of a feed from a YouTube or Invidious subscription
 * export. Other feeds, such as podcasts, have none.
 * @param {string} xmlUrl
 * @returns {string | null}
 */
export function getOpmlYouTubeChannelId(xmlUrl) {
  let url
  try {
    url = new URL(xmlUrl)
  } catch {
    return null
  }
  const id = /^(?:www\.)?youtube\.com$/.test(url.hostname) && url.pathname === '/feeds/videos.xml'
    ? url.searchParams.get('channel_id')
    // Invidious exports, such as https://yewtu.be/feed/channel/{CHANNELID}
    : url.pathname.match(/\/feed\/channel\/([^/]+)\/?$/)?.[1]
  return id && /^UC[\w-]{22}$/.test(id) ? id : null
}

/**
 * @param {string} value
 */
function escapeXml(value) {
  return value.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Write a subscription list that other apps can import. The feeds are wrapped
 * in one outline named `title`.
 * @param {string} title
 * @param {{ xmlUrl: string, title: string }[]} feeds
 */
export function buildOpml(title, feeds) {
  const outlines = feeds.map(feed => {
    const name = escapeXml(feed.title)
    return `<outline text="${name}" title="${name}" type="rss" xmlUrl="${escapeXml(feed.xmlUrl)}"/>`
  })
  const wrapper = escapeXml(title)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="1.1"><head><title>${wrapper}</title></head><body><outline text="${wrapper}" title="${wrapper}">${outlines.join('')}</outline></body></opml>\n`
}
