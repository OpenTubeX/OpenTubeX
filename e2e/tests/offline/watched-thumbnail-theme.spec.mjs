import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const label = 'Watched thumbnail overlay'
const entries = [true, false].map((isWatched, index) => ({
  _id: index === 0 ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb',
  videoId: index === 0 ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb',
  title: isWatched ? 'Watched sample' : 'Unwatched sample',
  author: 'Sample channel',
  authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
  published: Date.now() - 86_400_000,
  viewCount: 1234,
  lengthSeconds: 120,
  watchProgress: 30,
  isWatched,
  timeWatched: Date.now() - index * 1000,
  isLive: false,
  type: 'video',
}))

test.use({
  seed: {
    settings: { currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
    history: entries,
  },
})

async function expectOverlay(link, color, opacity = '1') {
  await expect.poll(() => link.evaluate((element, color) => {
    // Compare rendered RGBA values across hex, color-mix and relative RGB serialization.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    const rgba = value => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    }
    const style = getComputedStyle(element, '::after')
    const actual = rgba(style.backgroundColor)
    const expected = rgba(color)
    return { colorMatches: actual.every((value, index) => value === expected[index]), opacity: style.opacity }
  }, color)).toEqual({ colorMatches: true, opacity })
}

async function setOverlay(page, color) {
  await page.getByRole('button', { name: label, exact: true }).click()
  const picker = page.getByRole('dialog', { name: label })
  const hex = picker.getByRole('textbox', { name: 'Hex color' })
  await hex.fill(color)
  await hex.press('Enter')
  await picker.getByRole('button', { name: 'Apply', exact: true }).click()
}

for (const scheme of ['dark', 'light']) {
  test(`customizes watched thumbnail color and opacity in ${scheme} mode`, async ({ app, page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'history')
    const watched = page.locator('.ft-list-video').filter({ hasText: /Watched sample/ })
    const unwatched = page.locator('.ft-list-video').filter({ hasText: 'Unwatched sample' })
    const link = watched.locator('.thumbnailLink')
    await expect(watched).toHaveClass(/watched/)
    await expectImagesLoaded(page.locator('.thumbnailImage'))
    await page.mouse.move(0, 0)
    await expect(watched.locator('.thumbnailImage')).toHaveCSS('opacity', '1')
    expect(await unwatched.locator('.thumbnailLink').evaluate(element => getComputedStyle(element, '::after').content)).toBe('none')

    const baseColor = scheme === 'dark' ? '#0f0f0fb3' : '#f1f1f1b3'
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const field = page.getByRole('button', { name: label, exact: true })
    await expect(field.locator('code')).toHaveText(baseColor)
    await field.click()
    const picker = page.getByRole('dialog', { name: label })
    const hex = picker.getByRole('textbox', { name: 'Hex color' })
    await hex.fill('#33669980')
    await hex.press('Enter')
    await expect(page.locator('body')).toHaveCSS('--watched-thumbnail-overlay-color', '#33669980')
    const opacity = picker.getByRole('slider', { name: /Opacity/ })
    await opacity.focus()
    await opacity.press('Home')
    await expect(page.locator('body')).toHaveCSS('--watched-thumbnail-overlay-color', '#33669900')
    await opacity.press('End')
    await expect(page.locator('body')).toHaveCSS('--watched-thumbnail-overlay-color', '#336699')
    await hex.fill('#33669980')
    await hex.press('Enter')
    await picker.screenshot({ path: testInfo.outputPath(`watched-overlay-picker-${scheme}.png`) })
    await picker.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.getByRole('button', { name: 'Save and apply' }).click()
    const [saved] = await page.evaluate(() => window.ftElectron.loadCustomTheme())
    expect(saved.colors.watchedThumbnailOverlay).toBe('#33669980')
    await page.locator('.settingsCloseButton').click()
    await page.mouse.move(0, 0)
    await expectOverlay(link, '#33669980')
    await link.focus()
    await expectOverlay(link, '#33669980', '0')
    await link.evaluate(element => element.blur())
    await expectOverlay(link, '#33669980')
    await watched.screenshot({ path: testInfo.outputPath(`watched-overlay-${scheme}.png`) })
    await link.hover()
    await expectOverlay(link, '#33669980', '0')
    await page.mouse.move(0, 0)
    await expectOverlay(link, '#33669980')

    // The same thumbnail styling applies in list mode, at fractional UI scale,
    // and in the narrow responsive layout.
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateListType', 'list')
      await window.ftElectron.setZoomFactor(1.25)
    })
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ ...window.getBounds(), width: 500 })
    })
    await expect(watched).toHaveClass(/list/)
    await expectOverlay(link, '#33669980')
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))

    // Settings retains the Appearance category; its sidebar is hidden here.
    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await expect(field.locator('code')).toHaveText('#33669980')
    await setOverlay(page, '#ff880000')
    await page.getByRole('button', { name: 'Discard changes' }).click()
    await expect(field.locator('code')).toHaveText('#33669980')
    await page.getByRole('button', { name: 'Reset to base theme' }).click()
    await expect(field.locator('code')).toHaveText(baseColor)
    await setOverlay(page, '#ff880000')
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await page.locator('.settingsCloseButton').click()
    await page.mouse.move(0, 0)
    await expectOverlay(link, '#ff880000')
    await expect(watched.locator('.videoWatched')).toBeVisible()

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', 'system')
    })
    expect(await page.locator('body').evaluate(element => element.style.getPropertyValue('--watched-thumbnail-overlay-color'))).toBe('')
    await expectOverlay(link, baseColor)
  })
}

test('sets the default watched overlay alpha independently of page background transparency', async ({ page }) => {
  await goTo(page, 'history')
  const link = page.locator('.ft-list-video.watched .thumbnailLink')
  await page.mouse.move(0, 0)
  for (const background of ['#12345680', '#12345600']) {
    await page.locator('body').evaluate((element, color) => element.style.setProperty('--bg-color', color), background)
    await expectOverlay(link, '#123456b3')
  }
})
