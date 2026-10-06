import sax from 'sax'

// SSDP discovery uses IPv4. Also reject foreign numeric IPv6 URL hosts.
function isNumericHost(host) {
  return /^[\d.]+$/.test(host) || host.startsWith('[')
}

export function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function createAvTransportBody(serviceType, action, fields) {
  const argumentsXml = Object.entries(fields)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`).join('')
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${argumentsXml}</u:${action}></s:Body></s:Envelope>`
}

export function createDlnaMetadata(title, mediaUrl, merged) {
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:video/mp4:DLNA.ORG_OP=${merged ? '00' : '01'}">${escapeXml(mediaUrl)}</res></item></DIDL-Lite>`
}

export function formatDlnaTime(seconds) {
  const value = Math.floor(Math.max(0, seconds))
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
}

export function parseDlnaPosition(description) {
  const parser = sax.parser(true, { trim: true })
  let reading = false
  let time = ''
  parser.onopentag = tag => { reading = tag.name.split(':').at(-1) === 'RelTime' }
  parser.onclosetag = () => { reading = false }
  parser.ontext = text => { if (reading) time += text }
  parser.oncdata = parser.ontext
  try { parser.write(description).close() } catch { return null }
  const parts = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(time)
  if (!parts) return null
  const seconds = Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3])
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * @param {string} description
 * @param {string} location
 * @param {string} address
 */
export function parseDlnaDevice(description, location, address) {
  const parser = sax.parser(true, { trim: true })
  const stack = []
  let name = ''
  let baseUrl = ''
  let isRenderer = false
  let service = null
  let transport = null

  parser.onopentag = tag => {
    const element = { name: tag.name.split(':').at(-1), text: '' }
    stack.push(element)
    if (element.name === 'service') service = {}
  }
  parser.ontext = text => { if (stack.length > 0) stack.at(-1).text += text }
  parser.oncdata = text => { if (stack.length > 0) stack.at(-1).text += text }
  parser.onclosetag = () => {
    const element = stack.pop()
    if (element.name === 'URLBase' && stack.length === 1 && stack[0].name === 'root') baseUrl = element.text.trim()
    if (element.name === 'friendlyName' && !name) name = element.text.trim()
    if (element.name === 'deviceType' && /:device:MediaRenderer:\d+$/.test(element.text.trim())) isRenderer = true
    if (service && element.name === 'serviceType') service.type = element.text.trim()
    if (service && element.name === 'controlURL') service.controlUrl = element.text.trim()
    if (element.name === 'service') {
      if (service?.type?.startsWith('urn:schemas-upnp-org:service:AVTransport:') && service.controlUrl) {
        transport = service
      }
      service = null
    }
  }

  try {
    parser.write(description).close()
    if (!isRenderer || !transport || !name) return null
    const base = new URL(baseUrl || location)
    if (base.protocol !== 'http:' || (isNumericHost(base.hostname) && base.hostname !== address)) return null
    const control = new URL(transport.controlUrl, base)
    if (control.protocol !== 'http:' || (isNumericHost(control.hostname) && control.hostname !== address)) return null
    control.hostname = address
    return {
      id: location,
      name,
      address,
      controlUrl: control.href,
      serviceType: transport.type
    }
  } catch {
    return null
  }
}

export function parseSsdpLocation(message, address) {
  const header = /^location:\s*(\S+)/im.exec(message)
  if (!header) return null
  try {
    const url = new URL(header[1])
    if (url.protocol !== 'http:' || (isNumericHost(url.hostname) && url.hostname !== address)) return null
    url.hostname = address
    return url.href
  } catch {
    return null
  }
}
