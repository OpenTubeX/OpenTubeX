import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

async function installPlaceholderHelper(page) {
  const source = await readFile(new URL('../../../src/renderer/helpers/htmlImagePlaceholder.js', import.meta.url), 'utf8')
  const svg = await readFile(new URL('../../../src/renderer/assets/img/thumbnail_placeholder.svg', import.meta.url), 'utf8')
  const skeleton = await readFile(new URL('../../../src/renderer/assets/img/image_skeleton.svg', import.meta.url), 'utf8')
  // Exercise the DOM helper with the responsive markup retained by DOMPurify
  // on WebViews without the native HTML Sanitizer.
  await page.addScriptTag({
    content: `
    const thumbnailPlaceholder = ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(svg)}`)};
    const imageSkeleton = ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(skeleton)}`)};
    ${source.replace(/^import .*\n/gm, '').replace('export function', 'function')}
  `
  })
  return svg
}

test('isolates inline HTML placeholders from responsive image sources', async ({ page }) => {
  const svg = await installPlaceholderHelper(page)
  const pending = []
  await page.route('https://responsive-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'responsive-placeholder-test'
    container.innerHTML = '<img id="responsive-image" src="https://responsive-images.test/base" srcset="https://responsive-images.test/candidate 1x" sizes="24px" alt="Responsive image" width="24" height="24"><picture><source srcset="https://responsive-images.test/picture"><img id="picture-image" src="https://responsive-images.test/picture-base" alt="Picture image" width="24" height="24"></picture><img id="empty-image" src="https://responsive-images.test/empty" alt="" width="24" height="24">'
    document.body.append(container)
    window.addHtmlImagePlaceholders(container)
  })
  const container = page.locator('#responsive-placeholder-test')
  const placeholders = container.locator('.htmlImagePlaceholder')
  await expect(placeholders).toHaveCount(3)
  for (const placeholder of await placeholders.all()) {
    await expect(placeholder).toHaveClass(/ft-shimmer/)
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
  await expect(placeholders).toHaveCount(1)
  await expect(placeholders).not.toHaveClass(/ft-shimmer/)
  await expect(placeholders).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)
})

test('uses permanent fallbacks for missing sources and failures completed before initialization', async ({ page }) => {
  const svg = await installPlaceholderHelper(page)
  await page.setContent('<div id="images"><img><img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,AAAA" alt="Unavailable image"></div>')
  await expect.poll(() => page.locator('#images img').evaluateAll(images => images.every(image => image.complete && !image.naturalWidth))).toBe(true)
  await page.evaluate(() => window.addHtmlImagePlaceholders(document.querySelector('#images')))
  await expect(page.locator('#images .ft-shimmer')).toHaveCount(0)
  const placeholders = page.locator('#images .htmlImagePlaceholder')
  await expect(placeholders).toHaveCount(2)
  for (const placeholder of await placeholders.all()) {
    await expect(placeholder).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)
  }
  await expect(page.locator('#images')).toContainText('Unavailable image')
})
