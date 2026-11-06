const OUTLINE_PATTERN = /<outline\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
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
 * @returns {{ xmlUrl: string, title: string | null }[]}
 */
export function parseOpmlFeeds(content) {
  const body = content.search(/<body[\s>]/i)
  if (body === -1) {
    return []
  }
  const feeds = []
  for (const [, attributes] of content.slice(body).matchAll(OUTLINE_PATTERN)) {
    const values = new Map()
    for (const [, name, doubleQuoted, singleQuoted] of attributes.matchAll(ATTRIBUTE_PATTERN)) {
      values.set(name.toLowerCase(), decodeXmlEntities(doubleQuoted ?? singleQuoted))
    }
    if (values.has('xmlurl')) {
      feeds.push({ xmlUrl: values.get('xmlurl'), title: values.get('title') ?? null })
    }
  }
  return feeds
}
