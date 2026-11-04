import { expectScrollAtRenderedEnd, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { clickVideoAction, mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectNoScrollbarOverflow(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    return element.scrollTop === 0 && scrollbar &&
      (!scrollbar.classList.contains('os-scrollbar-visible') || scrollbar.classList.contains('os-scrollbar-unusable'))
  })).toBe(true)
}

/** @param {import('@playwright/test').Locator} toolbar */
function getToolbarLayout(toolbar) {
  return toolbar.evaluate(element => {
    const card = element.closest('.watchVideoInfo')
    const cardBox = card.getBoundingClientRect()
    const cardStyle = getComputedStyle(card)
    const contentLeft = cardBox.left + parseFloat(cardStyle.paddingInlineStart)
    const contentRight = cardBox.right - parseFloat(cardStyle.paddingInlineEnd)
    const toolbarBox = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll('.videoOptionsMobileRow > *')]
      .filter(button => button.getClientRects().length > 0)
      .map(button => button.getBoundingClientRect())
    const widths = buttons.map(box => box.width)
    return {
      rows: new Set(buttons.map(box => Math.round(box.top))).size,
      inside: toolbarBox.left >= contentLeft - 0.5 && toolbarBox.right <= contentRight + 0.5 &&
        buttons.every(box => box.left >= toolbarBox.left - 0.5 && box.right <= toolbarBox.right + 0.5),
      touchSized: buttons.every(box => box.width >= 43.5 && box.height >= 47.5),
      spansCard: Math.abs(toolbarBox.width - (contentRight - contentLeft)) < 1,
      equalWidths: Math.max(...widths) - Math.min(...widths) < 1
    }
  })
}

test.describe('phone UI', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        quickSettings: ['currentLocale', 'baseTheme', 'uiScale'],
      },
      playlists: Array.from({ length: 24 }, (_, index) => ({ _id: `phone-list-${index}`, playlistName: `Phone playlist ${index}`, protected: false, videos: [], lastUpdatedAt: index }))
    }
  })

  test('opens inline player options within the player and navigates submenus', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    await player.locator('.shaka-overflow-menu-button').click({ force: true })
    const dialog = player.locator('.phonePlayerOptions[open]')
    await expect(dialog).toBeVisible()
    const viewport = await player.boundingBox()
    const box = await dialog.boundingBox()
    expect(Math.abs(box.width - viewport.width)).toBeLessThan(2)
    expect(Math.abs(box.height - viewport.height)).toBeLessThan(2)
    await attachScreenshot('phone player options')
    await dialog.locator('.shaka-playbackrate-button').click()
    await attachScreenshot('phone player submenu')
    await expect(dialog.locator(':scope > .shaka-back-to-overflow-button').first()).toBeVisible()
    await dialog.press('Escape')
    await expect(dialog.locator('.shaka-playbackrate-button')).toBeVisible()
    await dialog.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/watch/)
  })

  test('two quick Escapes leave a submenu and then close the player options', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    await player.locator('.shaka-overflow-menu-button').click({ force: true })
    const dialog = player.locator('.phonePlayerOptions[open]')
    await dialog.locator('.shaka-playbackrate-button').click()
    await expect(dialog.locator(':scope > .shaka-back-to-overflow-button')).toBeVisible()
    // Both within one frame, before the dialog updates its header
    await dialog.evaluate(element => {
      for (let press = 0; press < 2; press++) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      }
    })
    await expect(dialog).toHaveCount(0)
  })

  test('searches a language picker without closing quick settings', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
    await setWindowSize(app, page, { width: 360, height: 760 })
    await page.locator('.profileTrigger').click()
    const quick = page.locator('.quickSettingsMenu')
    await expect(quick).toBeVisible()
    await expect(quick).toHaveCSS('position', 'relative')
    await page.locator('.mobileSheet[open]').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    const headerBox = await page.locator('.mobileSheetHeader').boundingBox()
    const quickBox = await quick.boundingBox()
    expect(quickBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
    await quick.locator('.select').filter({ hasText: 'Language' }).getByRole('combobox').click()
    const picker = page.locator('dialog[open]').last()
    await expect(picker.getByRole('searchbox', { name: 'Search', exact: true })).toBeVisible()
    await expect(picker.getByRole('searchbox', { name: 'Search', exact: true })).not.toBeFocused()
    await picker.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    await attachScreenshot('mobile select search')
    await picker.locator('.selectDropdown').evaluate(element => { element.scrollTop = 100000 })
    await picker.getByRole('searchbox', { name: 'Search', exact: true }).fill('Deutsch')
    await expect(picker.getByRole('option')).toHaveCount(1)
    await expectNoScrollbarOverflow(picker.locator('.selectDropdown'))
    await picker.press('Escape')
    await expect(quick).toBeVisible()
    await quick.locator('.profileSummary').click()
    await expect(quick.locator('.profileList')).toBeVisible()
    await quick.press('Escape')
    await expect(quick.locator('.profileSummary')).toBeVisible()
    await quick.press('Escape')
    await expect(quick).toHaveCount(0)
    await expect(page.locator('.profileTrigger')).toBeFocused()
  })

  test('opens watch panels and offers tap queue reordering', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    // The short mocked video would end on a slow machine and play the first queued video, removing it from the queue
    await video.evaluate(element => element.pause())
    await page.evaluate(() => {
      const store = window.$store
      for (let i = 0; i < 12; i++) {
        store.commit('addVideoToWatchQueue', {
          video: { videoId: 'jNQXAC9IVRw', title: `Queue item ${i}`, author: 'Test channel' }
        })
      }
    })
    // Keep the CSS geometry of the queue sheet the same at every UI scale
    await setWindowSize(app, page, { width: Math.round(360 * uiScale / 100), height: Math.round(760 * uiScale / 100) })
    await page.locator('.phoneQueueButton').click()
    const sheet = page.locator('dialog[open]')
    await expect(sheet.locator('.queueItem')).toHaveCount(12)
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    const chooseQueueItemOption = async (item, option) => {
      await item.getByRole('button', { name: 'More options', exact: true }).click()
      await page.getByRole('menuitem', { name: option }).click()
    }
    const touch = await page.context().newCDPSession(page)
    const dragStart = await sheet.locator('.queueDragHandle').first().boundingBox()
    const targetBox = await sheet.locator('.queueItem').nth(2).boundingBox()
    const releaseY = targetBox.y + targetBox.height * 0.75
    // Near the scroller's edges the drag scrolls the list, and a slow release would overshoot
    const scrollerBottom = await sheet.locator('.queueItems').evaluate(element => {
      while (!/auto|scroll/.test(getComputedStyle(element).overflowY)) element = element.parentElement
      return element.getBoundingClientRect().bottom
    })
    expect(releaseY).toBeLessThan(scrollerBottom - 40)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dragStart.x + 24, y: dragStart.y + 24 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dragStart.x + 24, y: releaseY }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(sheet.locator('.queueItem').nth(2)).toContainText('Queue item 0')
    for (let index = 0; index < 2; index++) {
      await chooseQueueItemOption(sheet.locator('.queueItem').filter({ hasText: 'Queue item 0' }), /^Move video up$/i)
    }
    // The rows slide into their new places, so measure the grip once they're there
    await expect(sheet.locator('.queueItem').first()).toContainText('Queue item 0')
    await expect.poll(() => sheet.locator('.queueItem').evaluateAll(rows => rows.some(row => row.getAnimations().length > 0))).toBe(false)
    const gripBox = await sheet.locator('.queueDragHandle').first().boundingBox()
    const queueBox = await sheet.locator('.queueItems').boundingBox()
    const x = gripBox.x + gripBox.width / 2
    const y = gripBox.y + gripBox.height / 2
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: queueBox.y + queueBox.height - 5 }] })
    await expect.poll(() => sheet.locator('.queueItems').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await sheet.locator('.queueItems').evaluate(element => { element.scrollTop = 0 })
    await chooseQueueItemOption(sheet.locator('.queueItem').first(), /^Move video down$/i)
    await expect(sheet.locator('.queueItem').nth(1)).toContainText('Queue item 0')
    await sheet.locator('.queueItems').evaluate(element => { element.scrollTop = 100000 })
    for (let i = 0; i < 11; i++) {
      await chooseQueueItemOption(sheet.locator('.queueItem').last(), 'Remove from Queue')
    }
    await expectNoScrollbarOverflow(sheet.locator('.queueItems'))
    await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await page.locator('.phoneDescriptionPreview').click()
    await expect(page.locator('dialog[open]')).toContainText('Description')
    await page.locator('dialog[open]').press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })

  test('keeps the video actions in one touch-sized row and moves the rest to a More menu on narrow phones', { tag: '@scale' }, async ({ app, page, attachScreenshot, uiScale }) => {
    await page.evaluate(async () => {
      await window.$store.dispatch('updateUseSponsorBlock', true)
      await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'phone-list-0')
      await window.$store.dispatch('updateShowDlnaCastButton', true)
    })
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: Math.round(360 * uiScale / 100), height: 760 })
    const toolbar = page.locator('.videoOptions')
    const more = toolbar.getByRole('button', { name: 'More options', exact: true })
    const formats = toolbar.getByRole('button', { name: 'Change Media Formats', exact: true })
    await toolbar.scrollIntoViewIfNeeded()
    await expect(toolbar).toHaveClass(/\beven\b/)
    await expect(more).toBeVisible()
    await expect(formats).toHaveCount(0)
    // Download stays at the far end, after the More button
    await expect(toolbar.locator('.videoOptionsMobileRow > :last-child').last()).toHaveAccessibleName('Download Video')
    await expect.poll(() => getToolbarLayout(toolbar)).toMatchObject({ rows: 1, inside: true, touchSized: true })
    await attachScreenshot('narrow phone video actions')

    await more.click()
    const sheet = page.locator('dialog[open]')
    const option = sheet.getByRole('button', { name: 'Change Media Formats', exact: true })
    await expect(option).toBeVisible()
    // A sheet along the bottom edge with touch-sized rows
    await expect.poll(() => sheet.evaluate(element => {
      const box = element.getBoundingClientRect()
      const rows = [...element.querySelectorAll('.moreAction')].map(row => row.getBoundingClientRect())
      return Math.abs(box.bottom - window.innerHeight) < 1 && Math.abs(box.width - window.innerWidth) < 1 &&
        rows.length > 0 && rows.every(row => row.height >= 47.5)
    })).toBe(true)
    await attachScreenshot('video actions More sheet')
    await option.click()
    await expect(sheet).toHaveCount(0)
    await expect(page.locator('.promptCard')).toBeVisible()
    await page.locator('.prompt').click({ position: { x: 2, y: 2 } })
    await expect(page.locator('.promptCard')).toHaveCount(0)

    // Widening returns the moved actions to the toolbar
    await setWindowSize(app, page, { width: Math.round(600 * uiScale / 100), height: 800 })
    await expect(formats).toBeVisible()
    await expect(more).toHaveCount(0)
    await expect.poll(() => getToolbarLayout(toolbar)).toMatchObject({ rows: 1, inside: true })
  })

  test('scrolls the More actions sheet on short screens and clamps it when the screen grows', { tag: '@scale' }, async ({ app, page, uiScale }) => {
    await page.evaluate(async () => {
      await window.$store.dispatch('updateUseSponsorBlock', true)
      await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'phone-list-0')
      await window.$store.dispatch('updateShowDlnaCastButton', true)
    })
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: Math.round(360 * uiScale / 100), height: Math.round(781 * uiScale / 100) })
    const toolbar = page.locator('.videoOptions')
    await toolbar.scrollIntoViewIfNeeded()
    await toolbar.getByRole('button', { name: 'More options', exact: true }).click()
    const sheet = page.locator('dialog[open]')
    const list = sheet.locator('.moreActionsList')
    await expect(list).toBeVisible()
    // Electron windows cannot get short enough, so shrink the visible viewport
    // the sheet fits itself into, as the keyboard or split screen does
    await page.evaluate(() => document.documentElement.style.setProperty('--phone-viewport-height', '240px'))
    await expect(list.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expectScrollAtRenderedEnd(list)
    // The last action is fully reachable inside the sheet
    expect(await list.evaluate(element => {
      const last = element.querySelector('.moreAction:last-of-type').getBoundingClientRect()
      const viewport = element.getBoundingClientRect()
      return last.top >= viewport.top - 0.5 && last.bottom <= viewport.bottom + 0.5
    })).toBe(true)

    // The viewport tracking restores the full height on the next resize
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await expectNoScrollbarOverflow(list)
  })

  for (const trigger of ['hidden actions', 'a wider toolbar']) {
    test(`clamps the scrolled More actions sheet when ${trigger} leave it`, { tag: '@scale' }, async ({ app, page, uiScale }) => {
      await page.evaluate(async () => {
        await window.$store.dispatch('updateUseSponsorBlock', true)
        await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'phone-list-0')
        await window.$store.dispatch('updateShowDlnaCastButton', true)
      })
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: Math.round(360 * uiScale / 100), height: Math.round(781 * uiScale / 100) })
      const toolbar = page.locator('.videoOptions')
      await toolbar.scrollIntoViewIfNeeded()
      await toolbar.getByRole('button', { name: 'More options', exact: true }).click()
      const sheet = page.locator('dialog[open]')
      const list = sheet.locator('.moreActionsList')
      const actions = list.locator('.moreAction')
      await expect(list).toBeVisible()
      // Leave room for about two actions, as the keyboard or split screen does
      await page.evaluate(() => document.documentElement.style.setProperty('--phone-viewport-height', '230px'))
      await expect.poll(() => list.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(40)
      await list.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expectScrollAtRenderedEnd(list)
      const actionCount = await actions.count()

      if (trigger === 'hidden actions') {
        await page.evaluate(async () => {
          await window.$store.dispatch('updateUseSponsorBlock', false)
          await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', '')
        })
      } else {
        // Wider, but still a phone, so the sheet stays open
        await page.evaluate(() => {
          const viewport = document.documentElement.style
          window.addEventListener('resize', () => viewport.setProperty('--phone-viewport-height', '230px'), { once: true, capture: true })
        })
        await setWindowSize(app, page, { width: Math.round(410 * uiScale / 100), height: Math.round(780 * uiScale / 100) })
      }
      await expect.poll(() => actions.count()).toBeLessThan(actionCount)
      await expect(sheet).toBeVisible()
      // The offset stays within the shorter list, without empty space below
      // the last action, and the scrollbar matches the new range
      await expect.poll(() => list.evaluate(element => {
        const overflow = element.scrollHeight - element.clientHeight
        const scrollbar = element.querySelector('.os-scrollbar-vertical')
        const usable = scrollbar.classList.contains('os-scrollbar-visible') && !scrollbar.classList.contains('os-scrollbar-unusable')
        const last = element.querySelector('.moreAction:last-of-type').getBoundingClientRect()
        const viewportEnd = element.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(element).paddingBottom)
        return element.scrollTop <= Math.max(overflow, 0) + 1 &&
          (overflow > 1 ? usable && last.bottom >= viewportEnd - 2 : !usable && element.scrollTop === 0)
      })).toBe(true)
    })
  }

  test('spreads the video actions evenly in one row and wraps the metadata inline on phones', { tag: '@scale' }, async ({ app, page, attachScreenshot, uiScale }) => {
    await page.evaluate(async () => {
      await window.$store.dispatch('updateUseSponsorBlock', true)
      await window.$store.dispatch('updateQuickBookmarkTargetPlaylistId', 'phone-list-0')
      await window.$store.dispatch('updateShowDlnaCastButton', true)
    })
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: Math.round(412 * uiScale / 100), height: 860 })
    const toolbar = page.locator('.videoOptions')
    await toolbar.scrollIntoViewIfNeeded()
    await expect(toolbar).toHaveClass(/\beven\b/)
    await expect.poll(() => getToolbarLayout(toolbar)).toMatchObject({ rows: 1, inside: true, touchSized: true, spansCard: true, equalWidths: true })
    // Short icon-labeled items share rows instead of taking one row each
    const metadataRows = await page.locator('.watchVideoInfo .datePublishedAndViewCount').evaluate(element => {
      const items = [...element.children]
      return { items: items.length, rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size }
    })
    expect(metadataRows.items).toBeGreaterThan(2)
    expect(metadataRows.rows).toBeLessThan(metadataRows.items)
    await attachScreenshot('phone video info')

    // The labeled toolbar returns once it fits
    await setWindowSize(app, page, { width: Math.round(1200 * uiScale / 100), height: 900 })
    await expect(toolbar).toHaveClass(/\bfull\b/)
    await expect(toolbar.locator('.downloadLabel')).toBeVisible()
  })

  test('opens chapters and transcript as independent sheets', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    for (const [label, content] of [['Chapters', '.watchVideoChaptersPanel'], ['Transcript', '.transcriptCard']]) {
      if (label === 'Chapters') {
        await page.locator('.shaka-overflow-menu-button').click({ force: true })
        await page.locator('.phonePlayerOptions[open] .ft-chapters-button').click()
      } else {
        await clickVideoAction(page, new RegExp(label, 'i'))
      }
      const sheet = page.locator('dialog[open]')
      await expect(sheet.locator(content)).toBeVisible()
      if (label === 'Chapters') {
        // The sheet sizes the list, so it has no resize handle.
        await expect(sheet.locator('.chaptersWrapper')).toHaveCSS('resize', 'none')
      }
      await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(sheet).toHaveCount(0)
    }
    await expect(page).toHaveURL(/watch/)
  })

  test('aligns transcript language labels and keeps the checkmark at the row end', { tag: '@scale' }, async ({ app, page }) => {
    await page.evaluate(() => window.$store.dispatch('updatePreferredCaptionLocale', 'de'))
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 375, height: 760 })
    await clickVideoAction(page, /transcript/i)
    const languageButton = page.locator('.mobileSheetHeader').getByRole('button', { name: 'Transcript language', exact: true })
    await languageButton.click()
    const menu = page.locator('.transcriptLanguageMenu')
    await expect(menu.locator('button')).toHaveCount(2)
    await expect(menu.locator('.selected svg')).toHaveCount(1)
    for (const direction of ['ltr', 'rtl']) {
      await menu.evaluate((element, direction) => { element.dir = direction }, direction)
      const offsets = await menu.locator('button').evaluateAll(buttons => buttons.map(button => {
        const row = button.getBoundingClientRect()
        const labelElement = button.querySelector('span')
        const label = labelElement.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(labelElement)
        const check = button.querySelector('svg')?.getBoundingClientRect()
        const rtl = getComputedStyle(button).direction === 'rtl'
        return {
          lines: range.getClientRects().length,
          label: rtl ? row.right - label.right : label.left - row.left,
          check: check ? (rtl ? check.left - row.left : row.right - check.right) : null
        }
      }))
      expect(offsets.some(offset => offset.lines > 1)).toBe(true)
      expect(offsets.some(offset => offset.lines === 1)).toBe(true)
      for (const offset of offsets) {
        expect(offset.label).toBeGreaterThan(0)
        expect(offset.label).toBeLessThan(16)
        if (offset.check !== null) expect(offset.check).toBeLessThan(16)
      }
      expect(Math.abs(offsets[0].label - offsets[1].label)).toBeLessThan(1)
    }
    const nextLanguage = await menu.locator('button:not(.selected)').textContent()
    await menu.locator('button:not(.selected)').click()
    await expect(menu).toHaveCount(0)
    await languageButton.click()
    await expect(menu.locator('.selected')).toHaveText(nextLanguage)
  })

  test('clears transcript state through the shared Close button', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    await clickVideoAction(page, /transcript/i)
    const transcript = page.locator('dialog[open] .transcriptCard')
    await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Search transcript', exact: true }).click()
    await expect(transcript.locator('.transcriptControls input')).toBeFocused()
    await transcript.locator('.transcriptControls input').fill('elephant')
    await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(page.locator('.transcriptCard')).toHaveCount(0)
    await clickVideoAction(page, /transcript/i)
    await expect(transcript).toBeVisible()
    await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Search transcript', exact: true }).click()
    await expect(transcript.locator('.transcriptControls input')).toBeFocused()
    await expect(transcript.locator('.transcriptControls input')).toHaveValue('')
  })

  test('Escape closes the transcript language menu before the transcript sheet', async ({ app, page }) => {
    await page.evaluate(() => window.$store.dispatch('updatePreferredCaptionLocale', 'de'))
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    await clickVideoAction(page, /transcript/i)
    await expect(page.locator('dialog[open] .transcriptCard')).toBeVisible()
    const languageButton = page.locator('.mobileSheetHeader').getByRole('button', { name: 'Transcript language', exact: true })
    await languageButton.click()
    await expect(page.locator('.transcriptLanguageMenu')).toBeVisible()
    await languageButton.press('Escape')
    await expect(page.locator('.transcriptLanguageMenu')).toHaveCount(0)
    await expect(page.locator('dialog[open] .transcriptCard')).toBeVisible()
    await languageButton.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })

  test('opens live chat in a sheet and clears its panel state when dismissed', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const view = await watchViewHandle(page)
    await view.evaluate(view => {
      const listeners = new Map()
      view.$store.commit('setHideLiveChatReplay', false)
      view.liveChatIsReplay = true
      view.liveChat = {
        is_replay: true,
        on(event, listener) { listeners.set(listener, event) },
        once(event, listener) { listeners.set(listener, event) },
        off(_event, listener) { listeners.delete(listener) },
        start() { this.emit('start', { actions: [] }) },
        stop() {},
        seekTo() {},
        emit(event, value) {
          for (const [listener, name] of listeners) if (name === event) listener(value)
        }
      }
    })
    await setWindowSize(app, page, { width: 360, height: 760 })
    await clickVideoAction(page, /Live Chat/i)
    const chat = page.locator('dialog[open] .phoneLiveChat')
    await expect(chat).toBeVisible()
    await expect(chat).toBeInViewport()
    // Scroll away as soon as the messages mount, in the same task as the wheel
    // input. The chat anchors to the live edge a few frames after loading
    // finishes, and that pending jump must not override the user's scroll.
    await page.locator('dialog[open]').evaluate(dialog => {
      window.phoneChatScrolledAway = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          const scroller = dialog.querySelector('.phoneLiveChat .liveChatComments')
          if (scroller?.querySelectorAll('.chatMessage').length !== 45) return
          observer.disconnect()
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
          scroller.scrollTop = 180
          resolve()
        })
        observer.observe(dialog, { childList: true, subtree: true })
      })
    })
    await view.evaluate(view => {
      view.liveChat.emit('start', {
        actions: Array.from({ length: 45 }, (_, index) => {
          let checks = 0
          return {
            is: () => ++checks === 2,
            item: {
              is: () => true,
              id: `phone-chat-${index}`,
              timestamp: Date.now(),
              message: { runs: [{ text: `Phone message ${index}` }] },
              author: { badges: [], id: `viewer-${index}`, name: 'Viewer', thumbnails: [{ url: '' }], is_moderator: false }
            }
          }
        })
      })
    })
    await page.evaluate(() => window.phoneChatScrolledAway)
    const scroller = chat.locator('.liveChatComments')
    await expect(scroller.locator('.chatMessage')).toHaveCount(45)
    // Read back after the frames in which the post-load live-edge jump would run.
    const scrollTop = await scroller.evaluate(async element => {
      for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
      return element.scrollTop
    })
    expect(scrollTop).toBeCloseTo(180, 0)
    // Escape closes the chat settings first, then the sheet.
    const settings = page.locator('dialog[open] .phonePanelHeaderContent').getByRole('button', { name: 'Live Chat Settings' })
    await settings.click()
    await expect(page.locator('dialog[open] .liveChatSettingsMenu')).toBeVisible()
    await settings.press('Escape')
    await expect(page.locator('dialog[open] .liveChatSettingsMenu')).toHaveCount(0)
    await expect(chat).toBeVisible()
    await settings.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    expect(await view.evaluate(view => view.liveChatOpen)).toBe(false)
    await expect(page.locator('.phoneLiveChat')).toHaveCount(0)
    await clickVideoAction(page, /Live Chat/i)
    await expect(chat).toBeVisible()
    await expect(chat.locator('.chatMessage')).toHaveCount(0)
    await expect(chat.locator('.liveChatMessage')).toBeVisible()
  })

  test('filters playlists and keeps Create reachable', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    await page.locator('.videoOptions').getByRole('button', { name: /^Add to playlist$/i }).click()
    const picker = page.locator('.phonePlaylistPicker')
    await expect(picker).toBeVisible()
    const insets = await picker.locator('.playlistSearch input').evaluate(input => {
      const field = input.getBoundingClientRect()
      const picker = input.closest('.phonePlaylistPicker').getBoundingClientRect()
      return [field.left - picker.left, picker.right - field.right]
    })
    for (const inset of insets) expect(inset).toBeGreaterThanOrEqual(9)
    await picker.locator('.playlistList').evaluate(element => { element.scrollTop = 100000 })
    await picker.locator('.playlistSearch input').fill('Phone playlist 23')
    await expect(picker.locator('li')).toHaveCount(1)
    await expectNoScrollbarOverflow(picker.locator('.playlistList'))
    await picker.locator('li').click()
    await expect(picker.locator('li')).toHaveAttribute('aria-selected', 'true')
    await picker.getByRole('button', { name: /Create new playlist/i }).click()
    await expect(page.locator('.playlistNameInput')).toBeVisible()
    await expect(page.locator('.promptFixedFooter')).toBeInViewport()
  })

  test('keeps filter actions fixed without an active-filter summary', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 360, height: 760 })
    await page.evaluate(() => window.$store.dispatch('showSearchFilters'))
    const prompt = page.locator('.searchFiltersCard')
    await expect(prompt).toBeVisible()
    await prompt.getByText('Today', { exact: true }).click()
    await expect(prompt.locator('.activeFilters')).toHaveCount(0)
    await expect(prompt.locator('input[value="today"]')).toBeChecked()
    await prompt.locator('.promptContentScroller').evaluate(element => { element.scrollTop = 100000 })
    await expect(prompt.locator('.clearFilterButton')).toBeInViewport()
    await expect(prompt.locator('.promptFixedFooter')).toBeInViewport()
    await prompt.locator('.clearFilterButton').click()
    await expect(prompt.locator('.activeFilters')).toHaveCount(0)
    await expect(prompt.locator('input[value="today"]')).not.toBeChecked()
    await prompt.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(prompt).toHaveCount(0)
  })

  test('collapses advanced download options without leaving an obsolete scroll offset', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    await page.locator('.videoOptions').getByRole('button', { name: 'Download Video', exact: true }).click()
    const prompt = page.locator('.downloadPromptCard')
    const advanced = prompt.locator('.advancedDownloadOptions')
    await expect(advanced).not.toHaveAttribute('open')
    await advanced.locator('summary').click()
    await expect(advanced).toHaveAttribute('open')
    const scroller = prompt.locator('.downloadOptions')
    await scroller.evaluate(element => { element.scrollTop = 100000 })
    await advanced.evaluate(element => { element.open = false })
    // Larger UI scales can leave the collapsed options scrollable; the offset must clamp to the new range.
    await expect.poll(() => scroller.evaluate(element => element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight))).toBeLessThanOrEqual(1)
    await expectScrollAtRenderedEnd(scroller)
    await expect(prompt.locator('.downloadFooter')).toBeInViewport()
  })
})

for (const currentLocale of ['en-US', 'de-DE', 'ar']) {
  test.describe(`phone layout in ${currentLocale}`, () => {
    test.use({ seed: { settings: { currentLocale, useAITranslationCompletions: true, quickSettings: ['currentLocale', 'baseTheme', 'uiScale'] } } })
    test('fits small phones, landscape, and tablet windows', async ({ app, page }) => {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      for (const [width, height] of [[320, 640], [360, 760], [720, 360], [900, 900]]) {
        await setWindowSize(app, page, { width, height })
        await page.locator('.profileTrigger').click()
        const menu = page.locator('.quickSettingsMenu')
        if (width === 900) {
          await expect(menu).toHaveCSS('position', 'absolute')
        } else {
          await expect(menu).toHaveCSS('position', 'relative')
          await expect.poll(() => menu.evaluate(element => {
            const box = element.getBoundingClientRect()
            return box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
          })).toBe(true)
          await menu.locator('.select').filter({ has: page.locator('option[value="de-DE"]') }).getByRole('combobox').click()
          const sheet = page.locator('dialog[open]').last()
          await sheet.getByRole('searchbox').fill('Deutsch')
          await expect(sheet.getByRole('option')).toHaveCount(1)
          await sheet.press('Escape')
          await expect(page.locator('dialog[open]')).toHaveCount(1)
        }
        await menu.press('Escape')
        await expect(menu).toHaveCount(0)
      }
    })
  })
}
