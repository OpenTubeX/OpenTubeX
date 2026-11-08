import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
const mappings = require('../src/renderer/icons/faIconMap.json')
const names = ['display', 'eye', 'eye-slash', 'times', 'step-backward', 'play', 'pause', 'step-forward', 'clone', 'power-off']
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const packs = {}
  for (const [pack, prefix, field] of [['material', 'material-symbols', 'material'], ['remix', 'ri', 'ri']]) {
    const bundle = require(`../src/renderer/icons/iconifyBundles/${pack}.json`)
    packs[pack] = {}
    for (const name of names) {
      const data = bundle[`${prefix}:${mappings[name][field]}`]
      packs[pack][name] = await page.evaluate(async ({ body, width, height }) => {
        const image = new Image()
        image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color="black">${body}</svg>`)}`
        await image.decode()
        return [16, 32].map(size => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = size
          canvas.getContext('2d').drawImage(image, 0, 0, size, size)
          return canvas.toDataURL('image/png').split(',')[1]
        })
      }, data)
    }
  }
  await writeFile(new URL('../src/main/trayMenuIcons.json', import.meta.url), `${JSON.stringify(packs)}\n`)
} finally {
  await browser.close()
}
