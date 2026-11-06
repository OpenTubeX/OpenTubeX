import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

const css = await readFile(new URL('../../../src/renderer/themes.css', import.meta.url), 'utf8')

test('solid fills prefer white on medium colors and dark text on light colors', async ({ page }) => {
  await page.setContent(`<style>${css}</style><div id="primary" style="color:var(--text-with-main-color)"></div><div id="secondary" style="color:var(--text-with-accent-color)"></div>`)
  for (const [name, foreground] of [
    ['Red', 'color(srgb 1 1 1)'],
    ['Pink', 'color(srgb 1 1 1)'],
    ['Blue', 'color(srgb 1 1 1)'],
    ['Teal', 'color(srgb 1 1 1)'],
    ['Yellow', 'color(srgb 0 0 0)'],
    ['Lime', 'color(srgb 0 0 0)'],
  ]) {
    await page.locator('body').evaluate((element, name) => {
      element.className = `dark main${name} sec${name}`
    }, name)
    await expect(page.locator('#primary'), name).toHaveCSS('color', foreground)
    await expect(page.locator('#secondary'), name).toHaveCSS('color', foreground)
  }
})

test('foreground follows the fill on nested palettes and custom color values', async ({ page }) => {
  await page.setContent(`<style>${css}</style><div class="mainRed secBlue"><span id="primary" style="color:var(--text-with-main-color)"></span><span id="secondary" style="color:var(--text-with-accent-color)"></span></div>`)
  await page.locator('body').evaluate(element => { element.className = 'light mainYellow secYellow' })
  for (const target of ['#primary', '#secondary']) {
    await expect(page.locator(target)).toHaveCSS('color', 'color(srgb 1 1 1)')
  }
  await page.locator('body > div').evaluate(element => {
    element.style.setProperty('--primary-color', '#ffffff')
    element.style.setProperty('--accent-color', '#000000')
  })
  await expect(page.locator('#primary')).toHaveCSS('color', 'color(srgb 0 0 0)')
  await expect(page.locator('#secondary')).toHaveCSS('color', 'color(srgb 1 1 1)')
  // Authored custom themes keep their explicitly chosen foregrounds.
  await page.locator('body > div').evaluate(element => {
    element.style.setProperty('--text-with-main-color', '#112233')
    element.style.setProperty('--text-with-accent-color', '#fedcba')
  })
  await expect(page.locator('#primary')).toHaveCSS('color', 'rgb(17, 34, 51)')
  await expect(page.locator('#secondary')).toHaveCSS('color', 'rgb(254, 220, 186)')
})

test('every selectable palette keeps its foreground usable through hover and press', async ({ page }) => {
  const names = [...new Set([...css.matchAll(/\.main([A-Z][A-Za-z]*)\b/g)].map(match => match[1]))]
  expect(names.length).toBeGreaterThan(90)
  await page.setContent(`<style>${css}</style><div id="palette"></div>`)
  const failures = await page.locator('#palette').evaluate((element, names) => {
    const context = new OffscreenCanvas(1, 1).getContext('2d')
    const read = property => {
      element.style.color = `var(${property})`
      context.fillStyle = getComputedStyle(element).color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const luminance = channels => channels.map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const failures = []
    for (const name of names) {
      for (const [prefix, text, fill] of [['main', 'main', 'primary'], ['sec', 'accent', 'accent']]) {
        element.className = `${prefix}${name}`
        const foreground = read(`--text-with-${text}-color`)
        const background = read(`--${fill}-color`)
        const brightness = background.reduce((sum, channel, index) => sum + channel * [0.299, 0.587, 0.114][index], 0)
        const expected = brightness < 127.5 ? 255 : 0
        if (!foreground.every(channel => channel === expected)) failures.push(`${prefix}${name}: wrong foreground`)
        // White on medium fills is the chosen style; light fills retain the
        // stronger contrast of black text. State changes must not drop below it.
        const minimum = expected === 255 ? 3 : 4.5
        for (const state of ['', '-hover', '-active']) {
          const colors = [luminance(foreground), luminance(read(`--${fill}-color${state}`))].sort((a, b) => b - a)
          const ratio = (colors[0] + 0.05) / (colors[1] + 0.05)
          if (ratio < minimum) failures.push(`${prefix}${name}${state}: ${ratio.toFixed(2)}:1`)
        }
      }
    }
    return failures
  }, names)
  expect(failures).toEqual([])
})
