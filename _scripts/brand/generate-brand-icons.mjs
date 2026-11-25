#!/usr/bin/env node
// Regenerates the themed OpenTubeX in-app logo assets (the small sidebar mark
// and the "OpenTubeX" wordmark) for every theme, preserving each theme's
// original fill colour and the dimensions the renderer/CSS expects.
//
// Sources:
//   _scripts/brand/mark-black.svg     -> the OpenTubeX mark (path geometry)
//   _scripts/brand/wordmark-paths.svg -> "OpenTubeX" wordmark (path geometry)
//
// Run: node _scripts/brand/generate-brand-icons.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(here, '..', '..', '_icons')

// --- Extract the mark geometry (all <path d="..."> from the source) ---
const markSrc = readFileSync(join(here, 'mark-black.svg'), 'utf8')
const markPaths = [...markSrc.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map((m) => m[1])
if (markPaths.length === 0) throw new Error('No mark paths found')
const MARK_VIEWBOX = '0 0 657.69397 657.69397'

// --- Extract the wordmark geometry ---
const wordSrc = readFileSync(join(here, 'wordmark-paths.svg'), 'utf8')
const wordPath = wordSrc.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/)?.[1]
if (!wordPath) throw new Error('No wordmark path found')
// Tight bounding box of the wordmark glyphs (from `inkscape --query`).
const WORD_BBOX = { x: 12.0117, y: 78.8086, w: 1667.92, h: 282.422 }

// --- Per-theme fill colours (matching the original FreeTube assets) ---
// Each theme keeps the exact single colour it shipped with, so the rebrand
// only swaps the artwork, never the per-theme contrast treatment.
const THEMES = {
  Black: '#000',
  White: '#fff',
  // "Color" (default light/dark/black) is no longer referenced by themes.css
  // after the monochrome split, but we regenerate it as a neutral dark mark so
  // no stale FreeTube-shaped artwork lingers.
  Color: '#212121',
  CatppuccinFrappeDark: '#303446',
  CatppuccinFrappeLight: '#c6d0f5',
  CatppuccinLatteDark: '#4c4f69',
  CatppuccinLatteLight: '#eff1f5',
  CatppuccinMochaDark: '#1e1e2e',
  CatppuccinMochaLight: '#cdd6f4',
  DraculaDark: '#282a36',
  DraculaLight: '#f8f8f8',
  EverforestDarkHard: '#1e2326',
  EverforestDarkLow: '#293136',
  EverforestDarkMedium: '#232a2e',
  EverforestLightHard: '#f2efdf',
  EverforestLightLow: '#e5dfc5',
  EverforestLightMedium: '#efebd4',
  GruvboxDark: '#282828',
  GruvboxLight: '#ebdbb2',
  NordicLight: '#eee',
  SolarizedDark: '#002b36',
  SolarizedLight: '#fdf6e3'
}

const round = (n) => Number(n.toFixed(3))

function iconSvg (color) {
  const paths = markPaths
    .map((d) => `<path d="${d}" fill="${color}"/>`)
    .join('')
  return `<svg width="25" height="25" viewBox="${MARK_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`
}

function textSvg (color) {
  const width = 100
  const height = round((width * WORD_BBOX.h) / WORD_BBOX.w)
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${round(WORD_BBOX.w)} ${round(WORD_BBOX.h)}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${round(-WORD_BBOX.x)},${round(-WORD_BBOX.y)})"><path d="${wordPath}" fill="${color}"/></g></svg>`
}

let count = 0
for (const [theme, color] of Object.entries(THEMES)) {
  writeFileSync(join(iconsDir, `icon${theme}Small.svg`), iconSvg(color) + '\n')
  writeFileSync(join(iconsDir, `text${theme}Small.svg`), textSvg(color) + '\n')
  count += 2
}

console.log(`Wrote ${count} themed brand assets to ${iconsDir}`)
