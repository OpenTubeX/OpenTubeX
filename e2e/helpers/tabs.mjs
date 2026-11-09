import { expect } from './app.mjs'

/** Measures the highlight's CSS box without rounding fractional UI scales. */
export function tabHighlightAlignment(tab) {
  const style = getComputedStyle(tab)
  const highlight = getComputedStyle(tab, '::before')
  return Math.max(
    ...['left', 'right', 'top', 'bottom'].map(side => Math.abs(parseFloat(highlight[side]))),
    Math.abs(parseFloat(highlight.width) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) - parseFloat(style.width)),
    Math.abs(parseFloat(highlight.height) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) - parseFloat(style.height))
  )
}

export async function expectTabHighlightStyle(tab, property, value) {
  await expect.poll(() => tab.evaluate((element, property) => getComputedStyle(element, '::before')[property], property)).toBe(value)
}

export async function expectTabHighlightAligned(tab) {
  await expect(tab).toBeVisible()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expectTabHighlightStyle(tab, 'content', '""')
  await expectTabHighlightStyle(tab, 'opacity', '1')
  await expect.poll(() => tab.evaluate(tabHighlightAlignment)).toBeLessThan(0.2)
}

/**
 * Selects a channel tab, through the More menu when it does not fit in the row.
 * @param {import('@playwright/test').Page} page
 * @param {string} id The tab id without the `Tab` suffix, such as `about`.
 */
export async function selectChannelTab(page, id) {
  const tab = page.locator(`.channelDetails:visible #${id}Tab`)
  if (!await tab.evaluate(element => element.classList.contains('overflowedTab'))) {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    return
  }
  const label = await tab.locator('.tabLabel > span').textContent()
  const more = page.locator('.channelDetails:visible #moreTab')
  await more.click()
  // Phones list the tabs in a bottom sheet with checkbox items; elsewhere they are radio items.
  await page.locator('[role="menuitemradio"], [role="menuitemcheckbox"]')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click()
  await expect(more).toHaveAttribute('aria-selected', 'true')
  await expect(more).toContainText(label)
}

/**
 * Waits for tab strip items to finish opening and closing. Their Web
 * Animations change tab sizes and positions; the endless CSS animations of
 * loading indicators do not.
 * @param {import('@playwright/test').Page} page
 */
export async function expectTabStripSettled(page) {
  await expect.poll(() => page.locator('.tabBar .tabsContent').evaluate(content => content.getAnimations({ subtree: true })
    .filter(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)).length)).toBe(0)
}
