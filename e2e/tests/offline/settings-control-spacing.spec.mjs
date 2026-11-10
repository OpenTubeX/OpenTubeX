import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
  await expect.poll(() => page.evaluate(({ width, uiScale }) => Math.abs(window.innerWidth - width * 100 / uiScale), { width, uiScale })).toBeLessThanOrEqual(1)
  // Let ResizeObserver switch the settings layout before selecting a category.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function openCategory(page, category) {
  if (await page.locator('.settingsWindow').isVisible() && !await page.locator(`.settingsMenu [data-section="${category}"]`).isVisible()) {
    await page.locator('.settingsBackButton').click()
  }
  return goToSettingsSection(page, category)
}

test.describe('settings control spacing', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        baseTheme: 'dark',
        useSponsorBlock: true,
        sponsorBlockEnableSubmission: true,
        bounds: { x: 0, y: 0, width: 1600, height: 1000, maximized: false }
      }
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 40, y: 40, width: 1400, height: 900 })))
  })

  test('General select columns leave enough room for their de-DE captions', async ({ app, page, uiScale }, testInfo) => {
    const locale = 'de-DE'
    const general = await goToSettingsSection(page, 'general')
    const content = page.locator('.settingsContent')
    await page.evaluate(locale => window.$store.dispatch('updateCurrentLocale', locale), locale)
    for (const width of [1000, 900, 801, 800, 650, 450, 800, 1000]) {
      await content.evaluate(element => { element.scrollTop = element.scrollHeight })
      // Keep a 480 CSS px viewport so the forced 450px content still fits at 125%.
      await resize(app, page, width === 450 ? Math.round(480 * uiScale / 100) : 1600, uiScale)
      await content.evaluate((element, width) => { element.style.inlineSize = `${width}px` }, width)
      for (const highlight of [false, true]) {
        await page.evaluate(value => window.$store.dispatch('updateHighlightChangedSettings', value), highlight)
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(value => { document.body.dir = value }, direction)
          const captions = await general.locator('.generalSelectGrid .select-placeholder').evaluateAll(elements => elements.map(element => {
            const field = element.closest('.select').querySelector('.select-text').getBoundingClientRect()
            const caption = element.getBoundingClientRect()
            const arrow = element.closest('.select').querySelector('.iconSelect').getBoundingClientRect()
            return {
              text: element.textContent,
              clipped: element.scrollWidth - element.clientWidth,
              outsideField: Math.max(field.left - caption.left, caption.right - field.right, field.left - arrow.left, arrow.right - field.right)
            }
          }))
          const widths = await general.locator('.generalSelectGrid .select-text').evaluateAll((elements, columns) => {
            const groups = Array.from({ length: columns }, () => [])
            elements.forEach((element, index) => groups[index % columns].push(element.getBoundingClientRect().width))
            return groups.map(group => Math.max(...group) - Math.min(...group))
          }, width > 800 ? 2 : 1)
          for (const difference of widths) expect.soft(difference, `${locale} ${width}px column field widths`).toBeLessThanOrEqual(0.1)
          for (const caption of captions) expect.soft(caption.clipped, `${locale} ${width}px ${caption.text}`).toBeLessThanOrEqual(1)
          for (const caption of captions) expect.soft(caption.outsideField, `${locale} ${width}px ${direction} ${caption.text} caption and arrow`).toBeLessThanOrEqual(1)
        }
      }
      await page.evaluate(() => { document.body.dir = 'ltr' })
      expect(await content.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await expect.poll(() => content.evaluate(element => {
        const section = element.querySelector(':scope > .section:not([style*="display: none"])')
        const maximum = Math.max(0, section.offsetTop + section.offsetHeight + Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
        return element.scrollTop <= maximum + 1
      })).toBe(true)
      if (uiScale === 100 && width === 1000) {
        await general.locator('.generalSelectGrid').scrollIntoViewIfNeeded()
        await captureAppFramebuffer(app, testInfo, `general-readable-captions-${locale}`)
      }
    }
  })

  test('channel settings searches span their subpage content at every width', async ({ app, page, uiScale }, testInfo) => {
    await page.evaluate(() => {
      const settings = window.$store.state.settings
      settings.channelPlaybackSpeeds = JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`UC${String(index).padStart(22, '0')}`, 1.25])))
    })
    for (const [category, name, selector] of [
      ['subscriptions', 'Subscription settings', '.channelSettingsHeader .ft-input-component'],
      ['playback', /Manage Saved Channels/, '.settingsSubpageContent .channelSearch']
    ]) {
      await resize(app, page, 1600, uiScale)
      const section = await openCategory(page, category)
      await section.getByRole('button', { name, exact: typeof name === 'string' }).click()
      const field = page.locator(selector)
      await expect(field).toBeVisible()
      for (const width of [1600, 480, 1600]) {
        await resize(app, page, width, uiScale)
        const gap = await field.evaluate(element => {
          const parent = element.parentElement
          const style = getComputedStyle(parent)
          return parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - element.getBoundingClientRect().width
        })
        expect.soft(Math.abs(gap), `${category} ${width}px unused search width`).toBeLessThanOrEqual(1)
        const scroller = page.locator(category === 'subscriptions' ? '.channelSettingsScroller' : '.channelListContainer')
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await field.locator('input').fill('No matching channel')
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(1)
        await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
        expect(await page.locator('.settingsSubpageContent').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await field.locator('input').clear()
        if (width === 480) await captureAppFramebuffer(app, testInfo, `${category}-full-width-search`)
      }
      await page.locator('.settingsBackButton').click()
    }
  })

  test('theme rows use two columns before stacking and keep a valid scroll range after reflow', async ({ app, page, uiScale }, testInfo) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await page.evaluate(() => window.$store.dispatch('updateBaseTheme', 'system'))
    const theme = appearance.locator('.settingsSection').first()
    const rows = theme.locator('.themeSelectRow')
    await expect(rows).toHaveCount(1)
    const content = page.locator('.settingsContent')
    for (const locale of ['en-US', 'de-DE']) {
      await page.evaluate(locale => window.$store.dispatch('updateCurrentLocale', locale), locale)
      for (const width of [900, 650, 400, 650, 900]) {
        await content.evaluate(element => { element.scrollTop = element.scrollHeight })
        await resize(app, page, width === 400 ? 480 : 1600, uiScale)
        await content.evaluate((element, width) => { element.style.inlineSize = `${width}px` }, width)
        for (const row of await rows.all()) {
          const geometry = await row.evaluate(element => {
            const rows = new Map()
            for (const select of element.querySelectorAll('.select-text')) {
              const bounds = select.getBoundingClientRect()
              const row = rows.get(Math.round(bounds.top)) ?? { top: bounds.top, bottom: bounds.bottom, count: 0 }
              row.count++
              row.bottom = Math.max(row.bottom, bounds.bottom)
              rows.set(Math.round(bounds.top), row)
            }
            const sorted = [...rows.values()].sort((a, b) => a.top - b.top)
            return { columns: sorted.map(row => row.count), gaps: sorted.slice(1).map((row, index) => row.top - sorted[index].bottom) }
          })
          const count = await row.locator('.select-text').count()
          const columns = width === 900 ? count : width === 650 ? 2 : 1
          expect.soft(geometry.columns[0], `${locale} ${width}px columns`).toBe(columns)
          for (const gap of geometry.gaps) expect.soft(gap, `${locale} ${width}px gap`).toBeCloseTo(20, 1)
        }
        await expect.poll(() => content.evaluate(element => {
          const section = element.querySelector(':scope > .section:not([style*="display: none"])')
          const maximum = Math.max(0, section.offsetTop + section.offsetHeight + Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
          const scrollbar = element.querySelector('.os-scrollbar-vertical')
          if (maximum <= 1) return element.scrollTop <= 1 && scrollbar.classList.contains('os-scrollbar-unusable')
          const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
          const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
          return element.scrollTop <= maximum + 1 && Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
        })).toBe(true)
        expect(await content.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        if (locale === 'en-US' && uiScale === 100 && width === 650) {
          await rows.first().scrollIntoViewIfNeeded()
          await captureAppFramebuffer(app, testInfo, 'theme-two-columns')
        }
      }
    }
  })
})
