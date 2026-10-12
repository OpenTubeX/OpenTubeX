import { test, expect, goTo, goToSettingsSection, waitForAppReady } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false, enableHomeRecommendations: true },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: `UC${'0'.repeat(22)}`, name: 'Alpha Channel', thumbnail: '' }]
    }]
  }
})

const surfaces = [
  {
    name: 'subscription options',
    trigger: '.channel .buttonList',
    popup: '.profileDropdown',
    async open(page) {
      await goTo(page, 'subscribedchannels')
      await page.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    }
  },
  {
    name: 'help tooltip',
    trigger: '.settingsContent .selectTooltip .button',
    popup: 'body > [role="tooltip"]',
    async open(page) {
      await goTo(page, 'settings')
      await page.locator(this.trigger).first().focus()
    }
  },
  {
    name: 'color picker',
    trigger: '.customThemeEditor .colorFieldTrigger',
    popup: '.colorPickerPopover',
    async open(page) {
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Create custom theme' }).click()
      await page.locator(this.trigger).first().click()
    }
  },
  {
    name: 'portaled icon menu',
    trigger: '.recommendationOptions .iconButton',
    popup: '.recommendationOptionsPopover',
    async open(page) {
      await goTo(page, 'home')
      await page.locator(this.trigger).click()
    }
  }
]

for (const { uiScale, anchors } of [
  { uiScale: 100, anchors: true },
  { uiScale: 95, anchors: true },
  { uiScale: 125, anchors: true },
  { uiScale: 100, anchors: false }
]) {
  for (const surface of surfaces) {
    test(`${surface.name} follows its trigger at ${uiScale}% with anchors ${anchors}`, async ({ page }, testInfo) => {
      if (!anchors) {
        await page.addInitScript(() => {
          const supports = CSS.supports.bind(CSS)
          CSS.supports = (...args) => args[0] === 'position-anchor' ? false : supports(...args)
        })
        await page.reload()
        await waitForAppReady(page)
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), uiScale)
      await surface.open(page)
      const popup = page.locator(surface.popup).filter({ visible: true })
      await expect(popup).toBeVisible()
      // Let opening transitions, font loads and ResizeObserver notifications settle.
      await expect.poll(() => popup.evaluate(element => element.getAnimations().length)).toBe(0)
      const result = await page.evaluate(async ({ triggerSelector, popupSelector }) => {
        const trigger = document.querySelector(triggerSelector)
        const popup = Array.from(document.querySelectorAll(popupSelector))
          .find(element => element.checkVisibility())
        const measure = () => {
          const button = Element.prototype.getBoundingClientRect.call(trigger)
          const menu = Element.prototype.getBoundingClientRect.call(popup)
          return {
            x: menu.left - button.left,
            y: menu.top - button.top,
            left: menu.left,
            right: menu.right,
            top: menu.top,
            bottom: menu.bottom
          }
        }
        const frame = () => new Promise(requestAnimationFrame)
        await frame()
        await frame()
        const initial = measure()
        const shift = initial.right + 32 < innerWidth - 8 ? 32 : -32
        const shiftY = initial.bottom + 12 < innerHeight - 12 ? 12 : -12
        let reads = 0
        const original = trigger.getBoundingClientRect
        trigger.getBoundingClientRect = function () { reads++; return original.call(this) }
        try {
          trigger.style.translate = `${shift}px ${shiftY}px`
          // Ancestor transforms and scrolling are followed by CSS, without
          // writing new offsets or measuring the trigger on a scroll callback.
          window.dispatchEvent(new Event('scroll'))
          for (let i = 0; i < 6; i++) await frame()
          const moved = measure()
          // Keep menus inside the viewport when scrolling or layout changes
          // would otherwise carry their anchors past an edge.
          trigger.style.translate = `${innerWidth}px ${innerHeight}px`
          window.dispatchEvent(new Event('scroll'))
          for (let i = 0; i < 6; i++) await frame()
          const edge = measure()
          return {
            reads,
            deltaX: moved.x - initial.x,
            deltaY: moved.y - initial.y,
            shift: moved.left - initial.left,
            fits: edge.left >= 7 && edge.right <= innerWidth - 7 &&
              edge.top >= 7 && edge.bottom <= innerHeight - 7
          }
        } finally {
          trigger.getBoundingClientRect = original
          trigger.style.removeProperty('translate')
        }
      }, { triggerSelector: surface.trigger, popupSelector: surface.popup })
      expect(result.deltaX).toBeCloseTo(0, 0)
      expect(result.deltaY).toBeCloseTo(0, 0)
      expect(Math.abs(result.shift)).toBeCloseTo(32, 0)
      expect(result.fits).toBe(true)
      if (anchors) expect(result.reads).toBe(0)
      else expect(result.reads).toBeGreaterThan(0)
      if (surface.name === 'subscription options' && uiScale === 100 && anchors) {
        const buttonBounds = await page.locator(surface.trigger).boundingBox()
        const popupBounds = await popup.boundingBox()
        expect(buttonBounds, 'subscription options trigger remains visible for capture').not.toBeNull()
        expect(popupBounds, 'subscription options popup remains visible for capture').not.toBeNull()
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        const x = Math.max(0, Math.min(buttonBounds.x, popupBounds.x) - 24)
        const y = Math.max(0, Math.min(buttonBounds.y, popupBounds.y) - 24)
        await page.screenshot({
          path: testInfo.outputPath('subscription-options.png'),
          clip: {
            x,
            y,
            width: Math.min(viewport.width, Math.max(buttonBounds.x + buttonBounds.width, popupBounds.x + popupBounds.width) + 24) - x,
            height: Math.min(viewport.height, Math.max(buttonBounds.y + buttonBounds.height, popupBounds.y + popupBounds.height) + 24) - y
          }
        })
      }
    })
  }
}
