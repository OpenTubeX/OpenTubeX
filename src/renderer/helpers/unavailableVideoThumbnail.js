// @ts-check

const COLORS = {
  light: { frame: '#cccccc', accent: '#ffbfbe', circle: '#3d7dff', stripe: '#6d9dff', triangle: '#00594a' },
  dark: { frame: '#b47cff', accent: '#666666', circle: '#3d7dff', stripe: '#6d9dff', triangle: '#00c4a0' }
}

const ICON_SIZE = 120

/**
 * An empty video frame among a few loose shapes, in the style of YouTube's
 * "video unavailable" image, drawn locally so that showing it contacts no server.
 * @param {{ body: string, width?: number, height?: number } | null} icon the selected pack's glyph, e.g. from `getLoadedIconData`
 * @param {boolean} isLightTheme
 * @returns {string} an SVG data URL
 */
export function createUnavailableVideoThumbnail(icon, isLightTheme) {
  const colors = isLightTheme ? COLORS.light : COLORS.dark
  // Iconify's default glyph size
  const iconWidth = icon?.width ?? 16
  const iconHeight = icon?.height ?? 16

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="816" height="471" viewBox="0 0 816 471" fill="none">
<defs><clipPath id="c"><circle cx="182" cy="124" r="113"/></clipPath></defs>
<circle cx="182" cy="124" r="113" fill="${colors.circle}"/>
<g clip-path="url(#c)" stroke="${colors.stripe}" stroke-width="16" stroke-linecap="round">
<path d="M70 168l240-112M70 214l240-112M90 250l240-112"/>
</g>
<path d="M481 4a40 40 0 0 1 30 66z" fill="${colors.accent}"/>
<path d="M10 172c40 4 64 70 20 98c-30 18-44-24-8-42c46-24 104 18 92 78" stroke="${colors.accent}" stroke-width="6" stroke-linecap="round"/>
<path d="M527 280l149-123l77 155z" fill="${colors.triangle}"/>
<rect x="162" y="94" width="485" height="281" stroke="${colors.frame}" stroke-width="20"/>
${icon
  ? `<svg x="${404.5 - ICON_SIZE / 2}" y="${234.5 - ICON_SIZE / 2}" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${iconWidth} ${iconHeight}" color="${colors.frame}">${icon.body}</svg>`
  : ''}
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
