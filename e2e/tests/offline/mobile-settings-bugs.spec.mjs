import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

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

    test('leaves room between selects and their help icons', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      const section = await goToSettingsSection(page, 'playback')
      const selects = section.locator('.select.containsTooltip')
      await expect(selects.first()).toBeVisible()
      expect(await selects.evaluateAll(elements => elements.every(el => {
        const help = el.querySelector('.selectTooltip').getBoundingClientRect()
        const select = el.querySelector('.select-text').getBoundingClientRect()
        return help.left - select.right >= 16
      }))).toBe(true)
    })

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
