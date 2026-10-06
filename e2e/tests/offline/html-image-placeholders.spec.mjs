import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

test('isolates inline HTML placeholders from responsive image sources', async ({ page }) => {
  const source = await readFile(new URL('../../../src/renderer/helpers/htmlImagePlaceholder.js', import.meta.url), 'utf8')
  const svg = await readFile(new URL('../../../src/renderer/assets/img/thumbnail_placeholder.svg', import.meta.url), 'utf8')
  const pending = []
  await page.route('https://responsive-images.test/**', route => { pending.push(route) })
  // Exercise the DOM helper with the responsive markup retained by DOMPurify
  // on WebViews without the native HTML Sanitizer.
  await page.addScriptTag({ content: source.replace(/^import .*\n/, `const thumbnailPlaceholder = ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(svg)}`)}\n`).replace('export function', 'function') })
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'responsive-placeholder-test'
    container.innerHTML = '<img id="responsive-image" src="https://responsive-images.test/base" srcset="https://responsive-images.test/candidate 1x" sizes="24px" alt="Responsive image" width="24" height="24"><picture><source srcset="https://responsive-images.test/picture"><img id="picture-image" src="https://responsive-images.test/picture-base" alt="Picture image" width="24" height="24"></picture>'
    document.body.append(container)
    window.addHtmlImagePlaceholders(container)
  })
  const container = page.locator('#responsive-placeholder-test')
  const placeholders = container.locator('.htmlImagePlaceholder')
  await expect(placeholders).toHaveCount(2)
  for (const placeholder of await placeholders.all()) {
    await expect(placeholder).not.toHaveAttribute('srcset')
    await expect(placeholder).not.toHaveAttribute('sizes')
    await expect(placeholder).not.toHaveAttribute('id')
    await expect(placeholder).toHaveAttribute('alt', '')
    await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => placeholder.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    expect((await placeholder.boundingBox()).width).toBe(24)
  }
  await expect(container.locator('picture .htmlImagePlaceholder')).toHaveCount(0)
  while (pending.length) await pending.shift().abort()
  await expect(container).toContainText('Responsive image')
  await expect(container).toContainText('Picture image')
  await expect(placeholders).toHaveCount(0)
})
