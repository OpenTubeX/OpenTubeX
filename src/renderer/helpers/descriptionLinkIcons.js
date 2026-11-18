// @ts-check
import { getLoadedIconData } from '../icons/registerMappedIcons.js'
import { resolveIconifyId } from '../icons/resolveIconifyId.js'

/**
 * The social media icons that YouTube shows in descriptions, by the name of its image,
 * with the brand colors from Simple Icons. YouTube still calls X `twitter`.
 * @type {Map<string, { icon: string, color: string, glyphColor?: string }>}
 */
const BRANDS = new Map([
  ['discord', { icon: 'discord', color: '#5865f2' }],
  ['facebook', { icon: 'facebook', color: '#0866ff' }],
  ['goodreads', { icon: 'goodreads', color: '#1e1914' }],
  ['instagram', { icon: 'instagram', color: '#ff0069' }],
  ['linkedin', { icon: 'linkedin', color: '#0a66c2' }],
  ['medium', { icon: 'medium', color: '#000000' }],
  ['patreon', { icon: 'patreon', color: '#000000' }],
  ['pinterest', { icon: 'pinterest', color: '#bd081c' }],
  ['reddit', { icon: 'reddit', color: '#ff4500' }],
  ['snapchat', { icon: 'snapchat', color: '#fffc00', glyphColor: '#000000' }],
  ['soundcloud', { icon: 'soundcloud', color: '#ff5500' }],
  ['spotify', { icon: 'spotify', color: '#1ed760', glyphColor: '#000000' }],
  ['tiktok', { icon: 'tiktok', color: '#000000' }],
  ['tumblr', { icon: 'tumblr', color: '#36465d' }],
  ['twitch', { icon: 'twitch', color: '#9146ff' }],
  ['twitter', { icon: 'x', color: '#000000' }],
])

/**
 * The icon in front of a description link that YouTube shows with an icon and a short label,
 * drawn locally from the selected icon pack, as sanitized HTML cannot mount `FtIcon`.
 * Brand icons sit on their brand color, so that they keep their contrast on every theme.
 * @param {string} name the icon's name, see `parseLocalIconLink`
 * @returns {string} an `img` element, or an empty string while the icon pack loads
 */
export function getDescriptionLinkIconHtml(name) {
  const brand = BRANDS.get(name)
  const icon = getLoadedIconData(resolveIconifyId(
    name === 'youtube' ? ['fab', 'youtube'] : brand ? ['fab', brand.icon] : ['fas', 'link']
  ))
  if (!icon) {
    return ''
  }

  // Iconify's default glyph size
  const viewBox = `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`
  // YouTube's logo is already a badge
  const svg = name === 'youtube'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" color="#ff0000">${icon.body}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${brand?.color ?? '#606060'}"/><svg x="5" y="5" width="14" height="14" viewBox="${viewBox}" color="${brand?.glyphColor ?? '#ffffff'}">${icon.body}</svg></svg>`

  return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="" width="18" height="18" style="vertical-align: middle">`
}
