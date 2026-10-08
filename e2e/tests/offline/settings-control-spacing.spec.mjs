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

for (const uiScale of [100, 95]) {
  test.describe(`settings control spacing at ${uiScale}% scale`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US',
          baseTheme: 'dark',
          uiScale,
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

    test('switch help stays beside wrapped labels and all tracks align', async ({ app, page }, testInfo) => {
      const section = await goToSettingsSection(page, 'general')
      const grid = section.locator('.switchFlowGrid')
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
        for (const viewportWidth of [480, 1600]) {
          await resize(app, page, viewportWidth, uiScale)
          for (const width of [400, 300, 650, 400]) {
            await section.evaluate((element, width) => { element.parentElement.style.inlineSize = `${width}px` }, width)
            const geometry = await grid.evaluate(element => [...element.querySelectorAll('.switch-ctn')].map(toggle => {
              const text = toggle.querySelector('.switch-label-text')
              const bounds = text.getBoundingClientRect()
              const track = getComputedStyle(text, '::before')
              const help = toggle.querySelector('.tooltip')?.getBoundingClientRect()
              return {
                trackStart: bounds.left + parseFloat(track.left),
                helpOffset: help ? help.top + help.height / 2 - bounds.top - bounds.height / 2 : null,
                helpWidth: help?.width,
                overflow: toggle.scrollWidth - toggle.clientWidth
              }
            }))
            expect.soft(Math.max(...geometry.map(item => item.trackStart)) - Math.min(...geometry.map(item => item.trackStart)), `${locale} ${viewportWidth}/${width}px track alignment`).toBeLessThanOrEqual(1)
            for (const item of geometry) {
              expect.soft(item.overflow).toBeLessThanOrEqual(1)
              if (item.helpOffset !== null) {
                expect.soft(Math.abs(item.helpOffset), `${locale} ${viewportWidth}/${width}px help alignment`).toBeLessThanOrEqual(1)
                // Fractional zoom can round a 24px control slightly below 24.
                expect.soft(item.helpWidth).toBeGreaterThanOrEqual(23.9)
              }
            }
          }
        }
      }
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateCurrentLocale', 'en-US')
        await store.dispatch('updateBaseTheme', 'system')
      })
      await resize(app, page, 480, uiScale)
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
        await grid.scrollIntoViewIfNeeded()
        await captureAppFramebuffer(app, testInfo, `switch-labels-${colorScheme}`)
      }
    })

    test('appearance switches flow across rows in the reading direction', async ({ app, page }, testInfo) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      const grid = appearance.locator('.switchColumnGrid').first()
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
        for (const width of [1000, 800, 650, 400, 1000]) {
          await resize(app, page, width === 400 ? 480 : 1600, uiScale)
          await appearance.evaluate((element, width) => { element.parentElement.style.inlineSize = `${width}px` }, width)
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(direction => { document.body.dir = direction }, direction)
            const bounds = await grid.locator('.switch-ctn').evaluateAll(elements => elements.map(element => {
              const rect = element.getBoundingClientRect()
              return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, overflow: element.scrollWidth - element.clientWidth }
            }))
            expect(bounds.length).toBeGreaterThan(1)
            for (let index = 1; index < bounds.length; index++) {
              const previous = bounds[index - 1]
              const current = bounds[index]
              if (width > 680 && index % 2 === 1) {
                expect(Math.abs(current.top - previous.top), `${locale} ${width}px ${direction} row ${index}`).toBeLessThanOrEqual(1)
                expect(direction === 'rtl' ? previous.left - current.right : current.left - previous.right).toBeGreaterThanOrEqual(0)
              } else {
                expect(current.top - previous.bottom).toBeGreaterThanOrEqual(-1)
                expect(Math.abs(direction === 'rtl' ? current.right - bounds[0].right : current.left - bounds[0].left)).toBeLessThanOrEqual(1)
              }
              expect(current.overflow).toBeLessThanOrEqual(1)
            }
            if (locale === 'en-US' && uiScale === 100 && width === 1000) {
              await grid.evaluate(element => {
                const content = element.closest('.settingsContent')
                const section = element.closest('.settingsSection')
                content.scrollTop += section.getBoundingClientRect().top - content.getBoundingClientRect().top - 20
              })
              await captureAppFramebuffer(app, testInfo, `appearance-switch-flow-${direction}`)
            }
          }
        }
      }
    })

    test('tab width has a full slider and its icon action aligns with the row', async ({ app, page }, testInfo) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      const row = appearance.locator('.tabSettingsRow')
      const content = page.locator('.settingsContent')
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
        for (const width of [1000, 800, 650, 400, 1000]) {
          await content.evaluate(element => { element.scrollTop = element.scrollHeight })
          await resize(app, page, width === 400 ? 480 : 1600, uiScale)
          await content.evaluate((element, width) => { element.style.inlineSize = `${width}px` }, width)
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(direction => { document.body.dir = direction }, direction)
            const geometry = await row.evaluate(element => {
              const row = element.getBoundingClientRect()
              const slider = element.querySelector('.pure-material-slider').getBoundingClientRect()
              const button = element.querySelector('.btn').getBoundingClientRect()
              const style = getComputedStyle(element)
              const container = element.closest('.settingsContent')
              const containerStyle = getComputedStyle(container)
              return {
                width: slider.width,
                availableWidth: row.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                containerWidth: container.clientWidth - parseFloat(containerStyle.paddingLeft) - parseFloat(containerStyle.paddingRight),
                centerOffset: button.top + button.height / 2 - slider.top - slider.height / 2,
                gap: button.top - slider.bottom,
                horizontalOffset: button.left + button.width / 2 - row.left - row.width / 2,
                overflow: element.scrollWidth - element.clientWidth
              }
            })
            expect.soft(geometry.width, `${locale} ${width}px ${direction} slider width`).toBeCloseTo(Math.min(380, geometry.availableWidth), 0)
            if (geometry.containerWidth > 760) {
              expect.soft(Math.abs(geometry.centerOffset), `${locale} ${width}px ${direction} action alignment`).toBeLessThanOrEqual(1)
            } else {
              expect.soft(geometry.gap).toBeCloseTo(20, 1)
              expect.soft(Math.abs(geometry.horizontalOffset)).toBeLessThanOrEqual(1)
            }
            expect(geometry.overflow).toBeLessThanOrEqual(1)
            if (locale === 'en-US' && uiScale === 100 && [800, 400].includes(width)) {
              await row.scrollIntoViewIfNeeded()
              await captureAppFramebuffer(app, testInfo, `tab-settings-${width}-${direction}`)
            }
          }
          await expect.poll(() => content.evaluate(element => {
            const section = element.querySelector(':scope > .section:not([style*="display: none"])')
            const maximum = Math.max(0, section.offsetTop + section.offsetHeight + Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
            return element.scrollTop <= maximum + 1
          })).toBe(true)
        }
      }
    })

    test('download controls keep equal empty space after buttons and helper text', async ({ app, page }, testInfo) => {
      const section = await goToSettingsSection(page, 'download')
      for (const width of [1000, 450]) {
        await resize(app, page, width === 1000 ? 1600 : 480, uiScale)
        await section.evaluate((element, width) => { element.parentElement.style.inlineSize = `${width}px` }, width)
        const gaps = await section.evaluate(element => {
          const actions = element.querySelector('.downloadActions').getBoundingClientRect()
          const fields = [...element.querySelectorAll('.downloadPathInputs .ft-input-component')]
          const lastEdge = field => (field.querySelector('.supportingText') ?? field.querySelector('input')).getBoundingClientRect().bottom
          const inputBounds = fields.map(field => field.querySelector('input').getBoundingClientRect())
          const select = element.querySelector('.downloadQueueInputs .select-text').getBoundingClientRect()
          const bandwidth = element.querySelector('.downloadQueueInputs input').getBoundingClientRect()
          const stacked = inputBounds[1].top > inputBounds[0].bottom
          return {
            buttonGap: inputBounds[0].top - actions.bottom,
            fieldGap: stacked ? inputBounds[1].top - lastEdge(fields[0]) : null,
            queueGap: select.top - Math.max(...fields.map(lastEdge)),
            queueFieldGap: bandwidth.top > select.bottom ? bandwidth.top - select.bottom : null
          }
        })
        expect.soft(gaps.buttonGap).toBeCloseTo(20, 1)
        for (const key of ['fieldGap', 'queueGap', 'queueFieldGap']) {
          if (gaps[key] !== null) expect.soft(gaps[key], `${width}px ${key}`).toBeCloseTo(gaps.buttonGap, 1)
        }
        await captureAppFramebuffer(app, testInfo, `download-spacing-${width}`)
      }
    })

    test('switches retain the same empty space when their grid becomes one column', async ({ app, page }) => {
      for (const [category, selector] of [['playback', '.playerSwitchGrid'], ['general', '.switchFlowGrid']]) {
        await resize(app, page, 1600, uiScale)
        const section = await goToSettingsSection(page, category)
        const grid = section.locator(selector).first()
        const measure = () => grid.evaluate(element => {
          const rows = new Map()
          for (const toggle of element.querySelectorAll('.switch-ctn')) {
            if (getComputedStyle(toggle).display === 'none') continue
            const bounds = toggle.querySelector('.switch-label').getBoundingClientRect()
            const center = Math.round(bounds.top + bounds.height / 2)
            const row = rows.get(center)
            rows.set(center, { top: Math.min(row?.top ?? Infinity, bounds.top), bottom: Math.max(row?.bottom ?? -Infinity, bounds.bottom) })
          }
          const sorted = [...rows.values()].sort((a, b) => a.top - b.top)
          return sorted.slice(1).map((row, index) => row.top - sorted[index].bottom)
        })
        await section.evaluate(element => { element.parentElement.style.inlineSize = '1000px' })
        const wideGaps = await measure()
        expect(wideGaps.length).toBeGreaterThan(0)
        await resize(app, page, 480, uiScale)
        await section.evaluate(element => { element.parentElement.style.inlineSize = '450px' })
        const narrowGaps = await measure()
        for (const gap of narrowGaps) expect.soft(gap, `${category} stacked gap`).toBeCloseTo(wideGaps[0], 1)
      }
    })

    test('API and private ID fields center their outlines and tag labels blend into their panel', async ({ app, page }, testInfo) => {
      const section = await goToSettingsSection(page, 'add-ons')
      for (const [width, viewportWidth] of [[1000, 1600], [450, 480], [360, 480], [360, 1600]]) {
        await resize(app, page, viewportWidth, uiScale)
        await section.evaluate((element, width) => { element.parentElement.style.inlineSize = `${width}px` }, width)
        for (const highlightChangedSettings of [false, true]) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateHighlightChangedSettings', value), highlightChangedSettings)
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(value => { document.body.dir = value }, direction)
            for (const name of ['SponsorBlock API URL', 'Private user ID (optional)']) {
              const input = section.getByLabel(name, { exact: true })
              const offset = await input.evaluate(element => {
                const field = element.getBoundingClientRect()
                const row = element.closest('.ft-flex-box').getBoundingClientRect()
                return field.left + field.width / 2 - row.left - row.width / 2
              })
              expect.soft(Math.abs(offset), `${width}px ${direction} ${name}`).toBeLessThanOrEqual(1)
              const toggle = input.locator('../..').locator('.passwordVisibilityToggle')
              if (await toggle.count()) {
                const geometry = await input.evaluate(element => {
                  const field = element.getBoundingClientRect()
                  const eye = element.parentElement.querySelector('.passwordVisibilityToggle').getBoundingClientRect()
                  return {
                    centerOffset: Math.abs(eye.top + eye.height / 2 - field.top - field.height / 2),
                    inside: eye.top >= field.top && eye.bottom <= field.bottom
                  }
                })
                expect.soft(geometry.centerOffset, `${width}px ${direction} eye center`).toBeLessThanOrEqual(1)
                expect.soft(geometry.inside, `${width}px ${direction} eye containment`).toBe(true)
              }
              const label = input.locator('../..').locator('.selectLabelText')
              expect.soft(await label.evaluate(element => element.scrollWidth - element.clientWidth), `${width}px ${direction} ${name} label`).toBeLessThanOrEqual(1)
            }
          }
        }
        await page.evaluate(() => { document.body.dir = 'ltr' })
        const label = section.locator('.ft-input-tags-component .selectLabel').first()
        const colors = await label.evaluate(element => ({
          label: getComputedStyle(element).backgroundColor,
          panel: getComputedStyle(element.closest('.ft-input-tags-component')).backgroundColor
        }))
        expect.soft(colors.label).toBe(colors.panel)
        await section.getByLabel('Private user ID (optional)', { exact: true }).scrollIntoViewIfNeeded()
        await captureAppFramebuffer(app, testInfo, `sponsorblock-spacing-${width}-${viewportWidth}`)
      }
    })

    test('settings selects, sliders and Add-ons keep a common gap when rows wrap', async ({ app, page }, testInfo) => {
      for (const width of [1000, 450]) {
        await resize(app, page, width === 1000 ? 1600 : 480, uiScale)
        const general = await openCategory(page, 'general')
        await general.evaluate((element, width) => { element.parentElement.style.inlineSize = `${width}px` }, width)
        const selectGaps = await general.locator('.generalSelectGrid').evaluate(element => {
          const rows = new Map()
          for (const select of element.querySelectorAll('.select-text')) {
            const rect = select.getBoundingClientRect()
            rows.set(Math.round(rect.top), rect)
          }
          const sorted = [...rows.values()].sort((a, b) => a.top - b.top)
          return sorted.slice(1).map((rect, index) => rect.top - sorted[index].bottom)
        })
        for (const gap of selectGaps) expect.soft(gap, `${width}px general selects`).toBeCloseTo(20, 1)
        const privacy = await openCategory(page, 'privacy')
        const mixedGaps = await privacy.locator('.settingsSection').first().evaluate(element => {
          const select = element.querySelector('.privacyExternalLinkSelect .select-text').getBoundingClientRect()
          const slider = element.querySelector('.pure-material-slider').getBoundingClientRect()
          const progress = element.querySelector('.ft-flex-box .select-text').getBoundingClientRect()
          return [slider.top - select.bottom, progress.top - slider.bottom]
        })
        for (const gap of mixedGaps) expect.soft(gap, `${width}px privacy select/slider`).toBeCloseTo(20, 1)
        const addons = await openCategory(page, 'add-ons')
        const addonGaps = await addons.locator('.settingsSection').first().evaluate(element => {
          const rows = new Map()
          for (const label of element.querySelectorAll('.settingsFlexStart500px .switch-label')) {
            const rect = label.getBoundingClientRect()
            const row = rows.get(Math.round(rect.top))
            rows.set(Math.round(rect.top), { top: rect.top, bottom: Math.max(row?.bottom ?? 0, rect.bottom) })
          }
          const sorted = [...rows.values()].sort((a, b) => a.top - b.top)
          return sorted.slice(1).map((rect, index) => rect.top - sorted[index].bottom)
        })
        for (const gap of addonGaps) expect.soft(gap, `${width}px Add-ons switches`).toBeCloseTo(20, 1)
        await captureAppFramebuffer(app, testInfo, `unified-addons-${width}`)
      }
    })

    test('General select columns leave enough room for their captions', async ({ app, page }, testInfo) => {
      const general = await goToSettingsSection(page, 'general')
      const content = page.locator('.settingsContent')
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
        for (const width of [1000, 900, 801, 800, 650, 450, 800, 1000]) {
          await content.evaluate(element => { element.scrollTop = element.scrollHeight })
          await resize(app, page, width === 450 ? 480 : 1600, uiScale)
          await content.evaluate((element, width) => { element.style.inlineSize = `${width}px` }, width)
          for (const highlight of [false, true]) {
            await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateHighlightChangedSettings', value), highlight)
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
          if (uiScale === 100 && ((locale === 'en-US' && width === 650) || (locale === 'de-DE' && width === 1000))) {
            await general.locator('.generalSelectGrid').scrollIntoViewIfNeeded()
            await captureAppFramebuffer(app, testInfo, `general-readable-captions-${locale}`)
          }
        }
      }
    })

    test('a stacked toast position puts its test button on a separate row', async ({ app, page }, testInfo) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      const content = page.locator('.settingsContent')
      const row = appearance.locator('.themeSelectRow').first()
      for (const width of [650, 540, 500, 400, 650]) {
        await content.evaluate(element => { element.scrollTop = element.scrollHeight })
        await resize(app, page, width === 400 ? 480 : 1600, uiScale)
        await content.evaluate((element, width) => { element.style.inlineSize = `${width}px` }, width)
        const geometry = await row.evaluate(element => {
          const selects = [...element.querySelectorAll('.select-text')].map(select => select.getBoundingClientRect())
          const button = element.querySelector('.testToastButton').getBoundingClientRect()
          return {
            columns: selects.filter(select => Math.abs(select.top - selects[0].top) < 1).length,
            gap: button.top - selects.at(-1).bottom,
            center: button.left + button.width / 2 - element.getBoundingClientRect().left - element.getBoundingClientRect().width / 2
          }
        })
        expect(geometry.columns).toBe(width === 650 ? 2 : 1)
        if (width <= 540) {
          expect.soft(geometry.gap).toBeCloseTo(20, 1)
          expect.soft(Math.abs(geometry.center)).toBeLessThanOrEqual(1)
        }
        expect(await content.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await expect.poll(() => content.evaluate(element => {
          const section = element.querySelector(':scope > .section:not([style*="display: none"])')
          const maximum = Math.max(0, section.offsetTop + section.offsetHeight + Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
          const scrollbar = element.querySelector('.os-scrollbar-vertical')
          const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
          const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
          return element.scrollTop <= maximum + 1 && Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
        })).toBe(true)
        if (width === 540) {
          await row.scrollIntoViewIfNeeded()
          await captureAppFramebuffer(app, testInfo, 'stacked-toast-action')
        }
      }
    })

    test('channel settings searches span their subpage content at every width', async ({ app, page }, testInfo) => {
      await page.evaluate(() => {
        const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
        settings.channelPlaybackSpeeds = JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`UC${String(index).padStart(22, '0')}`, 1.25])))
      })
      for (const [category, name, selector] of [
        ['subscriptions', 'Subscription settings', '.channelSettingsHeader .ft-input-component'],
        ['playback', /Manage Saved Channels/, '.settingsSubpageContent .channelSearch']
      ]) {
        await resize(app, page, 1600, uiScale)
        const section = await openCategory(page, category)
        await section.getByRole('button', { name }).click()
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

    test('theme rows use two columns before stacking and keep a valid scroll range after reflow', async ({ app, page }, testInfo) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'system'))
      const theme = appearance.locator('.settingsSection').first()
      const rows = theme.locator('.themeSelectRow')
      await expect(rows).toHaveCount(3)
      const content = page.locator('.settingsContent')
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
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

    test('settings slider grids and theme selects keep the same gap when stacked', async ({ app, page }) => {
      for (const width of [1000, 450]) {
        await resize(app, page, width === 1000 ? 1600 : 480, uiScale)
        for (const [category, selector, control] of [
          ['playback', '.sliderGrid', '.pure-material-slider'],
          ['appearance', '.themeSelectRow', '.select-text']
        ]) {
          const section = await openCategory(page, category)
          await section.evaluate((element, width) => { element.parentElement.style.inlineSize = `${width}px` }, width)
          const grids = section.locator(selector)
          expect(await grids.count()).toBeGreaterThan(0)
          let stackedGaps = 0
          for (const grid of await grids.all()) {
            const gaps = await grid.evaluate((element, control) => {
              const rows = new Map()
              for (const field of element.querySelectorAll(control)) {
                const rect = field.getBoundingClientRect()
                const row = rows.get(Math.round(rect.top))
                rows.set(Math.round(rect.top), { top: rect.top, bottom: Math.max(row?.bottom ?? 0, rect.bottom) })
              }
              const sorted = [...rows.values()].sort((a, b) => a.top - b.top)
              return sorted.slice(1).map((rect, index) => rect.top - sorted[index].bottom)
            }, control)
            stackedGaps += gaps.length
            for (const gap of gaps) expect.soft(gap, `${width}px ${category}`).toBeCloseTo(20, 1)
          }
          if (width === 450) expect(stackedGaps).toBeGreaterThan(0)
        }
      }
    })

    test('bounds interval selects and reduces the gap before block lists', async ({ app, page }, testInfo) => {
      const section = await goToSettingsSection(page, 'subscriptions')
      await section.evaluate(element => { element.parentElement.style.inlineSize = '650px' })
      for (const select of await section.locator('.autoRefreshIntervals .select-text').all()) {
        expect.soft((await select.boundingBox()).width).toBeLessThanOrEqual(340)
      }
      const gaps = await section.locator('.autoRefreshIntervals .select-text').evaluateAll(elements => {
        const bounds = elements.map(element => element.getBoundingClientRect())
        return bounds.slice(1).map((rect, index) => rect.top - bounds[index].bottom)
      })
      for (const gap of gaps) expect.soft(gap, 'refresh intervals').toBeCloseTo(20, 1)
      await captureAppFramebuffer(app, testInfo, 'bounded-refresh-intervals')
      await resize(app, page, 480, uiScale)
      const focus = await openCategory(page, 'focus')
      const gap = await focus.getByRole('checkbox', { name: 'Enable block lists', exact: true }).evaluate(element => {
        const label = element.nextElementSibling.getBoundingClientRect()
        const previous = element.closest('.ft-flex-box').previousElementSibling
        const grid = previous.matches('.switchColumnGrid') ? previous : previous.previousElementSibling
        return label.top - Math.max(...[...grid.querySelectorAll('.switch-label')].map(label => label.getBoundingClientRect().bottom))
      })
      expect.soft(gap).toBeLessThanOrEqual(20.1)
    })

    test('keeps password eyes smaller on desktop while preserving mobile size', async ({ app, page }) => {
      const section = await goToSettingsSection(page, 'privacy')
      const toggle = section.locator('.passwordVisibilityToggle')
      expect(await toggle.evaluate(element => getComputedStyle(element).fontSize)).toBe('20px')
      await resize(app, page, 480, uiScale)
      await expect(toggle).toHaveCSS('font-size', '24px')
      expect(await toggle.evaluate(element => parseFloat(getComputedStyle(element).width))).toBeCloseTo(48, 1)
    })
  })
}
