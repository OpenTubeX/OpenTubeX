import { test, expect } from '../../helpers/app.mjs'

for (const iconPack of ['material', 'remix']) {
  test.describe(iconPack, () => {
    test.use({
      seed: {
        settings: {
          baseTheme: 'dark',
          iconPack,
          moveSettingsToAppHeader: true,
          moveDownloadsToAppHeader: true
        }
      }
    })

    test('search actions match the header button spacing', { tag: '@scale' }, async ({ page }, testInfo) => {
      await expect(page.locator('.topNav .settingsButton')).toBeVisible()
      const input = page.locator('.topNav .searchInput input')
      await input.fill('https://example.com/videos/1234567890')
      await input.blur()
      const cdp = await page.context().newCDPSession(page)
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
      const findCancel = node => {
        if (node.attributes?.includes('-webkit-search-cancel-button')) return node
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
          const cancel = findCancel(child)
          if (cancel) return cancel
        }
      }
      // Chromium's native clear button lives inside its user-agent shadow tree.
      const cancel = findCancel(root)
      expect(cancel).toBeDefined()

      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.documentElement.dir = value }, direction)
        await expect.poll(() => page.evaluate(() => {
          const bounds = selector => document.querySelector(selector).getBoundingClientRect()
          const gap = (first, second) => Math.max(first.left, second.left) - Math.min(first.right, second.right)
          return gap(bounds('.navFilterButton'), bounds('.searchInput .inputAction')) -
            gap(bounds('.topNav .downloadsButton'), bounds('.topNav .settingsButton'))
        })).toBeCloseTo(0, 1)
        const { model } = await cdp.send('DOM.getBoxModel', { nodeId: cancel.nodeId })
        const clearCenter = (model.border[0] + model.border[2]) / 2
        const [filterCenter, searchCenter] = await page.locator('.navFilterButton, .searchInput .inputAction')
          .evaluateAll(elements => elements.map(element => {
            const bounds = element.getBoundingClientRect()
            return bounds.left + bounds.width / 2
          }))
        expect(Math.abs(clearCenter - filterCenter)).toBeCloseTo(Math.abs(filterCenter - searchCenter), 1)
      }
      await cdp.detach()

      await page.evaluate(() => { document.documentElement.dir = 'ltr' })
      await testInfo.attach('header-search-spacing', {
        body: await page.locator('.topNav').screenshot(),
        contentType: 'image/png'
      })
    })
  })
}
