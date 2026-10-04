import { test, expect, expectScrollAtRenderedEnd, goTo } from '../../helpers/app.mjs'

async function expectCompactOptions(prompt) {
  await expect.poll(() => prompt.evaluate(element => {
    const advanced = element.querySelector('.advancedDownloadOptions').getBoundingClientRect()
    const footer = element.querySelector('.downloadFooter').getBoundingClientRect()
    return footer.top - advanced.bottom
  })).toBeLessThanOrEqual(32)
  const scroller = prompt.locator('.downloadOptions')
  await expect.poll(() => scroller.evaluate(element => {
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    return element.scrollTop === 0 && element.scrollHeight <= element.clientHeight + 1 &&
      scrollbar !== null && (!scrollbar.classList.contains('os-scrollbar-visible') ||
        scrollbar.classList.contains('os-scrollbar-unusable'))
  })).toBe(true)
}

async function scrollToBottom(scroller) {
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expectScrollAtRenderedEnd(scroller)
  await expectScrollbarMatchesOverflow(scroller)
}

async function expectScrollbarMatchesOverflow(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    const hasOverflow = element.scrollHeight > element.clientHeight + 1
    const usableScrollbar = scrollbar !== null && scrollbar.classList.contains('os-scrollbar-visible') &&
      !scrollbar.classList.contains('os-scrollbar-unusable')
    return hasOverflow === usableScrollbar
  })).toBe(true)
}

async function expectFixedSections(prompt) {
  for (const selector of ['.downloadHeader', '.fixedTemplateSection', '.downloadFooter']) {
    await expect(prompt.locator(selector)).toBeInViewport()
  }
  await expect.poll(() => prompt.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(() => prompt.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  await expect.poll(() => prompt.evaluate(element => element.getBoundingClientRect().bottom - innerHeight)).toBeLessThanOrEqual(1)
  await expect.poll(() => prompt.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
}

for (const uiScale of [100, 125]) {
  test.describe(`download dialog sizing at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: { uiScale, baseTheme: 'dark' },
        playlists: [{
          _id: 'download-sizing',
          playlistName: 'Download sizing playlist',
          description: '',
          protected: false,
          createdAt: 1700000000000,
          lastUpdatedAt: 1700000000000,
          videos: [{ videoId: 'jNQXAC9IVRw', title: 'Video', author: 'Channel', lengthSeconds: 120 }]
        }]
      }
    })

    test('fits collapsed options and adjusts after expansion, collapse, and resize', async ({ page, attachScreenshot }) => {
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Download sizing playlist', exact: true }).click()
      await page.setViewportSize({ width: 461, height: 1026 })
      await page.getByTitle('Download Playlist').click()
      const prompt = page.locator('.downloadPromptCard')
      const advanced = prompt.locator('.advancedDownloadOptions')
      const scroller = prompt.locator('.downloadOptions')
      await expect(advanced).not.toHaveAttribute('open')
      await expectCompactOptions(prompt)
      await expectFixedSections(prompt)
      const compactHeight = await prompt.evaluate(element => element.getBoundingClientRect().height)

      await advanced.locator('summary').click()
      await expect(advanced).toHaveAttribute('open')
      await expect.poll(() => prompt.evaluate(element => element.getBoundingClientRect().height))
        .toBeGreaterThan(compactHeight + 32)
      await scrollToBottom(scroller)
      await expectFixedSections(prompt)
      await advanced.evaluate(element => { element.open = false })
      await expectCompactOptions(prompt)
      await expectFixedSections(prompt)
      await attachScreenshot(`compact mobile download dialog at ${uiScale}%`)

      // A short viewport needs scrolling even with Advanced collapsed.
      await page.setViewportSize({ width: 375, height: 650 })
      await scrollToBottom(scroller)
      await expectFixedSections(prompt)
      await page.setViewportSize({ width: 461, height: 1200 })
      await expectCompactOptions(prompt)
      await expectFixedSections(prompt)

      // Widening into the two-column layout reduces the expanded scroll range.
      await page.setViewportSize({ width: 375, height: 812 })
      await advanced.locator('summary').click()
      await scrollToBottom(scroller)
      await page.setViewportSize({ width: 900, height: 1200 })
      await expectScrollAtRenderedEnd(scroller)
      await expectScrollbarMatchesOverflow(scroller)
      await expectFixedSections(prompt)

      await page.setViewportSize({ width: 812, height: 375 })
      await advanced.evaluate(element => { element.open = true })
      await scrollToBottom(scroller)
      await expectFixedSections(prompt)
      await expect.poll(() => scroller.evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(48)
      await attachScreenshot(`landscape mobile download dialog at ${uiScale}%`)
      await advanced.evaluate(element => { element.open = false })
      await expectScrollAtRenderedEnd(scroller)
      await expectScrollbarMatchesOverflow(scroller)
      await expectFixedSections(prompt)
    })
  })
}
