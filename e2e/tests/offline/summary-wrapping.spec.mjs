import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from '../../helpers/app.mjs'

// Exercise the actual stylesheet in Chromium, including fractional UI scales.
test('wrapped summary disclaimer starts flush with the heading without a leading separator', async ({ page }) => {
  const css = await readFile(new URL('../../../src/renderer/components/WatchVideoSummary/WatchVideoSummary.css', import.meta.url), 'utf8') + await readFile(new URL('../../../src/renderer/components/FtInlineMetadata/FtInlineMetadata.css', import.meta.url), 'utf8')

  await page.setContent(`<style>${css}</style><div class="summaryHeading ftInlineMetadata" style="width:340px;font:16px sans-serif"><span class="summaryTitle">AI-generated video summary</span><span class="summaryDisclaimer">Quality and accuracy may vary</span></div>`)
  for (const zoom of [1, 0.95, 1.25]) {
    await page.locator('.summaryHeading').evaluate((el, zoom) => { el.style.zoom = zoom }, zoom)
    const result = await page.evaluate(() => {
      const heading = document.querySelector('.summaryTitle')
      const disclaimer = document.querySelector('.summaryDisclaimer')
      const range = document.createRange()
      range.selectNodeContents(disclaimer)
      return { heading: heading.getBoundingClientRect().toJSON(), disclaimer: range.getBoundingClientRect().toJSON() }
    })
    assert.ok(result.disclaimer.y > result.heading.y)
    assert.ok(Math.abs(result.disclaimer.x - result.heading.x) < 1, 'Wrapped disclaimer must have no leading dot or gap')
  }
})
