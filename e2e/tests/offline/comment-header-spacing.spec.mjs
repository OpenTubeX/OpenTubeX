import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function resizeViewport(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
  }, { width, uiScale })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
}

test.describe('comment header spacing', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

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
})
