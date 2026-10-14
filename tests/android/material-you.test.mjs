import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goToSettingsSection } from '../../e2e/helpers/app.mjs'

test('Android wallpaper colors support fixed Material variants with readable text', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  await page.locator('.profileTrigger').waitFor()
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return { baseTheme: store.getters.getBaseTheme, currentLocale: store.getters.getCurrentLocale }
  })
  try {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'en-US')
      document.querySelector('.tutorialOverlay')?.remove()
    })
    if (await page.locator('.settingsWindow').isVisible()) {
      while (!await page.locator('.settingsMenu').isVisible()) await page.locator('.settingsBackButton').click()
    }
    const section = await goToSettingsSection(page, 'theme')
    for (const [theme, label] of [['materialLight', 'Material Light'], ['materialDark', 'Material Dark'], ['materialBlack', 'Material Black']]) {
      await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), theme)
      await expect(section.getByRole('combobox', { name: /^Base theme/i })).toHaveText(label)
      await expect(section.getByRole('button', { name: 'Material accent color' })).toHaveCount(0)
      await expect(page.locator('body')).toHaveClass(/dynamicColors/)
      const roles = await page.evaluate(() => {
        const probe = document.createElement('span')
        document.body.append(probe)
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        const read = property => {
          probe.style.color = `var(--${property})`
          return rgb(getComputedStyle(probe).color)
        }
        const colors = Object.fromEntries(['bg-color', 'card-bg-color', 'primary-text-color', 'secondary-text-color', 'accent-color', 'border-color', 'primary-color', 'text-with-main-color'].map(property => [property, read(property)]))
        probe.remove()
        return colors
      })
      const contrast = (first, second) => {
        const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
        const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b)
        return (high + 0.05) / (low + 0.05)
      }
      for (const bg of ['bg-color', 'card-bg-color']) {
        for (const fg of ['primary-text-color', 'secondary-text-color', 'accent-color']) assert.ok(contrast(roles[fg], roles[bg]) >= 4.5, `${theme}: ${fg} on ${bg}`)
        assert.ok(contrast(roles['border-color'], roles[bg]) >= 3, `${theme}: control boundary`)
      }
      assert.ok(contrast(roles['text-with-main-color'], roles['primary-color']) >= 4.5)
      if (theme === 'materialBlack') assert.deepEqual(roles['bg-color'], [0, 0, 0])
      const search = await page.locator('.settingsSearch input').evaluate(el => {
        const rgba = color => color.match(/[\d.]+/g).map(Number)
          .map((value, i) => color.startsWith('color(srgb ') && i < 3 ? value * 255 : value)
        const ancestors = []
        for (let parent = el; parent; parent = parent.parentElement) ancestors.unshift(parent)
        const background = ancestors.reduce((bg, parent) => {
          const channels = rgba(getComputedStyle(parent).backgroundColor)
          return channels.slice(0, 3).map((c, i) => c * (channels[3] ?? 1) + bg[i] * (1 - (channels[3] ?? 1)))
        }, [255, 255, 255])
        return { foreground: rgba(getComputedStyle(el, '::placeholder').color).slice(0, 3), background }
      })
      assert.ok(contrast(search.foreground, search.background) >= 4.5, `${theme}: search placeholder`)
      const background = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveCSS('background-color', background)
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: null })
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved)) await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
    }, saved)
    await browser.close()
  }
})
