import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

test.describe('description layout', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
      history: [watchHistoryEntry]
    }
  })

  test('keeps appended metadata visible and collapsible when it arrives after short text', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    await page.getByText(watchHistoryEntry.title, { exact: true }).click()
    await expect(page.locator('.videoDescription').visible()).toBeVisible()
    const view = await watchViewHandle(page)
    const card = page.locator('.videoDescription').visible()
    for (const { metadata, selector, text } of [
      { metadata: { videoTags: ['first tag', 'second tag'] }, selector: '.videoTagLink', text: ['first tag', 'second tag'] },
      { metadata: { videoGames: [{ title: 'Test game' }] }, selector: '.gameTitle', text: 'Test game' },
      { metadata: { license: 'Creative Commons license' }, selector: '.license', text: 'Creative Commons license' },
      { metadata: { contentDisclosures: [{ label: 'Auto-dubbed', description: 'Automatically generated audio tracks.' }] }, selector: '.contentDisclosureHeader', text: 'Auto-dubbed' },
    ]) {
      await view.evaluate(async component => {
        component.isLoading = true
        await component.$nextTick()
        component.videoDescription = 'A short description.'
        component.videoDescriptionHtml = ''
        component.videoTags = []
        component.videoGames = []
        component.license = null
        component.contentDisclosures = []
        component.isLoading = false
        await component.$nextTick()
      })
      await expect(card.locator('.description')).toHaveText('A short description.')
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator('.descriptionStatus')).toHaveCount(0)
      await card.locator('.description').click({ position: { x: 10, y: 10 } })

      await view.evaluate((component, metadata) => { Object.assign(component, metadata) }, metadata)
      await expect(card).toHaveClass(/short/)
      await expect(card.locator(selector)).toHaveText(text)
      await view.evaluate(component => {
        Object.assign(component, { videoTags: [], videoGames: [], license: null, contentDisclosures: [] })
      })
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator('.descriptionStatus')).toHaveCount(0)
      await view.evaluate((component, metadata) => { Object.assign(component, metadata) }, metadata)
      await expect(card).toHaveClass(/short/)
      await card.locator(':scope > .descriptionStatus').click()
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator(selector)).toHaveText(text)
      // Removing expanded metadata must clear controls and the old scroll range.
      await view.evaluate((component, metadata) => {
        for (const [key, value] of Object.entries(metadata)) {
          component[key] = typeof value === 'string'
            ? value.repeat(100)
            : Array.from({ length: 240 }, (_, index) => typeof value[0] === 'string' ? `tag-${index}` : value[0])
        }
      }, metadata)
      const scroller = card.locator('.descriptionScroll')
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await view.evaluate(component => {
        Object.assign(component, { videoTags: [], videoGames: [], license: null, contentDisclosures: [] })
      })
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator('.descriptionStatus')).toHaveCount(0)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
      await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      if (selector === '.videoTagLink' && uiScale === 100) {
        await card.evaluate(element => element.scrollIntoView({ block: 'end' }))
        await page.mouse.move(0, 0)
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toContainClass(theme)
          await card.screenshot({ path: testInfo.outputPath(`expanded-metadata-removed-${theme}.png`) })
        }
      }
      await view.evaluate((component, metadata) => { Object.assign(component, metadata) }, structuredClone(metadata))
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator('.descriptionScroll > .descriptionStatus')).toBeVisible()
      await card.locator('.descriptionScroll > .descriptionStatus').click()
      await expect(card).toHaveClass(/short/)

      // Metadata must also render when it is the card's only content.
      await view.evaluate(component => { component.videoDescription = '' })
      await expect(card.locator(selector)).toHaveText(text)
      await expect(card).toHaveClass(/short/)
      await expect(card.locator(':scope > .descriptionStatus')).toBeVisible()
      // Empty space alongside metadata must expand the card just like description text.
      const position = await card.evaluate(element => ({ x: element.clientWidth - 80, y: 30 }))
      await card.click({ position })
      await expect(card).not.toHaveClass(/short/)
      await card.locator('.descriptionScroll > .descriptionStatus').click()
      await expect(card).toHaveClass(/short/)
      if (selector === '.videoTagLink' && uiScale === 100) {
        await card.evaluate(element => element.scrollIntoView({ block: 'end' }))
        await page.mouse.move(0, 0)
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toContainClass(theme)
          await card.screenshot({ path: testInfo.outputPath(`collapsed-tags-${theme}.png`) })
        }
      }
    }
  })

  test('keeps links and controls independent of card expansion', async ({ app, page }) => {
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    await page.getByText(watchHistoryEntry.title, { exact: true }).click()
    await expect(page.locator('.videoDescription').visible()).toBeVisible()
    const view = await watchViewHandle(page)
    await view.evaluate(component => {
      component.videoDescription = 'A short description.'
      component.videoDescriptionHtml = ''
      component.videoTags = ['first tag']
      component.videoGames = []
      component.license = null
      component.contentDisclosures = []
    })
    const card = page.locator('.videoDescription').visible()
    await expect(card).toHaveClass(/short/)

    // Keep the card mounted while exercising real link clicks and bubbling.
    for (const selector of ['.videoTagLink', '.game']) {
      await view.evaluate((component, selector) => {
        component.videoTags = selector === '.videoTagLink' ? ['first tag'] : []
        component.videoGames = selector === '.game' ? [{ title: 'Test game', channelId: 'UC-test-game' }] : []
      }, selector)
      const link = card.locator(selector)
      await link.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true, capture: true }))
      await (selector === '.game' ? link.locator('.gameTitle') : link).click()
      await expect(card).toHaveClass(/short/)
    }

    await card.locator('.descriptionCopyButton button').click()
    await expect(page.locator('.toast', { hasText: 'Description copied to clipboard' })).toBeVisible()
    await expect(card).toHaveClass(/short/)

    await card.locator(':scope > .descriptionStatus').focus()
    await page.keyboard.press('Enter')
    await expect(card).not.toHaveClass(/short/)
    await card.locator('.descriptionScroll > .descriptionStatus').click()
    await expect(card).toHaveClass(/short/)

    await card.locator('.description').click({ position: { x: 10, y: 10 } })
    await expect(card).not.toHaveClass(/short/)
  })

  test('keeps description controls below open toolbar dropdowns', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1400, height: 1000 })
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    // Invidious options widen the share menu and hiding Download moves it to the card edge,
    // so the menu reaches the description's copy and "...more" controls.
    await page.evaluate(async () => {
      await window.$store.dispatch('updateBackendFallback', true)
      await window.$store.dispatch('updateEnableDownloads', false)
    })
    await page.getByText(watchHistoryEntry.title, { exact: true }).click()
    await expect(page.locator('.videoDescription').visible()).toBeVisible()
    const view = await watchViewHandle(page)
    await view.evaluate(component => {
      component.videoDescription = Array(12).fill('A long description line.').join('\n')
      component.videoDescriptionHtml = ''
    })
    await expect(page.locator('.videoDescription').visible()).toHaveClass(/short/)

    await page.locator('.watchVideoInfo .shareButton').visible().click()
    const dropdown = page.locator('.watchVideoInfo .iconDropdown').visible()
    await expect(dropdown).toBeVisible()

    for (const selector of ['.videoDescription > .descriptionStatus', '.descriptionCopyButton']) {
      const hit = await dropdown.evaluate((menu, selector) => {
        const menuRect = menu.getBoundingClientRect()
        const rect = document.querySelector(selector).getBoundingClientRect()
        const left = Math.max(rect.left, menuRect.left)
        const right = Math.min(rect.right, menuRect.right)
        const top = Math.max(rect.top, menuRect.top)
        const bottom = Math.min(rect.bottom, menuRect.bottom)
        return {
          overlaps: right - left > 2 && bottom - top > 2,
          coveredByMenu: menu.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2))
        }
      }, selector)
      expect(hit.overlaps, `The share menu overlaps ${selector}`).toBe(true)
      expect(hit.coveredByMenu, `${selector} stays below the share menu`).toBe(true)
    }
  })

  test('short descriptions fit their content with centered text and copy control', { tag: '@scale' }, async ({ app, page }, testInfo) => {
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    await page.getByText(watchHistoryEntry.title, { exact: true }).click()
    await expect(page.locator('.videoDescription').visible()).toBeVisible()
    const view = await watchViewHandle(page)
    await view.evaluate(async component => {
      component.isLoading = true
      await component.$nextTick()
      component.videoDescription = 'A short description.'
      component.videoDescriptionHtml = ''
      component.videoTags = []
      component.videoGames = []
      component.license = null
      component.contentDisclosures = []
      component.isLoading = false
      await component.$nextTick()
    })
    const card = page.locator('.videoDescription').visible()
    await expect(card.locator('.description')).toHaveText('A short description.')
    await expect(card.locator('.descriptionStatus')).toHaveCount(0)

    for (const lines of [1, 2, 4, 1]) {
      await view.evaluate((component, count) => {
        component.videoDescription = Array(count).fill('A short description.').join('\n')
      }, lines)
      await expect.poll(() => card.evaluate(element => {
        const card = element.getBoundingClientRect()
        const text = element.querySelector('.description').getBoundingClientRect()
        return Math.abs((text.top - card.top) - (card.bottom - text.bottom))
      }), { message: 'Description text has equal space above and below it' }).toBeLessThanOrEqual(1)
    }

    await expect.poll(() => card.evaluate(element => {
      const card = element.getBoundingClientRect()
      const copy = element.querySelector('.descriptionCopyButton').getBoundingClientRect()
      return Math.abs((copy.top + copy.bottom - card.top - card.bottom) / 2)
    }), { message: 'Copy control is vertically centered in the one-line card' }).toBeLessThanOrEqual(1)
    await expect.poll(() => card.evaluate(element => {
      const text = element.querySelector('.description').getBoundingClientRect()
      const style = getComputedStyle(element)
      const padding = Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd)
      return Math.abs(element.getBoundingClientRect().height - text.height - padding)
    }), { message: 'Card reserves only its normal vertical padding' }).toBeLessThanOrEqual(1)

    await page.mouse.move(0, 0)
    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme })
      await expect(page.locator('body')).toContainClass(theme)
      await testInfo.attach(`one-line description ${theme}`, {
        body: await card.screenshot(), contentType: 'image/png'
      })
    }
  })
})
