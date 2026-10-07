import sax from 'sax'

export const MAX_MANIFEST_SIZE = 2_000_000
export const MAX_CAST_SUBTITLE_BYTES = 8 * 1024 * 1024
export const MIN_RESOURCE_GRACE_MS = 120_000
const MAX_RESOURCES = 65_536
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function httpUrl(value, base) {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported Cast resource URL')
  return url
}

/** Rewrites resource URLs while retaining DASH ranges and segment templates. */
export function rewriteCastDash(xml, base, register, dashContext, onRoot) {
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
  const documentRoot = root.children.find(node => typeof node !== 'string')
  if (documentRoot?.name.split(':').at(-1) !== (dashContext?.rootName ?? 'MPD')) {
    throw new Error('Invalid Cast DASH manifest')
  }
  onRoot?.(documentRoot.attributes)
  function resolveUrls(values, bases) {
    const urls = new Set()
    for (const value of values) {
      for (const base of bases) {
        urls.add(httpUrl(value, base).href)
        if (urls.size > MAX_RESOURCES) throw new Error('Too many Cast resource alternatives')
      }
    }
    return [...urls]
  }
  function registerUrls(urls, contentType) {
    return register(urls.length === 1 ? urls[0] : urls, contentType)
  }
  function elementXmlBase(node, inheritedXmlBase) {
    return Object.hasOwn(node.attributes, 'xml:base') ? httpUrl(node.attributes['xml:base'], inheritedXmlBase).href : inheritedXmlBase
  }
  function renderAttributes(node, bases, inheritedBases = bases, xmlBase = base) {
    const element = node.name.split(':').at(-1)
    return Object.entries(node.attributes).filter(([name]) => name !== 'xml:base').map(([name, value]) => {
      const attribute = name.split(':').at(-1)
      // Resolve-to-zero tells the DASH client to remove an element without fetching it.
      if (attribute === 'href' && ['Period', 'AdaptationSet', 'SegmentList'].includes(element) && value !== 'urn:mpeg:dash:resolve-to-zero:2013') {
        // XLinks resolve against the element's XML base; imported media inherits the
        // containing DASH element's bases when the receiver replaces the node.
        value = register(httpUrl(value, xmlBase).href, 'application/dash+xml', undefined, { rootName: element, bases: inheritedBases })
      } else if (element === 'UTCTiming' && attribute === 'value' &&
          /^urn:mpeg:dash:utc:http-(?:head|xsdate|iso|ntp):(?:2012|2014)$/.test(node.attributes.schemeIdUri ?? '')) {
        value = value.trim().split(/\s+/).map(url => registerUrls(resolveUrls([url], bases))).join(' ')
      } else if (['media', 'initialization', 'sourceURL'].includes(attribute) ||
          (attribute === 'href' && value !== 'urn:mpeg:dash:resolve-to-zero:2013') ||
          (attribute === 'index' && ['SegmentTemplate', 'SegmentURL'].includes(element)) ||
          (attribute === 'bitstreamSwitching' && element === 'SegmentTemplate')) {
        value = registerUrls(resolveUrls([value], bases))
      }
      return ` ${name}="${escapeXml(value)}"`
    }).join('')
  }
  function render(node, inheritedBases, inheritedXmlBase = base) {
    if (typeof node === 'string') return escapeXml(node)
    const name = node.name.split(':').at(-1)
    // Patch operations need the original MPD context to resolve their URLs.
    // Use full MPD refreshes until the relay supports that context.
    if (name === 'PatchLocation') return ''
    const xmlBase = elementXmlBase(node, inheritedXmlBase)
    const localBases = Object.hasOwn(node.attributes, 'xml:base') ? [xmlBase] : inheritedBases
    if (name === 'Location') {
      // Manifest refreshes use the XML base, independently of media BaseURL.
      const url = register(httpUrl(node.children.join('').trim(), xmlBase).href, 'application/dash+xml')
      return `<${node.name}${renderAttributes(node, [xmlBase], [xmlBase], xmlBase)}>${escapeXml(url)}</${node.name}>`
    }
    const bases = node.children.filter(child => typeof child !== 'string' && child.name.split(':').at(-1) === 'BaseURL')
    const baseUrls = new Map(bases.map(child => [child, resolveUrls([child.children.join('').trim()],
      Object.hasOwn(child.attributes, 'xml:base') ? [elementXmlBase(child, xmlBase)] : localBases)]))
    const effectiveBases = bases.length ? resolveUrls([...baseUrls.values()].flat(), [undefined]) : localBases
    const attributes = renderAttributes(node, effectiveBases, localBases, xmlBase)
    const children = node.children.map(child => {
      if (bases.includes(child)) {
        return `<${child.name}${renderAttributes(child, baseUrls.get(child), localBases, elementXmlBase(child, xmlBase))}>${escapeXml(registerUrls(baseUrls.get(child)))}</${child.name}>`
      }
      return render(child, effectiveBases, xmlBase)
    }).join('')
    return `<${node.name}${attributes}>${children}</${node.name}>`
  }
  return root.children.map(node => render(node, dashContext?.bases ?? [base])).join('')
}

export function rewriteCastHls(text, base, register, parentVariables = {}) {
  if (text.length > MAX_MANIFEST_SIZE || !text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid Cast HLS manifest')
  const variables = new Map()
  let variableSnapshot = {}
  let nextIsPlaylist = false
  function substitute(value) {
    return value.replaceAll(/\{\$([a-zA-Z0-9_-]+)\}/g, (_, name) => {
      if (!variables.has(name)) throw new Error('Undefined HLS variable')
      return variables.get(name)
    })
  }
  function resource(value, playlist = false) {
    // Resolve variables before URL parsing; keep the receiver on exact resources.
    return register(httpUrl(value, base).href, playlist ? 'application/x-mpegurl' : undefined, variableSnapshot)
  }
  return text.split('\n').map(line => {
    if (line.startsWith('#EXT-X-DEFINE:')) {
      const attributes = Object.fromEntries([...line.matchAll(/([A-Z]+)="([^"]*)"/g)].map(([, name, value]) => [name, substitute(value)]))
      const definitions = ['NAME', 'IMPORT', 'QUERYPARAM'].filter(name => Object.hasOwn(attributes, name))
      if (definitions.length !== 1) throw new Error('Invalid HLS variable definition')
      const name = attributes[definitions[0]]
      let value
      if (definitions[0] === 'NAME') value = attributes.VALUE
      else if (definitions[0] === 'IMPORT') value = Object.hasOwn(parentVariables, name) ? parentVariables[name] : undefined
      else value = new URL(base).searchParams.get(name) ?? undefined
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || variables.has(name) || value === undefined || /["\r\n]/.test(value)) {
        throw new Error('Invalid HLS variable definition')
      }
      variables.set(name, value)
      variableSnapshot = Object.fromEntries(variables)
      // Definitions, imports and query parameters have already been consumed.
      return ''
    }
    if (line.trim() && !line.startsWith('#')) {
      const result = resource(substitute(line.trim()), nextIsPlaylist)
      nextIsPlaylist = false
      return result
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) nextIsPlaylist = true
    const playlist = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line)
    return line.replaceAll(/"([^"\r\n]*)"/g, (_, value) => `"${substitute(value)}"`)
      .replaceAll(/URI="([^"]+)"/g, (_, url) => `URI="${resource(url, playlist)}"`)
  }).join('\n')
}

export function hlsResourceGrace(text) {
  let duration = 0
  let longest = 0
  let target = 0
  for (const line of text.split('\n')) {
    const value = Number(line.match(/^#EXTINF:([\d.]+)/)?.[1] ??
      (line.startsWith('#EXT-X-PART:') ? line.replaceAll(/"[^"]*"/g, '""').match(/(?:[:,])DURATION=([\d.]+)/)?.[1] : undefined))
    if (Number.isFinite(value)) { duration += value; longest = Math.max(longest, value) }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) target = Number(line.slice(line.indexOf(':') + 1)) || 0
  }
  // Include a full playlist plus a segment, and at least three target durations
  // for partial segments. The minimum also covers delayed receiver requests.
  const graceMs = Math.max(MIN_RESOURCE_GRACE_MS, (duration + longest) * 1000, target * 3000)
  if (!Number.isFinite(graceMs)) throw new Error('Invalid Cast HLS duration')
  return graceMs
}

export function dashResourceGrace(attributes) {
  function duration(value) {
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value ?? '')
    // Calendar units use their longest duration to keep retirement conservative.
    const seconds = [366 * 86400, 31 * 86400, 86400, 3600, 60, 1]
    return match ? match.slice(1).reduce((total, part, index) => total + Number(part ?? 0) * seconds[index], 0) * 1000 : 0
  }
  const graceMs = Math.max(MIN_RESOURCE_GRACE_MS,
    duration(attributes.timeShiftBufferDepth) + duration(attributes.maxSegmentDuration) + 2 * duration(attributes.minimumUpdatePeriod))
  if (!Number.isFinite(graceMs)) throw new Error('Invalid Cast DASH duration')
  return graceMs
}
