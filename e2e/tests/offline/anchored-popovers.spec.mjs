import { test, expect, goTo, goToSettingsSection, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'

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
    alignment: 'end',
    async open(page, positionTrigger) {
      await goTo(page, 'subscribedchannels')
      await positionTrigger?.(page.locator(this.trigger))
      const button = page.getByRole('button', { name: 'Subscription settings', exact: true })
      if (positionTrigger) await button.evaluate(element => element.click())
      else await button.click()
    }
  },
  {
    name: 'help tooltip',
    trigger: '.settingsContent .select .selectTooltip .button',
    popup: 'body > [role="tooltip"]',
    alignment: 'center',
    async open(page, positionTrigger) {
      await goTo(page, 'settings')
      await positionTrigger?.(page.locator(this.trigger).first())
      await page.locator(this.trigger).first().focus()
    }
  },
  {
    name: 'color picker',
    trigger: '.customThemeEditor .colorFieldTrigger',
    popup: '.colorPickerPopover',
    alignment: 'start',
    async open(page, positionTrigger) {
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Create custom theme' }).click()
      await positionTrigger?.(page.locator(this.trigger).first())
      const button = page.locator(this.trigger).first()
      if (positionTrigger) await button.evaluate(element => element.click())
      else await button.click()
    }
  },
  {
    name: 'portaled icon menu',
    trigger: '.recommendationOptions .iconButton',
    popup: '.recommendationOptionsPopover',
    alignment: 'end',
    async open(page, positionTrigger) {
      await goTo(page, 'home')
      await positionTrigger?.(page.locator(this.trigger))
      const button = page.locator(this.trigger)
      if (positionTrigger) await button.evaluate(element => element.click())
      else await button.click()
    }
  }
]

async function waitForPopupLayout(popup) {
  await expect.poll(() => popup.evaluate(element => element.getAnimations().length)).toBe(0)
  let previousGeometry
  await expect.poll(async () => {
    const geometry = await popup.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return [rect.left, rect.top, rect.width, rect.height].join(',')
    })
    const settled = geometry === previousGeometry
    previousGeometry = geometry
    return settled
  }).toBe(true)
}

for (const { uiScale, anchors } of [
  { uiScale: 100, anchors: true },
  { uiScale: 95, anchors: true },
  { uiScale: 125, anchors: true },
  { uiScale: 100, anchors: false }
]) {
  for (const surface of surfaces) {
    if (anchors) {
      test(`${surface.name} recovers its preferred alignment after opening at an edge at ${uiScale}%`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), uiScale)
        await surface.open(page, trigger => trigger.evaluate((element, alignment) => {
          const rect = element.getBoundingClientRect()
          const targetLeft = alignment === 'start' ? innerWidth - 40 : 20
          element.style.translate = `${targetLeft - rect.left}px 0px`
        }, surface.alignment))
        const popup = page.locator(surface.popup).filter({ visible: true })
        await expect(popup).toBeVisible()
        await waitForPopupLayout(popup)
        await page.locator(surface.trigger).first().evaluate(element => {
          const rect = element.getBoundingClientRect()
          const current = Number.parseFloat(element.style.translate)
          element.style.translate = `${current + innerWidth / 2 - rect.left}px 0px`
        })
        await expect.poll(() => popup.evaluate((element, { triggerSelector, alignment }) => {
          const trigger = document.querySelector(triggerSelector).getBoundingClientRect()
          const menu = element.getBoundingClientRect()
          const preferredLeft = alignment === 'start'
            ? trigger.left
            : alignment === 'end'
              ? trigger.right - menu.width
              : trigger.left + (trigger.width - menu.width) / 2
          return Math.abs(menu.left - preferredLeft)
        }, { triggerSelector: surface.trigger, alignment: surface.alignment })).toBeLessThanOrEqual(1)
      })
    }
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
      await waitForPopupLayout(popup)
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
        let reads = 0
        const original = trigger.getBoundingClientRect
        trigger.getBoundingClientRect = function () { reads++; return original.call(this) }
        try {
          trigger.style.translate = `${shift}px 0px`
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

for (const scale of [100, 95, 125]) {
  test(`color picker updates viewport bounds when its status row grows at ${scale}%`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), scale)
    const surface = surfaces.find(surface => surface.name === 'color picker')
    await surface.open(page)
    const popup = page.locator(surface.popup)
    await waitForPopupLayout(popup)
    const initialHeight = await popup.evaluate(element => element.getBoundingClientRect().height)
    await popup.locator('.hexInputControl input').press('Escape')
    const trigger = page.locator(surface.trigger).first()
    await trigger.evaluate((element, height) => {
      const rect = element.getBoundingClientRect()
      element.style.translate = `0px ${innerHeight - height - rect.height - 20 - rect.top}px`
      element.click()
    }, initialHeight)
    await waitForPopupLayout(popup)
    await expect.poll(() => popup.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight + 12))).toBeLessThanOrEqual(1)
    const input = popup.locator('.hexInputControl input')
    await input.fill('invalid')
    await input.press('Enter')
    await expect(popup.locator('[role="status"]')).toBeVisible()
    await expect.poll(() => popup.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(initialHeight)
    await expect.poll(() => popup.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight - 11), { timeout: 1000 }).toBe(true)
    await expect(popup.locator('[role="status"]')).toBeVisible()
    if (scale === 100) {
      await page.screenshot({
        path: testInfo.outputPath('color-picker-status.png'),
        clip: await popup.evaluate(element => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x, y, width, height }
        })
      })
    }
  })
  test(`portaled icon menu stays within viewport bounds during real page scrolling at ${scale}%`, async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), scale)
    await setWindowSize(app, page, { width: 1200, height: 600 })
    await surfaces.find(surface => surface.name === 'portaled icon menu').open(page)
    const popup = page.locator('.recommendationOptionsPopover')
    await waitForPopupLayout(popup)
    await page.locator('.homePage').evaluate(element => { element.style.minBlockSize = `${innerHeight * 3}px` })
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
    await expect.poll(() => popup.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const chrome = Math.max(...['.topNav', '.tabBar.position-top'].map(selector => (
        document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0
      )))
      return rect.top >= chrome + 3 && rect.bottom <= innerHeight - 7
    })).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(() => popup.evaluate(element => {
      const button = document.querySelector('.recommendationOptions .iconButton').getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      return Math.abs(rect.right - button.right)
    })).toBeLessThanOrEqual(1)
  })
  test(`help tooltip stays within viewport bounds during real nested scrolling at ${scale}%`, async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), scale)
    await setWindowSize(app, page, { width: 1200, height: 500 })
    await goToSettingsSection(page, 'appearance')
    const trigger = page.locator('.settingsContent .selectTooltip .button').first()
    await trigger.focus()
    const popup = page.locator('body > [role="tooltip"]').filter({ visible: true })
    await expect(popup).toBeVisible()
    await waitForPopupLayout(popup)
    await trigger.evaluate(element => {
      const original = element.getBoundingClientRect
      window.tooltipTriggerReads = 0
      element.getBoundingClientRect = function () { window.tooltipTriggerReads++; return original.call(this) }
    })
    const scroller = page.locator('.settingsContent')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => popup.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 7 && bounds.bottom <= innerHeight - 7
    })).toBe(true)
    expect(await page.evaluate(() => window.tooltipTriggerReads)).toBe(0)
    const overflowBetweenFrames = await popup.evaluate(async element => {
      const overflow = []
      window.dispatchEvent(new Event('scroll'))
      for (let i = 0; i < 3; i++) {
        await new Promise(requestAnimationFrame)
        const bounds = element.getBoundingClientRect()
        overflow.push(Math.max(0, 7 - bounds.top, bounds.bottom - innerHeight + 7))
      }
      return Math.max(...overflow)
    })
    expect(overflowBetweenFrames, 'an active viewport correction persists between scroll frames').toBeLessThanOrEqual(1)
    await scroller.evaluate(element => { element.scrollTop = 0 })
    await expect.poll(() => popup.evaluate(element => {
      const trigger = document.querySelector('.settingsContent .selectTooltip .button')
      const button = Element.prototype.getBoundingClientRect.call(trigger)
      const menu = element.getBoundingClientRect()
      const preferredLeft = element.classList.contains('bottom-left')
        ? button.right - menu.width
        : button.left + (button.width - menu.width) / 2
      const left = Math.max(8, Math.min(preferredLeft, innerWidth - menu.width - 8))
      const top = Math.max(8, Math.min(button.bottom + 16, innerHeight - menu.height - 8))
      return Math.max(Math.abs(menu.left - left), Math.abs(menu.top - top))
    })).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => window.tooltipTriggerReads)).toBe(0)
  })
}
