import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { emptyCommentsResponse, mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function resizeViewport(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
  }, { width, uiScale })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
}

test.describe('comment header spacing', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

  test('matches transcript button spacing and preserves phone header highlights', async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    await openMockedVideo(page)
    await resizeViewport(app, page, 450, uiScale)
    const watch = await watchViewHandle(page)
    const sheet = page.locator('.mobileSheet[open]')
    const header = sheet.locator('.mobileSheetHeader')
    const buttonBounds = () => header.locator('button:visible').evaluateAll(buttons => buttons.map(button => {
      const { x, width, height } = button.getBoundingClientRect()
      return { x, width, height }
    }))

    await watch.evaluate(view => view.openPhonePanel('transcript'))
    await expect(sheet.locator('.transcriptHeader')).toBeVisible()
    const transcript = await buttonBounds()
    const buttonSize = transcript[0].width
    const buttonStep = transcript[1].x - transcript[0].x
    const closeGap = transcript.at(-1).x - transcript.at(-2).x - transcript.at(-2).width
    await header.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)

    await watch.evaluate(view => view.openPhonePanel('comments'))
    await expect(sheet.locator('.comment').first()).toBeVisible()
    await expect(header.locator('button:visible')).toHaveCount(5)
    await expect.poll(async () => {
      const comments = await buttonBounds()
      return Math.max(
        ...comments.flatMap(button => [Math.abs(button.width - buttonSize), Math.abs(button.height - buttonSize)]),
        ...comments.slice(1, -1).map((button, index) => Math.abs(button.x - comments[index].x - buttonStep)),
        Math.abs(comments.at(-1).x - comments.at(-2).x - comments.at(-2).width - closeGap)
      )
    }).toBeLessThanOrEqual(1)

    const reload = header.getByRole('button', { name: 'Reload Comments', exact: true })
    await reload.hover()
    await expect(reload).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await header.getByRole('button', { name: 'Filter loaded comments', exact: true }).focus()
    await page.keyboard.press('Tab')
    const sort = header.getByRole('button', { name: 'Sort by', exact: true })
    await expect(sort).toBeFocused()
    await expect(sort).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })

  test('keeps comments directly below the header at wide and narrow widths', async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await expect(page.locator('.comment').first()).toBeVisible()

    for (const width of [1600, 640]) {
      await resizeViewport(app, page, width, uiScale)

      await expect.poll(() => page.locator('.commentHeader').evaluate(header => {
        const contentBottom = Math.max(
          header.querySelector('.commentsTitle').getBoundingClientRect().bottom,
          ...Array.from(header.querySelectorAll('.commentHeaderActions button'), button => button.getBoundingClientRect().bottom)
        )
        const avatar = header.parentElement.querySelector('.commentThumbnail, .commentThumbnailHidden')
        return avatar.getBoundingClientRect().top - contentBottom
      })).toBeCloseTo(15, 0)
    }
  })

  test('keeps Close clickable when phone header actions need to wrap', async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await app.electronApp.evaluate(({ BrowserWindow }, uiScale) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(0, 0)
      window.setContentSize(340, Math.round(900 * uiScale / 100))
    }, uiScale)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(360)
    await (await watchViewHandle(page)).evaluate(view => view.openPhonePanel('comments'))
    const sheet = page.locator('.mobileSheet[open]')
    const header = sheet.locator('.mobileSheetHeader')
    await expect(sheet.locator('.comment').first()).toBeVisible()
    await expect.poll(() => header.locator('.commentHeaderTitle').evaluate(title => title.scrollWidth - title.clientWidth)).toBeLessThanOrEqual(1)
    await expect.poll(() => header.evaluate(header => {
      const bounds = header.getBoundingClientRect()
      const minimumSize = parseFloat(getComputedStyle(header).getPropertyValue('--phone-touch-target'))
      const buttons = [...header.querySelectorAll('button')].map(button => button.getBoundingClientRect())
      return buttons.every((button, index) => button.width >= minimumSize - 1 && button.height >= minimumSize - 1 &&
        button.left >= bounds.left && button.right <= bounds.right &&
        buttons.slice(index + 1).every(other => button.right <= other.left + 1 || other.right <= button.left + 1 ||
          button.bottom <= other.top + 1 || other.bottom <= button.top + 1))
    })).toBe(true)
    await header.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
  })

  test('aligns the toolbar and bounds search without overflowing narrow cards', async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await expect(page.locator('.commentsTitle')).toBeVisible()
    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()

    const search = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await expect(search).toBeFocused()

    for (const { width, cardWidth } of [
      { width: 1600, cardWidth: '' },
      { width: 640, cardWidth: '' },
      { width: 640, cardWidth: '320px' }
    ]) {
      await resizeViewport(app, page, width, uiScale)
      await page.locator('.commentHeader').evaluate((header, cardWidth) => {
        header.parentElement.style.maxInlineSize = cardWidth
      }, cardWidth)

      await expect.poll(() => page.locator('.commentHeader').evaluate(header => {
        const title = header.querySelector('.commentsTitle').getBoundingClientRect()
        const actions = header.querySelector('.commentHeaderActions').getBoundingClientRect()
        const buttons = [...header.querySelectorAll('.commentHeaderActions button')]
        const actionsCenter = (actions.top + actions.bottom) / 2
        return {
          actionsAligned: buttons.every(button => {
            const bounds = button.getBoundingClientRect()
            return Math.abs((bounds.top + bounds.bottom) / 2 - actionsCenter) <= 1
          }),
          titleAlignedOrAbove: actions.top >= title.bottom || Math.abs((title.top + title.bottom) / 2 - actionsCenter) <= 1,
          noOverflow: header.scrollWidth <= header.clientWidth + 1
        }
      })).toEqual({ actionsAligned: true, titleAlignedOrAbove: true, noOverflow: true })

      await expect.poll(() => search.evaluate(input => {
        const bounds = input.closest('.commentSearchRow').getBoundingClientRect()
        const card = input.closest('.card')
        const cardStyle = getComputedStyle(card)
        const contentWidth = card.clientWidth - parseFloat(cardStyle.paddingInlineStart) - parseFloat(cardStyle.paddingInlineEnd)
        const close = input.closest('.commentSearchRow').querySelector('.commentSearchClose').getBoundingClientRect()
        return Math.max(Math.abs(bounds.width - Math.min(480, contentWidth)), close.right - bounds.right)
      })).toBeLessThanOrEqual(1)
    }

    await search.fill('honored')
    await expect(page.locator('.commentFilterCount')).toBeVisible()
    await page.locator('.commentTools').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(search).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Filter loaded comments' })).toBeFocused()
  })

  test('keeps the empty-state actions compact and vertically centered', async ({ app, page, uiScale }) => {
    await mockPlayableWatchPage(app, page)
    await page.route(/\/youtubei\/v1\/next/, (route, request) => {
      const body = JSON.parse(request.postData() ?? '{}')
      return body.continuation ? route.fulfill({ contentType: 'application/json', body: emptyCommentsResponse }) : route.fallback()
    })
    await openMockedVideo(page)
    const actions = page.locator('.noCommentActions')
    await expect(actions).toBeVisible()
    await expect.poll(() => actions.evaluate(element => {
      const sortBottom = element.querySelector('.select-text').getBoundingClientRect().bottom
      return element.getBoundingClientRect().bottom - sortBottom
    })).toBeCloseTo(0, 0)

    for (const width of [1600, 640]) {
      await resizeViewport(app, page, width, uiScale)

      await expect.poll(() => actions.evaluate(element => {
        const actions = element.getBoundingClientRect()
        const actionsCenter = (actions.top + actions.bottom) / 2
        return Math.max(...Array.from(element.querySelectorAll('button'), button => {
          const rect = button.getBoundingClientRect()
          return Math.abs((rect.top + rect.bottom) / 2 - actionsCenter)
        }))
      })).toBeLessThanOrEqual(1)

      if (width === 1600) {
        await expect.poll(() => actions.evaluate(element => {
          const card = element.closest('.card').getBoundingClientRect()
          const message = element.parentElement.querySelector('.noCommentMsg').getBoundingClientRect()
          const actions = element.getBoundingClientRect()
          const cardCenter = (card.top + card.bottom) / 2
          return Math.max(
            Math.abs((message.top + message.bottom) / 2 - cardCenter),
            Math.abs((actions.top + actions.bottom) / 2 - cardCenter)
          )
        })).toBeLessThanOrEqual(1)
      }
    }
  })
})
