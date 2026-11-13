import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

// Like openMockedVideo, allow for parsing the uncached player script, which
// takes several times longer on a busy host.
async function openHistoryEntry(page) {
  await page.getByText(watchHistoryEntry.title, { exact: true }).click()
  await expect(page.locator('.videoDescription').visible()).toBeVisible({ timeout: 30_000 })
}

async function expectContentPaddingAboveFooter(card) {
  const layout = await card.evaluate(element => {
    const contentEnd = element.querySelector('.descriptionContentEnd')
    const content = contentEnd.previousElementSibling.getBoundingClientRect()
    const viewport = element.querySelector('.descriptionScroll').getBoundingClientRect()
    const footer = element.querySelector(':scope > .descriptionStatus').getBoundingClientRect()
    return { padding: viewport.bottom - content.bottom, footerGap: footer.top - viewport.bottom }
  })
  expect(Math.abs(layout.padding - 16), 'Content has 16px of padding inside the scroll viewport').toBeLessThanOrEqual(1)
  expect(Math.abs(layout.footerGap), 'The fade viewport meets the footer divider').toBeLessThanOrEqual(1)
}

test.describe('description layout', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
      history: [watchHistoryEntry]
    }
  })

  // One test per metadata kind keeps each within the timeout on a busy host.
  for (const { kind, metadata, selector, text } of [
    { kind: 'tags', metadata: { videoTags: ['first tag', 'second tag'] }, selector: '.videoTagLink', text: ['first tag', 'second tag'] },
  ]) {
    test(`keeps appended metadata visible and collapsible when it arrives after short text (${kind})`, { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
      await mockUnplayableWatchPage(app, page)
      await goTo(page, 'history')
      await openHistoryEntry(page)
      const view = await watchViewHandle(page)
      const card = page.locator('.videoDescription').visible()
      await view.evaluate(async component => {
        component.isLoading = true
        await component.$nextTick()
        // Three lines stay below the four-line threshold until any metadata follows them.
        component.videoDescription = 'A short description.\nSecond line.\nThird line.'
        component.videoDescriptionHtml = ''
        component.videoTags = []
        component.videoGames = []
        component.videoMusicTracks = []
        component.license = null
        component.contentDisclosures = []
        component.isLoading = false
        await component.$nextTick()
      })
      await expect(card.locator('.description')).toHaveText('A short description.\nSecond line.\nThird line.')
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator('.descriptionStatus')).toHaveCount(0)
      await card.locator('.description').click({ position: { x: 10, y: 10 } })

      await view.evaluate((component, metadata) => { Object.assign(component, metadata) }, metadata)
      await expect(card).toHaveClass(/short/)
      await expect(card.locator(selector)).toHaveText(text)
      await view.evaluate(component => {
        Object.assign(component, { videoTags: [], videoGames: [], videoMusicTracks: [], license: null, contentDisclosures: [] })
      })
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator('.descriptionStatus')).toHaveCount(0)
      await view.evaluate((component, metadata) => { Object.assign(component, metadata) }, metadata)
      await expect(card).toHaveClass(/short/)
      await card.locator(':scope > .descriptionStatus').click()
      await expect(card).not.toHaveClass(/short/)
      await expect(card.locator(selector)).toHaveText(text)
      await expectContentPaddingAboveFooter(card)
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
      await expect(scroller).not.toHaveClass(/descriptionFadeBottom/)
      await expectContentPaddingAboveFooter(card)
      await view.evaluate(component => {
        Object.assign(component, { videoTags: [], videoGames: [], videoMusicTracks: [], license: null, contentDisclosures: [] })
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
      await expect(card.locator(':scope > .descriptionStatus')).toBeVisible()
      await card.locator(':scope > .descriptionStatus').click()
      await expect(card).toHaveClass(/short/)

      // Metadata must also render when it is the card's only content.
      // Enough of it stays collapsible without text above it.
      await view.evaluate((component, metadata) => {
        component.videoDescription = ''
        for (const [key, value] of Object.entries(metadata)) {
          component[key] = typeof value === 'string'
            ? value.repeat(100)
            : Array.from({ length: 40 }, (_, index) => typeof value[0] === 'string' ? `tag-${index}` : value[0])
        }
      }, metadata)
      await expect(card.locator(selector).first()).toBeVisible()
      await expect(card).toHaveClass(/short/)
      await expect(card.locator(':scope > .descriptionStatus')).toBeVisible()
      // Empty space alongside metadata must expand the card just like description text.
      const position = await card.evaluate(element => ({ x: element.clientWidth - 80, y: 30 }))
      await card.click({ position })
      await expect(card).not.toHaveClass(/short/)
      await card.locator(':scope > .descriptionStatus').click()
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
    })
  }

  test('keeps links and controls independent of card expansion', async ({ app, page }) => {
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    await openHistoryEntry(page)
    const view = await watchViewHandle(page)
    await view.evaluate(component => {
      component.videoDescription = 'A short description.'
      component.videoDescriptionHtml = ''
      component.videoTags = ['first tag']
      component.videoGames = []
      component.videoMusicTracks = []
      component.license = null
      component.contentDisclosures = []
    })
    const card = page.locator('.videoDescription').visible()
    await expect(card).toHaveClass(/short/)

    // Keep the card mounted while exercising real link clicks and bubbling.
    for (const selector of ['.videoTagLink', '.game', '.musicTrackTitle']) {
      await view.evaluate((component, selector) => {
        component.videoTags = selector === '.videoTagLink' ? ['first tag'] : []
        component.videoGames = selector === '.game' ? [{ title: 'Test game', channelId: 'UC-test-game' }] : []
        component.videoMusicTracks = selector === '.musicTrackTitle'
          ? [{ title: 'Test song', artist: '', album: '', license: '', thumbnail: '', videoId: 'jNQXAC9IVRw' }]
          : []
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
    await card.locator(':scope > .descriptionStatus').click()
    await expect(card).toHaveClass(/short/)

    await card.locator('.description').click({ position: { x: 10, y: 10 } })
    await expect(card).not.toHaveClass(/short/)
  })

  test('keeps description controls below open toolbar dropdowns', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    // Keep a 1400x1300 CSS viewport at every scale so the share menu stays a
    // dropdown and fits below its button, where it opens over the description.
    await setWindowSize(app, page, { width: Math.round(14 * uiScale), height: Math.round(13 * uiScale) })
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    // Invidious options widen the share menu and hiding Download moves it to the card edge,
    // so the menu reaches the description's copy and "Show more" controls.
    await page.evaluate(async () => {
      await window.$store.dispatch('updateBackendFallback', true)
      await window.$store.dispatch('updateEnableDownloads', false)
    })
    await openHistoryEntry(page)
    const view = await watchViewHandle(page)
    await view.evaluate(component => {
      component.videoDescription = Array(12).fill('A long description line.').join('\n')
      component.videoDescriptionHtml = ''
    })
    await expect(page.locator('.videoDescription').visible()).toHaveClass(/short/)

    // Leave room below the toolbar, or the menu opens above the button instead of over the description.
    const shareButton = page.locator('.watchVideoInfo .shareButton').visible()
    await shareButton.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await shareButton.click()
    const dropdown = page.locator('.watchVideoInfo .iconDropdown').visible()
    await expect(dropdown).toBeVisible()

    for (const selector of ['.videoDescription > .descriptionStatus', '.descriptionCopyButton']) {
      await expect.poll(() => dropdown.evaluate((menu, selector) => {
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
      }, selector), { message: `The share menu overlaps and covers ${selector}` }).toEqual({ overlaps: true, coveredByMenu: true })
    }
  })
})
