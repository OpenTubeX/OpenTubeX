#!/usr/bin/env node
// Builds the larger OpenTubeX brand lockups from the shared mark + wordmark
// geometry:
//   _scripts/brand/icon-master.svg  -> square app icon (dark squircle + white mark)
//   _icons/icon.svg                 -> 64px vector app icon (Linux/electron-builder)
//   _icons/logoColor.svg            -> horizontal lockup on a dark card (README/PWA)
//   _scripts/brand/ftlogofull.svg   -> transparent lockup fragment for FtLogoFull.vue
//
// Run: node _scripts/brand/generate-brand-masters.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(here, '..', '..', '_icons')

const markSrc = readFileSync(join(here, 'mark-black.svg'), 'utf8')
const markPaths = [...markSrc.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map((m) => m[1])
const wordSrc = readFileSync(join(here, 'wordmark-paths.svg'), 'utf8')
const wordPath = wordSrc.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/)?.[1]

// Native geometry boxes (from `inkscape --query`).
const MARK = { side: 657.69397, artY: 107.644, artH: 442.406 } // mark sits in a square viewBox, vertically centred
const WORD = { x: 12.0117, y: 78.8086, w: 1667.92, h: 282.422 }
const round = (n) => Number(n.toFixed(3))

function markGroup (color, scale, tx, ty) {
  const paths = markPaths.map((d) => `<path d="${d}" fill="${color}"/>`).join('')
  return `<g transform="translate(${round(tx)},${round(ty)}) scale(${round(scale)})">${paths}</g>`
}

function wordGroup (color, scale, tx, ty) {
  // Translate the glyph bbox to the origin first, then scale/position.
  return `<g transform="translate(${round(tx)},${round(ty)}) scale(${round(scale)}) translate(${round(-WORD.x)},${round(-WORD.y)})"><path d="${wordPath}" fill="${color}"/></g>`
}

// ---------------------------------------------------------------------------
// 1) Square app icon: dark squircle background + centred white mark.
// ---------------------------------------------------------------------------
function appIcon (size) {
  const radius = round(size * 0.225)
  const markTarget = size * 0.56 // visible mark width as a fraction of the icon
  const s = markTarget / MARK.side
  const tx = (size - markTarget) / 2
  const ty = (size - markTarget) / 2
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#242424"/>
      <stop offset="1" stop-color="#050505"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  ${markGroup('#ffffff', s, tx, ty)}
</svg>
`
}

writeFileSync(join(here, 'icon-master.svg'), appIcon(1024))
writeFileSync(join(iconsDir, 'icon.svg'), appIcon(64))

// ---------------------------------------------------------------------------
// 2) Horizontal lockup (mark + wordmark) on a dark card -> logoColor.svg
// ---------------------------------------------------------------------------
function lockup ({ background, markColor, wordColor, radius = 0, pad = 46 }) {
  const H = 220
  const markH = 132
  const markScale = markH / MARK.artH
  const markW = MARK.side * markScale
  const wordH = 74
  const wordScale = wordH / WORD.h
  const wordW = WORD.w * wordScale
  const gap = 40

  const contentW = markW + gap + wordW
  const W = round(contentW + pad * 2)

  // Mark: place so its art is vertically centred in H.
  const markTx = pad
  const markTy = H / 2 - (MARK.artY + MARK.artH / 2) * markScale
  // Wordmark: start after the mark, vertically centred.
  const wordTx = pad + markW + gap
  const wordTy = (H - wordH) / 2

  const rectAttrs = radius
    ? `<rect width="${W}" height="${H}" rx="${radius}" ry="${radius}" fill="${background}"/>`
    : ''

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${rectAttrs}
  ${markGroup(markColor, markScale, markTx, markTy)}
  ${wordGroup(wordColor, wordScale, wordTx, wordTy)}
</svg>
`
}

writeFileSync(join(iconsDir, 'logoColor.svg'), lockup({
  background: '#0d0d0d',
  markColor: '#ffffff',
  wordColor: '#ffffff',
  radius: 36
}))

// ---------------------------------------------------------------------------
// 3) Transparent lockup using CSS color classes -> FtLogoFull.vue fragment
// ---------------------------------------------------------------------------
function ftLogoFull () {
  const H = 220
  const markH = 132
  const markScale = markH / MARK.artH
  const markW = MARK.side * markScale
  const wordH = 74
  const wordScale = wordH / WORD.h
  const wordW = WORD.w * wordScale
  const gap = 40
  const pad = 0
  const W = round(markW + gap + wordW)

  const markTx = pad
  const markTy = H / 2 - (MARK.artY + MARK.artH / 2) * markScale
  const wordTx = markW + gap
  const wordTy = (H - wordH) / 2

  const markEls = markPaths
    .map((d) => `      <path class="primary-color" d="${d}" />`)
    .join('\n')

  return `  <svg
    viewBox="0 0 ${W} ${H}"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g transform="translate(${round(markTx)},${round(markTy)}) scale(${round(markScale)})">
${markEls}
    </g>
    <g transform="translate(${round(wordTx)},${round(wordTy)}) scale(${round(wordScale)}) translate(${round(-WORD.x)},${round(-WORD.y)})">
      <path class="secondary-color" d="${wordPath}" />
    </g>
  </svg>
`
}

writeFileSync(join(here, 'ftlogofull.svg'), ftLogoFull())

console.log('Wrote icon-master.svg, _icons/icon.svg, _icons/logoColor.svg, ftlogofull.svg')
