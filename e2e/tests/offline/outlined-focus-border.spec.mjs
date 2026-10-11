import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { writeFile } from 'node:fs/promises'

async function expectEvenFocusBorder(app, page, field, outlineSelector) {
  await field.evaluate(element => element.blur())
  const restingLabel = await field.evaluate((element, outlineSelector) => {
    const bounds = element.parentElement.querySelector(`${outlineSelector} label`).getBoundingClientRect()
    return { x: bounds.x, y: bounds.y }
  }, outlineSelector)
  await field.focus()
  await expect(field).toBeFocused()
  // Wait for focus color transitions and the compositor before sampling pixels.
  await page.waitForTimeout(200)
  const geometry = await field.evaluate((element, { outlineSelector, restingLabel }) => {
    const bounds = element.getBoundingClientRect()
    const outline = element.parentElement.querySelector(outlineSelector)
    const color = getComputedStyle(outline).borderTopColor.match(/\d+/g).slice(0, 3).map(Number)
    const legend = outline.querySelector('legend').getBoundingClientRect()
    const label = outline.querySelector('label').getBoundingClientRect()
    if (Math.abs(label.x - restingLabel.x) > 0.1 || Math.abs(label.y - restingLabel.y) > 0.1) {
      throw new Error('The floating label moved when focusing the field')
    }
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      x: (legend.right + bounds.right) / 2,
      radius: parseFloat(getComputedStyle(outline).borderTopLeftRadius),
      color,
      pixelRatio: devicePixelRatio
    }
  }, { outlineSelector, restingLabel })
  // Playwright screenshots can use unzoomed coordinates in Electron. Sample
  // the actual framebuffer and convert CSS coordinates to physical pixels.
  const thicknesses = await app.electronApp.evaluate(async ({ BrowserWindow }, geometry) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    const { width } = image.getSize()
    const pixels = image.toBitmap()
    const scale = geometry.pixelRatio
    const matches = (x, y) => {
      const offset = (Math.round(y) * width + Math.round(x)) * 4
      return geometry.color.every((channel, index) => Math.abs(channel - pixels[offset + 2 - index]) < 40)
    }
    const vertical = edge => Array.from({ length: 13 }, (_, offset) => matches(geometry.x * scale, edge * scale + offset - 6)).filter(Boolean).length
    const horizontal = (edge, y) => Array.from({ length: 13 }, (_, offset) => matches(edge * scale + offset - 6, y * scale)).filter(Boolean).length
    // Native fieldsets reserve space above the painted border for the legend.
    // Sample every row along both straight sides, excluding rounded corners.
    const sides = []
    for (let y = geometry.top + geometry.radius + 1; y < geometry.bottom - geometry.radius - 1; y += 1 / scale) {
      sides.push(horizontal(geometry.left, y), horizontal(geometry.right, y))
    }
    return [vertical(geometry.top), vertical(geometry.bottom), ...sides]
  }, geometry)
  expect(Math.min(...thicknesses), JSON.stringify({ thicknesses, geometry })).toBeGreaterThanOrEqual(Math.floor(2 * geometry.pixelRatio))
  expect(Math.max(...thicknesses), JSON.stringify(thicknesses)).toBeLessThanOrEqual(Math.ceil(2 * geometry.pixelRatio))
  expect(Math.max(...thicknesses) - Math.min(...thicknesses), `top, bottom, side rows: ${thicknesses}`).toBeLessThanOrEqual(1)
}

for (const uiScale of [100, 95]) {
  test.describe(`outlined focus borders at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US', uiScale, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', mainColor: 'Red', secColor: 'Blue'
        }
      }
    })

    test('transcript search has equally thick borders around its label notch', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await page.route('https://example.test/transcript.vtt', route => route.fulfill({
        contentType: 'text/vtt', body: 'WEBVTT\n\n00:00.000 --> 00:10.000\nCraft a consistent outline.\n'
      }))
      await openMockedVideo(page)
      const video = await waitForPlayback(page)
      await video.evaluate(element => element.pause())
      const view = await watchViewHandle(page)
      await view.evaluate(async view => {
        view.captions = [{ url: 'https://example.test/transcript.vtt', label: 'English', language: 'en' }]
        view.showTranscript = true
        await view.$nextTick()
      })
      const card = page.locator('.transcriptCard')
      await expect(card.locator('.transcriptSegment')).toHaveCount(1)
      await card.getByRole('button', { name: 'Search transcript' }).click()
      const search = card.getByRole('searchbox', { name: 'Search transcript', exact: true })
      await search.fill('craft')
      for (const width of [1600, 640]) {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(theme))
          await search.focus()
          await search.evaluate(element => element.scrollIntoView({ block: 'center' }))
          await expectEvenFocusBorder(app, page, search, '.inputOutline')
          const header = await card.locator('.transcriptHeader').boundingBox()
          const field = await card.locator('.transcriptControls').boundingBox()
          const pixelRatio = await page.evaluate(() => devicePixelRatio)
          const clip = {
            x: Math.round((Math.min(header.x, field.x) - 4) * pixelRatio),
            y: Math.round((header.y - 4) * pixelRatio),
            width: Math.round((Math.max(header.x + header.width, field.x + field.width) - Math.min(header.x, field.x) + 8) * pixelRatio),
            height: Math.round((field.y + field.height - header.y + 8) * pixelRatio)
          }
          const capture = await app.electronApp.evaluate(async ({ BrowserWindow }, clip) =>
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).crop(clip).toPNG().toString('base64'), clip)
          await writeFile(testInfo.outputPath(`transcript-${width}-${theme}.png`), Buffer.from(capture, 'base64'))
        }
      }
      await view.dispose()
    })

    test('outlined dropdowns have equally thick keyboard and pointer focus borders', async ({ app, page }) => {
      const general = await goToSettingsSection(page, 'general')
      const select = general.getByRole('combobox', { name: 'Week Starts On' })
      for (const width of [1600, 640]) {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(theme))
          await page.keyboard.press('Tab')
          await select.focus()
          await select.evaluate(element => element.scrollIntoView({ block: 'center' }))
          await expect(select).toHaveJSProperty('disabled', false)
          await expectEvenFocusBorder(app, page, select, '.selectOutline')
          await select.blur()
          await select.click()
          await page.getByRole('option', { name: 'Monday', exact: true }).click()
          await expect(page.getByRole('listbox')).toHaveCount(0)
          expect(await select.evaluate(element => element.matches(':focus-visible'))).toBe(false)
          await expectEvenFocusBorder(app, page, select, '.selectOutline')
        }
      }
    })

    test('outlined dropdowns retain their high contrast ring after mouse selection', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ forcedColors: 'active' })
      const general = await goToSettingsSection(page, 'general')
      const select = general.getByRole('combobox', { name: 'Week Starts On' })
      const outline = select.locator('..').locator('.selectOutline')
      const ring = () => outline.evaluate(element => {
        const style = getComputedStyle(element)
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: style.outlineOffset, color: style.outlineColor }
      })
      for (const width of [1600, 640]) {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
        await select.evaluate(element => element.scrollIntoView({ block: 'center' }))
        await page.keyboard.press('Tab')
        await select.focus()
        expect(await select.evaluate(element => element.matches(':focus-visible'))).toBe(true)
        const keyboardRing = await ring()
        expect(keyboardRing.style).toBe('solid')
        const pixelRatio = await page.evaluate(() => devicePixelRatio)
        expect(Math.round(keyboardRing.width * pixelRatio)).toBeGreaterThanOrEqual(Math.floor(2 * pixelRatio))
        await select.blur()
        await select.click()
        await page.getByRole('option', { name: 'Monday', exact: true }).click()
        await expect(select).toBeFocused()
        expect(await select.evaluate(element => element.matches(':focus-visible'))).toBe(false)
        await expect(select).toHaveCSS('box-shadow', 'none')
        expect(await ring()).toEqual(keyboardRing)
        const clip = await outline.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          return {
            x: Math.floor((bounds.x - 6) * devicePixelRatio),
            y: Math.floor((bounds.y - 6) * devicePixelRatio),
            width: Math.ceil((bounds.width + 12) * devicePixelRatio),
            height: Math.ceil((bounds.height + 12) * devicePixelRatio)
          }
        })
        const capture = await app.electronApp.evaluate(async ({ BrowserWindow }, clip) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).crop(clip).toPNG().toString('base64'), clip)
        await writeFile(testInfo.outputPath(`select-forced-colors-${width}.png`), Buffer.from(capture, 'base64'))
      }
    })
  })
}
