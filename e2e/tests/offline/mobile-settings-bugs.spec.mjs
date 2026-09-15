import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

const getMidWordLineBreaks = locator => locator.evaluateAll(elements => elements.flatMap(element => {
  const characters = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode()) !== null) {
    for (let index = 0; index < node.data.length; index++) {
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      characters.push({ character: node.data[index], top: range.getBoundingClientRect().top })
    }
  }
  return characters.slice(1).flatMap((current, index) => {
    const previous = characters[index]
    return /\p{L}/u.test(previous.character) && /\p{L}/u.test(current.character) &&
      Math.abs(previous.top - current.top) > 1
      ? [`${element.textContent.trim().replaceAll(/\s+/g, ' ')}: ${previous.character}|${current.character}`]
      : []
  })
}))

for (const uiScale of [100, 125]) {
  test.describe(`mobile settings regressions at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, useQuickPlaybackSpeedBar: true, defaultViewingMode: 'theater' } } })

    test('keeps speed name and delete beside the drag handle', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      const section = await goToSettingsSection(page, 'playback')
      await section.getByRole('button', { name: 'Customize Quick Playback Speed Bar' }).click()
      const row = page.locator('.quickPlaybackSpeedEntry').first()
      const center = selector => row.locator(selector).evaluate(el => {
        const rect = el.getBoundingClientRect()
        return rect.top + rect.height / 2
      })
      expect(Math.abs(await center('.quickPlaybackSpeedDragHandle') - await center('.quickPlaybackSpeedNameRow'))).toBeLessThan(2)
      expect(Math.abs(await center('.quickPlaybackSpeedDragHandle') - await center('.delete'))).toBeLessThan(2)
    })

    for (const sectionName of ['playback', 'subscription']) {
      test(`leaves room between ${sectionName} selects and their help icons`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        const section = await goToSettingsSection(page, sectionName)
        const selects = section.locator('.select.containsTooltip')
        await expect(selects.first()).toBeVisible()
        expect(await selects.evaluateAll(elements => elements.every(el => {
          const help = el.querySelector('.selectTooltip').getBoundingClientRect()
          const select = el.querySelector('.select-text').getBoundingClientRect()
          const style = getComputedStyle(el)
          const contentWidth = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          return Math.abs(select.width - (contentWidth - 70)) < 1 && help.left - select.right >= 15.75 && help.left - select.right <= 17
        }))).toBe(true)
      })
    }

    test('centers caption help with a multiline switch label', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      const captions = await goToSettingsSection(page, 'playback')
      const label = captions.locator('.captionControls .switch-label').filter({ has: page.locator('.tooltip') }).first()
      await label.locator('.switch-label-text').evaluate(el => { el.textContent = 'A long translated switch label that takes several lines' })
      expect(await label.evaluate(el => {
        const label = el.getBoundingClientRect()
        const help = el.querySelector('.tooltip').getBoundingClientRect()
        return Math.abs(label.top + label.height / 2 - help.top - help.height / 2)
      })).toBeLessThan(2)
    })

    test('wraps long storage size descriptions while loading and after loading', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      const section = await goToSettingsSection(page, 'storage')
      const sizes = section.locator('.storageSize')
      await expect(sizes.first()).toBeVisible()
      for (const text of ['Speichernutzung wird berechnet…', 'In den oben angezeigten Anwendungsdaten enthalten']) {
        await sizes.evaluateAll((elements, text) => elements.forEach(el => { el.textContent = text }), text)
        expect(await sizes.evaluateAll(elements => elements.every(el => {
          const item = el.closest('.storageItem').getBoundingClientRect()
          const size = el.getBoundingClientRect()
          return size.right <= item.right && el.scrollWidth <= el.clientWidth + 1
        }))).toBe(true)
      }
    })
  })
}

test('keeps a translated sync percentage together', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  const section = await goToSettingsSection(page, 'sync')
  await section.locator('.switch-label').filter({ hasText: 'Enable Sync' }).click()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSyncServerStatus', 'syncing')
    store.commit('setSyncServerProgress', { stage: 'download', percentage: 100 })
  })
  const label = section.locator('.syncProgressLabel')
  await expect(label).toBeVisible()
  await label.locator('span').first().evaluate(el => { el.textContent = 'Verschlüsselte Synchronisierungsdaten werden heruntergeladen…' })
  const percent = label.locator('span').last()
  await percent.evaluate(el => { el.textContent = '100 %' })
  expect(await percent.evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(2)
})

test('storage chart labels stay readable while sizes are calculating on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 461, height: 1026 })
  const storage = await goToSettingsSection(page, 'storage')
  await storage.locator('.storageBreakdownDetails strong').evaluateAll(elements => elements.forEach(el => { el.textContent = 'Speichernutzung wird berechnet…' }))
  expect(await storage.locator('.storageLegendLabel > span:first-child').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().width >= 100))).toBe(true)
  expect(await storage.locator('.storageBreakdown').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})

test.describe('German playback settings on a narrow screen', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'de-DE',
        useQuickPlaybackSpeedBar: true
      }
    }
  })

  test('keeps the back button and quick-speed breadcrumb on one row', async ({ page }) => {
    await page.setViewportSize({ width: 504, height: 900 })
    const playback = await goToSettingsSection(page, 'playback')
    await playback.getByRole('button', {
      name: 'Schnelle Wiedergabegeschwindigkeitsleiste anpassen'
    }).click()

    const header = page.locator('.settingsWindowHeader')
    const back = header.locator('.settingsBackButton')
    const breadcrumb = header.locator('.settingsBreadcrumb')
    const [backBounds, breadcrumbBounds] = await Promise.all([
      back.boundingBox(),
      breadcrumb.boundingBox()
    ])
    const actionsBounds = await header.locator('.settingsHeaderActions').boundingBox()

    expect(Math.abs(
      backBounds.y + backBounds.height / 2 - breadcrumbBounds.y - breadcrumbBounds.height / 2
    )).toBeLessThanOrEqual(1)
    expect(Math.abs(
      backBounds.y + backBounds.height / 2 - actionsBounds.y - actionsBounds.height / 2
    )).toBeLessThanOrEqual(1)
    await expect.poll(() => breadcrumb.evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
    ))).toBe(true)
    expect(await breadcrumb.locator('.settingsBreadcrumbText').evaluateAll(elements => (
      elements.some(element => (
        element.scrollWidth > element.clientWidth + 1 &&
        getComputedStyle(element).textOverflow === 'ellipsis'
      ))
    ))).toBe(true)

    await page.setViewportSize({ width: 375, height: 812 })
    const [narrowBackBounds, narrowActionsBounds] = await Promise.all([
      back.boundingBox(),
      header.locator('.settingsHeaderActions').boundingBox()
    ])
    expect(narrowActionsBounds.y).toBeGreaterThanOrEqual(narrowBackBounds.y + narrowBackBounds.height - 1)
    expect(narrowActionsBounds.x).toBeLessThanOrEqual(narrowBackBounds.x + 1)
  })

  test('keeps playback controls inside the content gutter', async ({ page }) => {
    await page.setViewportSize({ width: 504, height: 900 })
    const playback = await goToSettingsSection(page, 'playback')
    const content = page.locator('.settingsContent')
    const defaultRate = playback.locator('.pure-material-slider')
      .filter({ hasText: 'Standard-Wiedergabegeschwindigkeit:' })
    const customize = playback.getByRole('button', {
      name: 'Schnelle Wiedergabegeschwindigkeitsleiste anpassen'
    })

    await expect(defaultRate).toBeVisible()
    await expect(customize).toBeVisible()
    // Electron has one extra volume slider. Remove it so the shared renderer
    // uses the same slider positions as the Capacitor screen in this regression.
    await defaultRate.evaluate(element => { element.previousElementSibling.remove() })
    const metrics = await content.evaluate((element) => {
      const contentBounds = element.getBoundingClientRect()
      const labelBounds = Array.from(element.querySelectorAll('.pure-material-slider .label'))
        .find(label => label.textContent.includes('Standard-Wiedergabegeschwindigkeit'))
        .getBoundingClientRect()
      const buttonBounds = Array.from(element.querySelectorAll('.settingButtonWithSync .btn'))
        .find(button => button.textContent.includes('Schnelle Wiedergabegeschwindigkeitsleiste'))
        .getBoundingClientRect()
      return {
        horizontalScrollRange: element.scrollWidth - element.clientWidth,
        horizontalScrollbarVisible: element.querySelector('.os-scrollbar-horizontal')
          ?.classList.contains('os-scrollbar-visible') ?? false,
        labelEndGutter: contentBounds.right - labelBounds.right,
        buttonWidth: buttonBounds.width,
        buttonHeight: buttonBounds.height
      }
    })

    expect(metrics.horizontalScrollRange).toBeLessThanOrEqual(0)
    expect(metrics.horizontalScrollbarVisible).toBe(false)
    expect(metrics.labelEndGutter).toBeGreaterThanOrEqual(14)
    expect(metrics.buttonWidth).toBeLessThanOrEqual(380)
    expect(metrics.buttonHeight).toBeLessThanOrEqual(72)
    expect(await getMidWordLineBreaks(playback.locator('.pure-material-slider .label'))).toEqual([])
    expect(await playback.locator('.switch-label-text').evaluateAll(elements => (
      elements.every(element => getComputedStyle(element).hyphens === 'auto')
    ))).toBe(true)
    expect(await getMidWordLineBreaks(playback.locator('.quickPlaybackSpeedToggle .switch-label-text'))).toEqual([])
    expect(await getMidWordLineBreaks(customize)).toEqual([])
  })
})
