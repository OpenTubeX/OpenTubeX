import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({
  seed: {
    settings: {
      ...WATCH_PAGE_SEED,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue'
    }
  }
})

test('stream extraction choices keep one outline and a straight shared seam', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watchView = await watchViewHandle(page)
  await page.getByRole('button', { name: 'Change Media Formats' }).click()
  const prompt = page.getByRole('dialog', { name: 'Change Media Formats' })
  const group = prompt.locator('.engineOptions')

  await expect(group).toHaveCSS('column-gap', '0px')
  await expect(prompt.getByRole('group', { name: 'Stream extraction method' })).toBeVisible()

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    for (const width of [1000, 400]) {
      await setWindowSize(app, page, {
        width: Math.round(width * uiScale / 100),
        height: Math.round((width === 400 ? 720 : 800) * uiScale / 100)
      })
      // Resizing can move a segment beneath the pointer that opened the dialog.
      await page.mouse.move(0, 0)
      for (const selected of ['yt-dlp', 'built-in']) {
        // Exercise either selected side without starting a real extraction.
        await watchView.evaluate(async (view, engine) => {
          view.playbackEngineFallbackTarget = engine
          view.ytDlpStreamsPending = true
          await view.$nextTick()
        }, selected)

        const active = group.locator('[aria-pressed="true"]')
        const inactive = group.locator('[aria-pressed="false"]')
        await expect(active).toHaveText(selected === 'yt-dlp' ? 'yt-dlp' : 'Built-in')
        await expect(inactive).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect(active.locator('.engineOptionCheck')).toHaveAttribute('aria-hidden', 'true')
        expect(await active.evaluate(button => button.firstElementChild.classList.contains('engineOptionCheck'))).toBe(true)

        const geometry = await group.evaluate(element => {
          const [first, last] = element.children
          const firstBounds = first.getBoundingClientRect()
          const lastBounds = last.getBoundingClientRect()
          const groupBounds = element.getBoundingClientRect()
          return {
            seamGap: lastBounds.left - firstBounds.right,
            radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
            innerRadii: [getComputedStyle(first).borderTopRightRadius, getComputedStyle(last).borderTopLeftRadius],
            fits: firstBounds.left >= groupBounds.left && lastBounds.right <= groupBounds.right,
            selectionVisible: getComputedStyle(element.querySelector('[aria-pressed="true"]')).backgroundColor !==
              getComputedStyle(element.querySelector('[aria-pressed="false"]')).backgroundColor
          }
        })
        expect(geometry.seamGap).toBeCloseTo(0, 3)
        expect(geometry.radius).toBe(20)
        expect(geometry.innerRadii).toEqual(['0px', '0px'])
        expect(geometry.fits).toBe(true)
        expect(geometry.selectionVisible).toBe(true)
      }
    }
  }

  await group.getByRole('button', { name: 'Built-in', exact: true }).click()
  await expect(prompt).toHaveCount(0)
  expect(await page.evaluate(() => window.$store.getters.getVideoPlaybackEngine)).toBe('built-in')
})
