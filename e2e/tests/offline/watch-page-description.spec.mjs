import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test.describe('watch page', () => {
  test('shows tags below the description and copies the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const videoDescription = Array(30).fill('Description to copy').join('\n')
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component, description) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = description
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = ['first tag', 'second tag']
      watchView.isLoading = false
      await watchView.$nextTick()
    }, videoDescription)

    const description = page.locator(`${activeTab} .videoDescription`)
    const descriptionText = description.locator('.description')
    const tags = description.locator('.videoTags')
    const expandControl = description.locator(':scope > .descriptionStatus')
    const footerLayout = () => expandControl.evaluate(element => {
      const card = element.parentElement.getBoundingClientRect()
      const scroll = element.parentElement.querySelector('.descriptionScroll').getBoundingClientRect()
      const footer = element.getBoundingClientRect()
      return {
        belowContent: footer.top >= scroll.bottom - 1,
        spansCard: Math.abs(footer.left - card.left) <= 1 && Math.abs(footer.right - card.right) <= 1,
        atCardBottom: Math.abs(footer.bottom - card.bottom) <= 1,
      }
    })
    const footerAtEdges = { belowContent: true, spansCard: true, atCardBottom: true }

    await expect(expandControl).toHaveAccessibleName('Show more')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'false')
    expect(await footerLayout()).toEqual(footerAtEdges)

    await expandControl.click()
    await expect(tags.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
    await expect(tags.locator('.videoTagLink').first()).toHaveAttribute('href', /\/search\/first%20tag/)
    await expect(description.locator('.descriptionScroll')).toHaveCSS('overflow-anchor', 'none')
    expect(await descriptionText.evaluate((element, tagsElement) => (
      Boolean(element.compareDocumentPosition(tagsElement) & Node.DOCUMENT_POSITION_FOLLOWING)
    ), await tags.elementHandle())).toBe(true)
    expect(await tags.evaluate(element => element.closest('.descriptionScroll') !== null)).toBe(true)
    const descriptionScroll = description.locator('.descriptionScroll')
    expect(await descriptionScroll.evaluate(element => getComputedStyle(element).maskImage))
      .toContain('linear-gradient')
    await expect(descriptionScroll).not.toHaveClass(/descriptionFadeTop/)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeBottom/)
    // The same footer collapses the card again, so keyboard focus stays on it.
    await expect(expandControl).toBeFocused()
    await expect(expandControl).toHaveAccessibleName('Show less')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'true')
    expect(await footerLayout()).toEqual(footerAtEdges)
    const maxScrollTop = await descriptionScroll.evaluate(element =>
      element.scrollHeight - element.clientHeight
    )
    expect(maxScrollTop).toBeGreaterThan(0)
    await descriptionScroll.evaluate((element, maxScrollTop) => {
      element.scrollTop = maxScrollTop / 2
    }, maxScrollTop)
    await expect.poll(() => descriptionScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeTop/)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeBottom/)
    await expect.poll(() => descriptionScroll.evaluate(element =>
      element.scrollTop < element.scrollHeight - element.clientHeight
    )).toBe(true)
    // At the end, the last line stays sharp above the footer.
    await descriptionScroll.evaluate((element, maxScrollTop) => {
      element.scrollTop = maxScrollTop
    }, maxScrollTop)
    await expect(descriptionScroll).not.toHaveClass(/descriptionFadeBottom/)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeTop/)
    expect(await footerLayout()).toEqual(footerAtEdges)
    await expandControl.press('Enter')
    await expect(description).toHaveClass(/short/)
    await expect(expandControl).toBeFocused()
    await expect(expandControl).toHaveAttribute('aria-expanded', 'false')
    // Space activates the footer instead of the player's play/pause shortcut.
    const video = page.locator(`${activeTab} video`)
    const paused = await video.evaluate(element => element.paused)
    await expandControl.press('Space')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'true')
    expect(await video.evaluate(element => element.paused)).toBe(paused)
    await expandControl.press('Space')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'false')
    expect(await video.evaluate(element => element.paused)).toBe(paused)

    await description.locator('.descriptionCopyButton button').click()
    await expect(page.locator('.toast', { hasText: 'Description copied to clipboard' })).toBeVisible()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(videoDescription)
    await watchComponent.dispose()
  })

  test('follows the Video descriptions setting', async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const component = await page.evaluateHandle(findWatchComponent)
    const setMode = mode => component.evaluate(async (component, mode) => {
      await component.proxy.$store.dispatch('updateVideoDescriptionMode', mode)
      await component.proxy.$nextTick()
    }, mode)
    await component.evaluate(async component => {
      const view = component.proxy
      view.videoDescription = Array(30).fill('Long description').join('\n')
      view.videoDescriptionHtml = ''
      await view.$nextTick()
    })

    const description = page.locator(`${activeTab} .videoDescription`)
    const expandControl = description.locator(':scope > .descriptionStatus')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'false')

    await setMode('expanded')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'true')
    await expect(description).not.toHaveClass(/short/)
    await description.screenshot({ path: testInfo.outputPath('expanded-description.png') })
    // Expanded descriptions can still be collapsed.
    await expandControl.click()
    await expect(expandControl).toHaveAttribute('aria-expanded', 'false')

    await setMode('hide')
    await expect(description).toHaveCount(0)

    // A description shown with the setting already expanded starts expanded.
    await setMode('expanded')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'true')

    await setMode('collapsed')
    await expect(expandControl).toHaveAttribute('aria-expanded', 'false')
    await expect(description).toHaveClass(/short/)
    await component.dispose()
  })

  test('clamps the Shorts panel when an AI summary collapses, changes, or is hidden', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    const component = await page.evaluateHandle(findWatchComponent)
    await component.evaluate(async component => {
      const view = component.proxy
      view.isShort = true
      view.shortsMetadataOpen = true
      view.videoDescription = 'Short description'
      view.videoSummary = ['Short summary']
      view.videoDescriptionHtml = ''
      await view.$store.dispatch('updateAiVideoSummaryMode', 'collapsed')
      await view.$nextTick()
    })
    const target = page.locator('.shortsAuxPanelTarget')
    const summary = target.locator('.videoSummary')
    await expect(summary).not.toHaveAttribute('open')
    await summary.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(summary).toHaveAttribute('open', '')
    await expect(summary.locator('.summaryChevron')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)')
    await page.keyboard.press('Space')
    await expect(summary).not.toHaveAttribute('open')
    await expect(summary.locator('.summaryChevron')).toHaveCSS('transform', 'none')
    for (const trigger of ['collapse', 'replace', 'hide']) {
      await component.evaluate(async component => {
        const view = component.proxy
        await view.$store.dispatch('updateAiVideoSummaryMode', 'collapsed')
        view.videoSummary = Array(100).fill('A long summary paragraph for scrolling.')
        await view.$nextTick()
      })
      await summary.evaluate(element => { element.open = true })
      await target.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      if (trigger === 'collapse') {
        await summary.evaluate(element => { element.open = false })
      } else {
        await component.evaluate(async (component, trigger) => {
          if (trigger === 'hide') await component.proxy.$store.dispatch('updateAiVideoSummaryMode', 'hide')
          else component.proxy.videoSummary = ['Short summary']
          await component.proxy.$nextTick()
        }, trigger)
      }
      await expect.poll(() => target.evaluate(element => {
        const end = element.querySelector('.shortsAuxPanelContentEnd').getBoundingClientRect().bottom
        const bounds = element.getBoundingClientRect()
        const max = Math.max(0, element.scrollTop + end - bounds.bottom)
        return element.scrollTop <= max + 1
      })).toBe(true)
      await expect.poll(() => target.evaluate(element => {
        const end = element.querySelector('.shortsAuxPanelContentEnd').getBoundingClientRect().bottom
        const bounds = element.getBoundingClientRect()
        const overflow = element.scrollTop + end - bounds.bottom > 1
        return element.querySelector('.os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible') === overflow
      })).toBe(true)
    }
    await component.dispose()
  })

  test('draws the desktop AI summary as a plain card like the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const component = await page.evaluateHandle(findWatchComponent)
    await component.evaluate(async component => {
      component.proxy.videoSummary = ['A summary paragraph.']
      await component.proxy.$store.dispatch('updateAiVideoSummaryMode', 'collapsed')
    })
    const surface = selector => page.locator(`${activeTab} ${selector}`).evaluate(element => {
      const { backgroundColor, borderRadius, boxShadow } = getComputedStyle(element)
      return { backgroundColor, borderRadius, boxShadow }
    })
    await expect(page.locator(`${activeTab} .videoSummary`)).toBeVisible()
    expect(await surface('.videoSummary')).toEqual(await surface('.videoDescription'))
  })

  test('keeps short and empty descriptions collapsible when they have metadata', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const card = page.locator(`${activeTab} .videoDescription`)

    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      for (const text of ['Short description', '']) {
        await watchComponent.evaluate(async (component, text) => {
          const view = component.proxy
          view.isLoading = true
          await view.$nextTick()
          view.videoDescription = text
          view.videoDescriptionHtml = ''
          view.videoTags = ['first tag', 'second tag']
          view.videoGames = [{ title: 'Grand Theft Auto VI', subtitle: '2026' }]
          view.isLoading = false
          await view.$nextTick()
        }, text)

        await expect(card).toHaveClass(/short/)
        await expect(card.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
        await expect(card.locator('.gameTitle')).toHaveText('Grand Theft Auto VI')
        await card.locator(':scope > .descriptionStatus').click()
        await expect(card).not.toHaveClass(/short/)
        await expect(card.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
        await expect(card.locator('.gameTitle')).toHaveText('Grand Theft Auto VI')
        await card.locator(':scope > .descriptionStatus').click()
        await expect(card).toHaveClass(/short/)
        await expect(card.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
        await expect(card.locator('.gameTitle')).toHaveText('Grand Theft Auto VI')
      }
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('shows short metadata-only cards in full without a footer', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const card = page.locator(`${activeTab} .videoDescription`)

    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      for (const metadata of [
        { videoTags: ['tag'] },
        { license: 'Creative Commons Attribution license (reuse allowed)' },
        { contentDisclosures: [{ label: 'Auto-dubbed', description: 'Audio tracks for some languages were automatically generated.', attribution: '' }] },
      ]) {
        await watchComponent.evaluate(async (component, metadata) => {
          const view = component.proxy
          view.isLoading = true
          await view.$nextTick()
          Object.assign(view, { videoDescription: '', videoDescriptionHtml: '', videoTags: [], videoGames: [], license: null, contentDisclosures: [] }, metadata)
          view.isLoading = false
          await view.$nextTick()
        }, metadata)

        await expect(card).not.toHaveClass(/short/)
        await expect(card.locator(':scope > .descriptionStatus')).toHaveCount(0)
        // The empty text reserves no extra space, so the metadata sits within the card's normal padding.
        await expect.poll(() => card.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const metadata = element.querySelector('.descriptionContentEnd').previousElementSibling.getBoundingClientRect()
          const style = getComputedStyle(element)
          return Math.max(
            Math.abs(metadata.top - bounds.top - Number.parseFloat(style.paddingBlockStart)),
            Math.abs(bounds.bottom - metadata.bottom - Number.parseFloat(style.paddingBlockEnd)),
          )
        })).toBeLessThanOrEqual(1)
      }
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('keeps the four-line description expansion threshold', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const card = page.locator(`${activeTab} .videoDescription`)

    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      for (const lineCount of [4, 5]) {
        await watchComponent.evaluate(async (component, lineCount) => {
          const view = component.proxy
          view.isLoading = true
          await view.$nextTick()
          view.videoDescription = Array.from({ length: lineCount }, (_, index) => `Line ${index + 1}`).join('\n')
          view.videoDescriptionHtml = ''
          view.videoTags = []
          view.videoGames = []
          view.license = null
          view.isLoading = false
          await view.$nextTick()
        }, lineCount)
        if (lineCount === 4) {
          await expect(card).not.toHaveClass(/short/)
        } else {
          await expect(card).toHaveClass(/short/)
          await expect(card.locator(':scope > .descriptionStatus')).toBeVisible()
        }
      }
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('decides Show more again when the card width changes', { tag: '@scale' }, async ({ app, page }) => {
    // Every window resize relays out the whole watch page.
    test.slow()
    // The narrow window stays wider than the phone layout, which replaces the card with a preview.
    await setWindowSize(app, page, { width: 1800, height: 1000 })
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const setDescription = description => watchComponent.evaluate(async (component, description) => {
      const view = component.proxy
      view.isLoading = true
      await view.$nextTick()
      Object.assign(view, { videoDescription: description, videoDescriptionHtml: '', videoTags: [], videoGames: [], license: null, contentDisclosures: [] })
      view.isLoading = false
      await view.$nextTick()
    }, description)
    const card = page.locator(`${activeTab} .videoDescription`)
    await setDescription('Line 1\nLine 2\nLine 3')
    // A fourth line that fills most of the wide card, so it wraps once the card narrows.
    const lastLine = await card.locator('.description').evaluate(element => {
      const style = getComputedStyle(element)
      const width = element.clientWidth - Number.parseFloat(style.paddingInlineStart) - Number.parseFloat(style.paddingInlineEnd)
      const context = document.createElement('canvas').getContext('2d')
      context.font = style.font
      let line = 'A last line'
      while (context.measureText(`${line} that wraps`).width < width * 0.9) line += ' that wraps'
      return line
    })
    await setDescription(`Line 1\nLine 2\nLine 3\n${lastLine}`)

    const footer = card.locator(':scope > .descriptionStatus')
    const expectFull = async () => {
      await expect(card).not.toHaveClass(/short/)
      await expect(footer).toHaveCount(0)
    }
    const textLines = () => card.locator('.description').evaluate(element =>
      element.scrollHeight / Number.parseFloat(getComputedStyle(element).lineHeight)
    )
    await expectFull()
    expect(await textLines()).toBeLessThanOrEqual(4)

    for (const userExpands of [false, true]) {
      await setWindowSize(app, page, { width: 850, height: 900 })
      expect(await textLines()).toBeGreaterThan(4)
      await expect(card).toHaveClass(/short/)
      await expect(footer).toHaveAccessibleName('Show more')
      if (userExpands) {
        await footer.click()
        await expect(footer).toHaveAccessibleName('Show less')
      }

      await setWindowSize(app, page, { width: 1800, height: 1000 })
      await expectFull()
    }

    // The user's expansion survives the card fitting in between.
    await setWindowSize(app, page, { width: 850, height: 900 })
    await expect(card).not.toHaveClass(/short/)
    await expect(footer).toHaveAccessibleName('Show less')
    await watchComponent.dispose()
  })

  test('fades collapsed description content directly into the footer divider', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const view = component.proxy
      view.isLoading = true
      await view.$nextTick()
      view.videoDescription = Array(12).fill('A long description line').join('\n')
      view.videoDescriptionHtml = ''
      view.videoTags = []
      view.videoGames = []
      view.license = null
      view.isLoading = false
      await view.$nextTick()
    })

    const card = page.locator(`${activeTab} .videoDescription`)
    const scroller = card.locator('.descriptionScroll')
    await expect(card).toContainClass('short')
    const layout = await scroller.evaluate(element => {
      const card = element.closest('.videoDescription').getBoundingClientRect()
      const viewport = element.getBoundingClientRect()
      const more = element.parentElement.querySelector(':scope > .descriptionStatus').getBoundingClientRect()
      const line = document.createElement('span')
      line.style.display = 'block'
      line.style.height = '1lh'
      element.append(line)
      const lineHeight = line.getBoundingClientRect().height
      line.remove()
      return {
        footerGap: more.top - viewport.bottom,
        footerBottomGap: card.bottom - more.bottom,
        mask: getComputedStyle(element).maskImage,
        visibleLines: viewport.height / lineHeight,
      }
    })
    expect(layout.visibleLines).toBeCloseTo(5, 1)
    // The fade reaches the divider without leaving a blank strip above it.
    expect(layout.footerGap).toBeCloseTo(0, 0)
    expect(layout.footerBottomGap).toBeCloseTo(0, 0)
    expect(layout.mask).toMatch(
      /^linear-gradient\((?:to bottom, )?rgb\(0, 0, 0\) calc\(100% - 16px\), (?:transparent|rgba\(0, 0, 0, 0\))\)$/
    )
    await watchComponent.dispose()
  })

  test('keeps license-only descriptions accessible and collapsible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const license = 'Creative Commons Attribution license (reuse allowed). '.repeat(20).trim()
    await watchComponent.evaluate(async (component, license) => {
      const view = component.proxy
      view.isLoading = true
      await view.$nextTick()
      view.videoDescription = ''
      view.videoDescriptionHtml = ''
      view.videoTags = []
      view.videoGames = []
      view.license = license
      view.isLoading = false
      await view.$nextTick()
    }, license)

    const card = page.locator(`${activeTab} .videoDescription`)
    await expect(card).toHaveClass(/short/)
    await card.locator(':scope > .descriptionStatus').click()
    await expect(card.locator('.license')).toHaveText(license)
    await card.locator(':scope > .descriptionStatus').click()
    await expect(card).toHaveClass(/short/)
    await expect(card.locator('.license')).toHaveText(license)
    await watchComponent.dispose()
  })

  test('shows description controls when metadata arrives after an empty mount', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const card = page.locator(`${activeTab} .videoDescription`)

    for (const metadata of [
      { videoTags: Array.from({ length: 80 }, (_, index) => `tag-${index}`), videoGames: [], license: null },
      { videoTags: [], videoGames: Array.from({ length: 40 }, (_, index) => ({ title: `Game ${index}` })), license: null },
      { videoTags: [], videoGames: [], license: 'Creative Commons license '.repeat(100) },
    ]) {
      await watchComponent.evaluate(async component => {
        const view = component.proxy
        view.isLoading = true
        await view.$nextTick()
        view.videoDescription = ''
        view.videoDescriptionHtml = ''
        view.videoTags = []
        view.videoGames = []
        view.license = null
        view.isLoading = false
        await view.$nextTick()
      })
      await expect(card).toHaveCount(0)

      await watchComponent.evaluate(async (component, metadata) => {
        const view = component.proxy
        view.videoTags = metadata.videoTags
        view.videoGames = metadata.videoGames
        view.license = metadata.license
        await view.$nextTick()
      }, metadata)
      await expect(card).toHaveClass(/short/)
      await expect(card.locator(':scope > .descriptionStatus')).toBeVisible()
      await expect.poll(() => card.locator('.descriptionScroll').evaluate(element => element.scrollHeight - element.clientHeight))
        .toBeGreaterThan(0)
      await card.locator(':scope > .descriptionStatus').click()
      await expect(card).not.toHaveClass(/short/)
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('clamps description scrolling when metadata shrinks or the card collapses', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const card = page.locator(`${activeTab} .videoDescription`)
    const scroller = card.locator('.descriptionScroll')

    for (const metadata of [
      { videoTags: Array.from({ length: 120 }, (_, index) => `tag-${index}`), videoGames: [], license: null },
      { videoTags: [], videoGames: Array.from({ length: 40 }, (_, index) => ({ title: `Game ${index}` })), license: null },
      { videoTags: [], videoGames: [], license: 'Creative Commons license '.repeat(100) },
    ]) {
      const label = metadata.videoTags.length ? 'tags' : metadata.videoGames.length ? 'games' : 'license'
      await watchComponent.evaluate(async (component, metadata) => {
        const view = component.proxy
        view.isLoading = true
        await view.$nextTick()
        view.videoDescription = 'Short description'
        view.videoDescriptionHtml = ''
        view.videoTags = metadata.videoTags
        view.videoGames = metadata.videoGames
        view.license = metadata.license
        view.isLoading = false
        await view.$nextTick()
      }, metadata)
      await card.locator(':scope > .descriptionStatus').click()
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight), { message: label })
        .toBeGreaterThan(0)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await card.locator(':scope > .descriptionStatus').click()
      await expect(card).toHaveClass(/short/)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)

      await card.locator(':scope > .descriptionStatus').click()
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await watchComponent.evaluate(async (component, metadata) => {
        const view = component.proxy
        if (metadata.videoTags.length) view.videoTags = ['tag-0']
        if (metadata.videoGames.length) view.videoGames = [{ title: 'Game 0' }]
        if (metadata.license) view.license = 'Creative Commons license'
        await view.$nextTick()
      }, metadata)
      await expect.poll(() => scroller.evaluate(element => ({
        scrollTop: element.scrollTop,
        overflow: element.scrollHeight > element.clientHeight + 1,
        scrollbarVisible: element.querySelector('.os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible') &&
          !element.querySelector('.os-scrollbar-vertical')?.classList.contains('os-scrollbar-unusable'),
      })), { message: label })
        .toEqual({ scrollTop: 0, overflow: false, scrollbarVisible: false })
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('keeps the desktop description thumb in step with mouse wheel scrolling', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const view = component.proxy
      view.isLoading = true
      await view.$nextTick()
      view.videoDescription = Array.from({ length: 100 }, (_, index) => `Line ${index + 1}`).join('\n')
      view.videoDescriptionHtml = ''
      view.videoTags = []
      view.videoGames = []
      view.license = null
      view.isLoading = false
      await view.$nextTick()
    })

    const card = page.locator(`${activeTab} .videoDescription`)
    await card.locator(':scope > .descriptionStatus').click()
    const scroller = card.locator('.descriptionScroll')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')

    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      await scroller.evaluate(element => { element.scrollTop = 0 })
      const bounds = await scroller.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await scroller.evaluate(element => {
        window.__descriptionThumbSamples = []
        window.__stopDescriptionThumbSamples = false
        const sample = () => {
          if (window.__stopDescriptionThumbSamples) return
          const track = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track')
          const handle = track.querySelector('.os-scrollbar-handle')
          const trackRect = track.getBoundingClientRect()
          const handleRect = handle.getBoundingClientRect()
          const scrollRange = element.scrollHeight - element.clientHeight
          window.__descriptionThumbSamples.push({
            scrollTop: element.scrollTop,
            error: Math.abs(
              handleRect.top - trackRect.top -
              element.scrollTop / scrollRange * (trackRect.height - handleRect.height)
            ),
          })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      for (let index = 0; index < 6; index++) await page.mouse.wheel(0, 80)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await page.waitForTimeout(150)
      const samples = await scroller.evaluate(async () => {
        window.__stopDescriptionThumbSamples = true
        await new Promise(resolve => requestAnimationFrame(resolve))
        const samples = window.__descriptionThumbSamples
        delete window.__descriptionThumbSamples
        delete window.__stopDescriptionThumbSamples
        return samples
      })
      expect(samples.length).toBeGreaterThan(2)
      expect(Math.max(...samples.map(sample => sample.error))).toBeLessThan(5)
      await expect(scrollbar).toBeVisible()
      expect(await scrollbar.evaluate(element => element.getAnimations().some(animation =>
        animation.timeline?.constructor.name === 'ScrollTimeline'
      ))).toBe(false)
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('handles videos without a description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = ''
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = []
      watchView.videoGames = []
      watchView.license = null
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .videoDescription`)).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await watchComponent.dispose()
  })
})
