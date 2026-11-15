import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

const themeCss = await readFile(new URL('../../../src/renderer/themes.css', import.meta.url), 'utf8')
const exactThresholdStart = themeCss.indexOf('/* Keep the exact threshold')
expect(exactThresholdStart, 'the exact-threshold override must exist before removing it').toBeGreaterThanOrEqual(0)

for (const supportsRound of [true, false]) {
  test.describe(supportsRound ? 'native rounding' : 'without CSS round()', () => {
    const css = supportsRound ? themeCss : themeCss.slice(0, exactThresholdStart)

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
  })
}
