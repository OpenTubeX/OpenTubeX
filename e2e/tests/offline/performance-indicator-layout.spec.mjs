import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

test('keeps performance badges inline when the switch label has room', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.dispatch('updateShowPerformanceImpactIndicators', true)
  })
  const addOns = await goToSettingsSection(page, 'add-ons')
  const toggle = addOns.locator('[data-setting-key="useDeArrowTitles"]')
  await expect(toggle.locator('.performanceImpact')).toBeVisible()
  const layout = await toggle.evaluate(element => {
    const text = element.querySelector('.switch-label-text')
    const badge = element.querySelector('.performanceImpact')
    const range = document.createRange()
    range.selectNodeContents(text)
    const textBounds = range.getBoundingClientRect()
    const badgeBounds = badge.getBoundingClientRect()
    return {
      centerDifference: Math.abs(textBounds.top + textBounds.height / 2 - badgeBounds.top - badgeBounds.height / 2),
      textRight: textBounds.right,
      badgeLeft: badgeBounds.left
    }
  })
  expect(layout.centerDifference).toBeLessThanOrEqual(2)
  expect(layout.badgeLeft).toBeGreaterThanOrEqual(layout.textRight)
})

async function expectBadgeBelowLabel(control, textSelector) {
  const layout = await control.evaluate((element, selector) => {
    const text = element.querySelector(selector)
    const range = document.createRange()
    range.selectNodeContents(text)
    const badge = element.querySelector('.performanceImpact')
    const textRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0)
    const textBounds = text.getBoundingClientRect()
    const badgeBounds = badge.getBoundingClientRect()
    const controlBounds = element.getBoundingClientRect()
    const helpBounds = element.querySelector('.tooltip').getBoundingClientRect()
    const label = element.querySelector('.switch-label')
    let switchCenterOffset
    if (label) {
      const anchor = text
      const knob = getComputedStyle(anchor, '::after')
      const anchorBounds = anchor.getBoundingClientRect()
      const knobCenter = anchorBounds.top + Number.parseFloat(knob.top) +
        new DOMMatrix(knob.transform).m42 + Number.parseFloat(knob.height) / 2
      switchCenterOffset = Math.abs(knobCenter - textBounds.top - textBounds.height / 2)
    }
    return {
      switchCenterOffset,
      textBottom: Math.max(...textRects.map(rect => rect.bottom)),
      textCenter: textBounds.top + textBounds.height / 2,
      badgeTop: badgeBounds.top,
      badgeLeft: badgeBounds.left,
      badgeRight: badgeBounds.right,
      controlLeft: controlBounds.left,
      controlRight: controlBounds.right,
      helpLeft: helpBounds.left,
      helpRight: helpBounds.right,
      helpCenter: helpBounds.top + helpBounds.height / 2,
      overlapsHelp: badgeBounds.left < helpBounds.right && badgeBounds.right > helpBounds.left &&
        badgeBounds.top < helpBounds.bottom && badgeBounds.bottom > helpBounds.top,
      badgeScrollWidth: badge.scrollWidth,
      badgeClientWidth: badge.clientWidth,
      badgeWidth: badgeBounds.width,
      badgeTextRight: badge.querySelector('.performanceImpactLabel').getBoundingClientRect().right,
      badgeTextLeft: badge.querySelector('.performanceImpactLabel').getBoundingClientRect().left
    }
  }, textSelector)

  expect(layout.badgeTop).toBeGreaterThanOrEqual(layout.textBottom - 1)
  expect(layout.badgeLeft).toBeGreaterThanOrEqual(layout.controlLeft - 1)
  expect(layout.badgeRight).toBeLessThanOrEqual(layout.controlRight + 1)
  expect(layout.helpLeft).toBeGreaterThanOrEqual(layout.controlLeft - 1)
  expect(layout.helpRight).toBeLessThanOrEqual(layout.controlRight + 1)
  expect(layout.overlapsHelp, JSON.stringify(layout)).toBe(false)
  expect(layout.badgeScrollWidth - layout.badgeClientWidth, JSON.stringify(layout)).toBeLessThanOrEqual(1)
  if (layout.switchCenterOffset !== undefined) {
    expect(layout.switchCenterOffset, JSON.stringify(layout)).toBeLessThanOrEqual(1)
    expect(Math.abs(layout.helpCenter - layout.textCenter), JSON.stringify(layout)).toBeLessThanOrEqual(1)
  }
}

for (const currentLocale of ['en-US', 'de-DE']) {
  for (const uiScale of [100, 125]) {
    test.describe(`performance indicator layout in ${currentLocale} at ${uiScale}%`, () => {
      test.use({ seed: { settings: { currentLocale, uiScale } } })

      test('wraps badges below switch labels without squeezing the text', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        const general = await goToSettingsSection(page, 'general')
        const toggle = general.locator('[data-setting-key="updateRelativeTimestamps"]')
        const text = toggle.locator('.switch-label-text')
        const widthWithoutBadge = (await text.boundingBox()).width

        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          return store.dispatch('updateShowPerformanceImpactIndicators', true)
        })
        await expect(toggle.locator('.performanceImpact')).toBeVisible()
        expect((await text.boundingBox()).width).toBeGreaterThanOrEqual(widthWithoutBadge - 1)

        for (const width of [375, 320]) {
          await page.setViewportSize({ width, height: 812 })
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(value => { document.documentElement.dir = value }, direction)
            await expectBadgeBelowLabel(toggle, '.switch-label-text')
          }
        }
      })

      test('wraps badges below slider labels without crowding the value or help', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          return store.dispatch('updateShowPerformanceImpactIndicators', true)
        })
        const streaming = await goToSettingsSection(page, 'playback')
        const slider = streaming.locator('.pure-material-slider').filter({ has: page.locator('.performanceImpact') })
        await expect(slider.locator('.performanceImpact')).toBeVisible()
        for (const width of [375, 320]) {
          await page.setViewportSize({ width, height: 812 })
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(value => { document.documentElement.dir = value }, direction)
            await expectBadgeBelowLabel(slider, '.label')
          }
        }
      })
    })
  }
}
