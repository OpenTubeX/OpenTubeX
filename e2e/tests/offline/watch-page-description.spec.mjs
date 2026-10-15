import { test, expect } from '../../helpers/app.mjs'
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
    const copyButton = description.locator('.descriptionCopyButton')
    const controlsOverlap = async () => expandControl.evaluate((element, copyButtonElement) => {
      const expandRect = element.getBoundingClientRect()
      const copyRect = copyButtonElement.getBoundingClientRect()
      return (
        expandRect.top < copyRect.bottom &&
        expandRect.bottom > copyRect.top &&
        expandRect.left < copyRect.right &&
        expandRect.right > copyRect.left
      )
    }, await copyButton.elementHandle())

    // Force the absolute controls together despite the collapsed card's reserved footer.
    await description.evaluate(element => { element.style.height = '0px' })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '160px' })
    await expect(expandControl).not.toHaveClass(/avoidCopyButton/)
    await expect(expandControl).toHaveCSS('inset-inline-end', '16px')

    await description.evaluate(element => {
      element.dir = 'rtl'
      element.style.height = '0px'
    })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '' })

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
    const collapseControl = description.locator('.descriptionScroll > .descriptionStatus')
    await expect(collapseControl).toBeVisible()
    await expect(collapseControl).toHaveCSS('position', 'sticky')
    const collapseControlStyles = await collapseControl.evaluate(element => {
      const style = getComputedStyle(element)
      const fadeStyle = getComputedStyle(element, '::before')
      return {
        fadeMask: fadeStyle.maskImage,
        fadeHeight: Number.parseFloat(fadeStyle.height),
        fontSize: Number.parseFloat(style.fontSize),
        marginBlockStart: Number.parseFloat(style.marginBlockStart)
      }
    })
    expect(collapseControlStyles.fadeMask).toContain('linear-gradient')
    expect(collapseControlStyles.fadeHeight).toBeGreaterThan(0)
    expect(collapseControlStyles.marginBlockStart).toBeGreaterThan(collapseControlStyles.fontSize)
    const maxScrollTop = await descriptionScroll.evaluate(element =>
      element.scrollHeight - element.clientHeight
    )
    expect(maxScrollTop).toBeGreaterThan(0)
    await descriptionScroll.evaluate((element, maxScrollTop) => {
      element.scrollTop = maxScrollTop / 2
    }, maxScrollTop)
    await expect.poll(() => descriptionScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeTop/)
    await expect.poll(() => descriptionScroll.evaluate(element =>
      element.scrollTop < element.scrollHeight - element.clientHeight
    )).toBe(true)
    await expect.poll(() => collapseControl.evaluate(element => {
      const controlBottom = element.getBoundingClientRect().bottom
      const scrollBottom = element.parentElement.getBoundingClientRect().bottom
      return Math.abs(controlBottom - scrollBottom) <= 1
    })).toBe(true)

    await description.locator('.descriptionCopyButton button').click()
    await expect(page.locator('.toast', { hasText: 'Description copied to clipboard' })).toBeVisible()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(videoDescription)
    await watchComponent.dispose()
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
        await card.locator('.descriptionScroll > .descriptionStatus').click()
        await expect(card).toHaveClass(/short/)
        await expect(card.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
        await expect(card.locator('.gameTitle')).toHaveText('Grand Theft Auto VI')
      }
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('preserves collapsed card height with short metadata', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const view = component.proxy
      view.isLoading = true
      await view.$nextTick()
      view.videoDescription = ''
      view.videoDescriptionHtml = ''
      view.videoTags = ['tag']
      view.videoGames = []
      view.license = null
      view.isLoading = false
      await view.$nextTick()
    })

    const card = page.locator(`${activeTab} .videoDescription`)
    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      await expect(card).toHaveClass(/short/)
      const layout = await card.evaluate(element => {
        const scroll = element.querySelector('.descriptionScroll')
        const line = document.createElement('span')
        line.style.position = 'absolute'
        line.style.height = '1lh'
        scroll.append(line)
        const lineHeight = line.getBoundingClientRect().height
        line.remove()
        return {
          footerHeight: element.getBoundingClientRect().bottom -
            element.querySelector('.descriptionContentEnd').getBoundingClientRect().top,
          lineHeight,
        }
      })
      expect(layout.footerHeight).toBeCloseTo(16 + layout.lineHeight, 0)
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

  test('fades collapsed description content at the bottom of the card', async ({ app, page }) => {
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
    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      await expect(card).toContainClass('short')
      const layout = await scroller.evaluate(element => {
        const cardElement = element.closest('.videoDescription')
        const card = cardElement.getBoundingClientRect()
        const viewport = element.getBoundingClientRect()
        const more = element.parentElement.querySelector(':scope > .descriptionStatus').getBoundingClientRect()
        const line = document.createElement('span')
        line.style.display = 'block'
        line.style.height = '1lh'
        element.append(line)
        const lineHeight = line.getBoundingClientRect().height
        line.remove()
        const description = element.querySelector('.description')
        element.style.maxBlockSize = '4lh'
        description.style.maxBlockSize = '4lh'
        cardElement.style.paddingBlockEnd = 'calc(16px + 1lh)'
        const previousCardHeight = cardElement.getBoundingClientRect().height
        element.style.removeProperty('max-block-size')
        description.style.removeProperty('max-block-size')
        cardElement.style.removeProperty('padding-block-end')
        return {
          bottomGap: card.bottom - viewport.bottom,
          moreOverlapsContent: more.top < viewport.bottom,
          mask: getComputedStyle(element).maskImage,
          visibleLines: viewport.height / lineHeight,
          heightDifference: card.height - previousCardHeight,
        }
      })
      expect(layout.visibleLines).toBeCloseTo(5, 1)
      expect(layout.heightDifference).toBeCloseTo(0, 0)
      expect(layout.bottomGap).toBeGreaterThanOrEqual(0)
      expect(layout.bottomGap).toBeLessThanOrEqual(24)
      expect(layout.moreOverlapsContent).toBe(true)
      expect(layout.mask).toMatch(
        /^linear-gradient\((?:to bottom, )?rgb\(0, 0, 0\) calc\(100% - 16px\), (?:transparent|rgba\(0, 0, 0, 0\))\)$/
      )
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await watchComponent.dispose()
  })

  test('keeps license-only descriptions accessible and collapsible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const view = component.proxy
      view.isLoading = true
      await view.$nextTick()
      view.videoDescription = ''
      view.videoDescriptionHtml = ''
      view.videoTags = []
      view.videoGames = []
      view.license = 'Creative Commons Attribution license (reuse allowed)'
      view.isLoading = false
      await view.$nextTick()
    })

    const card = page.locator(`${activeTab} .videoDescription`)
    await expect(card).toHaveClass(/short/)
    await card.locator(':scope > .descriptionStatus').click()
    await expect(card.locator('.license')).toHaveText('Creative Commons Attribution license (reuse allowed)')
    await card.locator('.descriptionScroll > .descriptionStatus').click()
    await expect(card).toHaveClass(/short/)
    await expect(card.locator('.license')).toHaveText('Creative Commons Attribution license (reuse allowed)')
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
      { videoTags: Array.from({ length: 80 }, (_, index) => `tag-${index}`), videoGames: [], license: null },
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

      await card.locator('.descriptionScroll > .descriptionStatus').click()
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
