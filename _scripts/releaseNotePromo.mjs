import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from '@playwright/test'

const WIDTH = 1600
const HEIGHT = 900
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const projectRoot = path.resolve(here, '..')
const electronEntry = path.join(here, 'releaseNotePromoElectron.mjs')
const appIconPath = path.join(projectRoot, '_scripts/brand/icon-master.svg')
const fontPath = path.join(projectRoot, 'src/renderer/assets/font/Roboto-Regular.ttf')
const MIME_TYPES = new Map([
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.webp', 'image/webp'],
])

function usage() {
  return `Usage:
  node _scripts/releaseNotePromo.mjs \\
    --screenshot SCREENSHOT \\
    --title "TITLE" \\
    --description "DESCRIPTION" \\
    --output OUTPUT.png \\
    [--accent "#8b7cff"] \\
    (--icon MATERIAL_SYMBOL | --motif IMAGE)

The icon can be a Material Symbols name such as "devices-rounded".
On Linux the command automatically renders inside a private X server.`
}

function fail(message) {
  throw new Error(`${message}\n\n${usage()}`)
}

function readOptions(args) {
  let parsed

  try {
    parsed = parseArgs({
      allowPositionals: false,
      args,
      options: {
        accent: { type: 'string', default: '#8b7cff' },
        description: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        icon: { type: 'string' },
        motif: { type: 'string' },
        output: { type: 'string' },
        screenshot: { type: 'string' },
        title: { type: 'string' },
      },
      strict: true,
    })
  } catch (error) {
    fail(error.message)
  }

  const { values } = parsed
  if (values.help) return { help: true }

  for (const name of ['description', 'output', 'screenshot', 'title']) {
    if (!values[name]?.trim()) fail(`--${name} is required.`)
  }

  if (!/^#[\dA-Fa-f]{6}$/.test(values.accent)) {
    fail('--accent must be a six-digit hex color such as #8b7cff.')
  }

  if (path.extname(values.output).toLowerCase() !== '.png') {
    fail('--output must end in .png.')
  }

  if (Boolean(values.icon) === Boolean(values.motif)) {
    fail('Provide either --icon or --motif, but not both.')
  }

  return {
    accent: values.accent,
    description: values.description.trim(),
    icon: values.icon?.trim(),
    motif: values.motif,
    output: path.resolve(values.output),
    screenshot: path.resolve(values.screenshot),
    title: values.title.trim(),
  }
}

export function materialSymbolMotifDataUrl(iconName, accent) {
  const collectionPath = require.resolve('@iconify-json/material-symbols/icons.json')
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'))
  const normalizedName = iconName.replace(/^material-symbols:/, '')
  const fallbackName = normalizedName.endsWith('-rounded') ? normalizedName : `${normalizedName}-rounded`
  const icon = collection.icons[normalizedName] ?? collection.icons[fallbackName]

  if (!icon) {
    fail(`Unknown Material Symbols icon: ${iconName}`)
  }

  const width = icon.width ?? collection.width ?? 24
  const height = icon.height ?? collection.height ?? 24
  const iconScale = 132 / Math.max(width, height)
  const iconX = (256 - (width * iconScale)) / 2
  const iconY = (246 - (height * iconScale)) / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="shield" x1="38" y1="24" x2="216" y2="230" gradientUnits="userSpaceOnUse">
      <stop stop-color="${accent}" stop-opacity=".55"/>
      <stop offset="1" stop-color="#172363" stop-opacity=".82"/>
    </linearGradient>
    <linearGradient id="stroke" x1="46" y1="30" x2="208" y2="225" gradientUnits="userSpaceOnUse">
      <stop stop-color="#c9c1ff"/>
      <stop offset=".45" stop-color="${accent}"/>
      <stop offset="1" stop-color="#4f6de8"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M128 14 218 50v65c0 59-34 103-90 128-56-25-90-69-90-128V50z" fill="url(#shield)" stroke="url(#stroke)" stroke-width="6" filter="url(#glow)"/>
  <g color="#eeeaff" transform="translate(${iconX} ${iconY}) scale(${iconScale})">${icon.body}</g>
</svg>`

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function fileDataUrl(filePath, allowedMimeTypes) {
  const resolvedPath = path.resolve(filePath)
  if (!fs.statSync(resolvedPath, { throwIfNoEntry: false })?.isFile()) {
    fail(`File not found: ${resolvedPath}`)
  }

  const mimeType = MIME_TYPES.get(path.extname(resolvedPath).toLowerCase())
  if (!mimeType || !allowedMimeTypes.has(mimeType)) {
    fail(`Unsupported image type: ${resolvedPath}`)
  }

  return `data:${mimeType};base64,${fs.readFileSync(resolvedPath).toString('base64')}`
}

export function renderPromoHtml({
  accent,
  description,
  fontDataUrl,
  iconDataUrl,
  motifDataUrl,
  screenshotDataUrl,
  title,
}) {
  const safeAccent = escapeHtml(accent)
  const safeDescription = escapeHtml(description)
  const safeTitle = escapeHtml(title)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=${WIDTH}, initial-scale=1">
    <style>
      @font-face {
        font-family: "OpenTubeX Promo";
        font-style: normal;
        font-weight: 100 900;
        src: url("${fontDataUrl}") format("truetype");
      }

      :root {
        color-scheme: dark;
        --accent: ${safeAccent};
        --background: #060713;
        --panel: #0c0d15;
        --text: #f7f7fa;
        --muted: #a7a7b3;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        height: ${HEIGHT}px;
        margin: 0;
        overflow: hidden;
        width: ${WIDTH}px;
      }

      body {
        background:
          radial-gradient(circle at 48% 30%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 31%),
          radial-gradient(circle at 83% 86%, rgb(34 64 150 / 16%), transparent 35%),
          linear-gradient(132deg, #05060d 0%, var(--background) 54%, #050713 100%);
        color: var(--text);
        font-family: "OpenTubeX Promo", system-ui, sans-serif;
      }

      .promo {
        display: grid;
        gap: 42px;
        grid-template-columns: minmax(0, 41fr) minmax(0, 59fr);
        height: 100%;
        padding-block: 40px;
        padding-inline: 36px;
        position: relative;
      }

      .copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
        position: relative;
        z-index: 2;
      }

      .brand {
        background: linear-gradient(150deg, #212229, #07080d);
        border: 1px solid rgb(255 255 255 / 20%);
        border-radius: 30px;
        box-shadow: 0 14px 40px rgb(0 0 0 / 28%);
        height: 126px;
        object-fit: contain;
        padding: 7px;
        width: 126px;
      }

      .message {
        margin-block-start: 70px;
        max-width: 610px;
      }

      h1 {
        font-size: 68px;
        font-weight: 800;
        letter-spacing: -2.4px;
        line-height: 1.04;
        margin: 0;
        text-wrap: balance;
      }

      .description {
        color: var(--muted);
        font-size: 29px;
        line-height: 1.42;
        margin-block: 34px 0;
        max-width: 565px;
      }

      .orbit {
        bottom: 16px;
        height: 245px;
        left: 10px;
        opacity: 0.9;
        position: absolute;
        width: 520px;
      }

      .orbit::before,
      .orbit::after {
        border: 3px solid color-mix(in srgb, var(--accent) 58%, transparent);
        border-radius: 50%;
        content: "";
        filter: drop-shadow(0 0 12px color-mix(in srgb, var(--accent) 54%, transparent));
        inset: 70px 10px;
        position: absolute;
        transform: rotate(-18deg);
      }

      .orbit::after {
        border-color: rgb(48 87 231 / 48%);
        inset: 82px 42px;
        transform: rotate(-10deg);
      }

      .motif {
        filter: drop-shadow(0 0 22px color-mix(in srgb, var(--accent) 42%, transparent));
        height: 218px;
        inset-block-start: -6px;
        inset-inline-start: 150px;
        object-fit: contain;
        position: absolute;
        width: 218px;
        z-index: 1;
      }

      .visual {
        align-items: center;
        display: flex;
        justify-content: center;
        min-width: 0;
        position: relative;
        z-index: 2;
      }

      .screenshot-frame {
        background:
          linear-gradient(var(--panel), var(--panel)) padding-box,
          linear-gradient(135deg, color-mix(in srgb, var(--accent) 46%, #626477), rgb(255 255 255 / 10%)) border-box;
        border: 1px solid transparent;
        border-radius: 28px;
        box-shadow:
          0 32px 90px rgb(0 0 0 / 48%),
          0 0 52px color-mix(in srgb, var(--accent) 11%, transparent);
        max-width: 100%;
        padding: 18px;
        position: relative;
        width: 100%;
      }

      .screenshot-frame::before {
        background: linear-gradient(90deg, var(--accent), #4f6de8);
        border-radius: 999px;
        content: "";
        height: 3px;
        inset-block-start: 0;
        inset-inline: 48px;
        opacity: 0.6;
        position: absolute;
      }

      .screenshot {
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 18px;
        display: block;
        height: auto;
        max-height: 790px;
        object-fit: contain;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <main class="promo">
      <section class="copy">
        <img class="brand" alt="" src="${iconDataUrl}">
        <div class="message">
          <h1>${safeTitle}</h1>
          <p class="description">${safeDescription}</p>
        </div>
        <div class="orbit" aria-hidden="true">
          <img class="motif" alt="" src="${motifDataUrl}">
        </div>
      </section>
      <section class="visual">
        <div class="screenshot-frame">
          <img class="screenshot" alt="" src="${screenshotDataUrl}">
        </div>
      </section>
    </main>
  </body>
</html>`
}

function runInPrivateX(args) {
  if (process.platform !== 'linux' || process.env.OPENTUBEX_RELEASE_PROMO_PRIVATE_X === '1') {
    return false
  }

  const result = spawnSync('xvfb-run', [
    '-a',
    '-s', `-screen 0 ${WIDTH}x${HEIGHT}x24`,
    process.execPath,
    fileURLToPath(import.meta.url),
    ...args,
  ], {
    env: {
      ...process.env,
      OPENTUBEX_RELEASE_PROMO_PRIVATE_X: '1',
    },
    stdio: 'inherit',
  })

  if (result.error) {
    throw new Error(`Could not start the private X server: ${result.error.message}`)
  }

  process.exitCode = result.status ?? 1
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const options = readOptions(args)
  if (options.help) {
    console.log(usage())
    return
  }
  if (runInPrivateX(args)) return

  const screenshotDataUrl = fileDataUrl(options.screenshot, new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]))
  const iconDataUrl = fileDataUrl(appIconPath, new Set(['image/svg+xml']))
  const fontDataUrl = fileDataUrl(fontPath, new Set(['font/ttf']))
  const motifDataUrl = options.motif
    ? fileDataUrl(options.motif, new Set(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']))
    : materialSymbolMotifDataUrl(options.icon, options.accent)
  const html = renderPromoHtml({
    accent: options.accent,
    description: options.description,
    fontDataUrl,
    iconDataUrl,
    motifDataUrl,
    screenshotDataUrl,
    title: options.title,
  })
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'opentubex-release-promo-'))
  let electronApp
  try {
    const htmlPath = path.join(tempDirectory, 'promo.html')
    fs.writeFileSync(htmlPath, html)
    fs.mkdirSync(path.dirname(options.output), { recursive: true })

    electronApp = await electron.launch({
      args: [electronEntry],
      env: {
        ...process.env,
        OPENTUBEX_RELEASE_PROMO_HTML: htmlPath,
      },
      timeout: 30_000,
    })
    const page = await electronApp.firstWindow({ timeout: 30_000 })
    await page.waitForFunction(() => (
      document.fonts.status === 'loaded' &&
      [...document.images].every(image => image.complete && image.naturalWidth > 0)
    ), undefined, { timeout: 30_000 })
    await page.screenshot({
      animations: 'disabled',
      path: options.output,
      type: 'png',
    })
  } finally {
    await electronApp?.close()
    fs.rmSync(tempDirectory, { force: true, recursive: true })
  }

  console.log(`Wrote ${options.output}`)
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
