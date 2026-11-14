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
 * names the outlines that contain the feed, outermost first, except those
 * containing every feed
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
        title: values.get('title') ?? null,
        folders: openOutlines.filter(name => name !== null),
      })
    }
    if (!tag.endsWith('/>')) {
      const name = (values.get('text') ?? values.get('title'))?.trim()
      openOutlines.push(!values.has('xmlurl') && name ? name : null)
    }
  }
  // Exports wrap all feeds in one outline, such as "YouTube Subscriptions",
  // which does not group them.
  const wrappers = new Set(feeds[0]?.folders.filter(name => feeds.every(feed => feed.folders.includes(name))))
  for (const feed of feeds) {
    feed.folders = feed.folders.filter(name => !wrappers.has(name))
  }
  return feeds
}
