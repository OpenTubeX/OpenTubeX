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
    const sizingImage = placeholder.locator('img')
    await expect(placeholder).toHaveClass(/ft-shimmer/)
    await expect(sizingImage).not.toHaveAttribute('srcset')
    await expect(sizingImage).not.toHaveAttribute('sizes')
    await expect(sizingImage).not.toHaveAttribute('id')
    await expect(sizingImage).toHaveAttribute('alt', '')
    await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => sizingImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    expect((await placeholder.boundingBox()).width).toBe(24)
  }
  await expect(container.locator('picture .htmlImagePlaceholder')).toHaveCount(0)
  while (pending.length) await pending.shift().abort()
  await expect(container).toContainText('Responsive image')
  await expect(container).toContainText('Picture image')
  await expect(placeholders).toHaveCount(1)
  await expect(placeholders).not.toHaveClass(/ft-shimmer/)
  await expect(placeholders.locator('img')).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)
})

test('preserves image layout while loading, after a stall, and on a late load', async ({ page }) => {
  await page.clock.install()
  const svg = await installPlaceholderHelper(page)
  const css = await readFile(new URL('../../../src/renderer/themes.css', import.meta.url), 'utf8')
  const appCss = await readFile(new URL('../../../src/renderer/App.css', import.meta.url), 'utf8')
  const changelogCss = appCss.match(/\.changeLogText :deep\([^)]*\)[^{]*\{[^}]+\}/g).join('\n').replace(/:deep\(([^)]+)\)/g, '$1')
  await page.addStyleTag({ content: css + changelogCss })
  const pending = []
  await page.route('https://styled-images.test/**', route => { pending.push(route) })
  await page.evaluate(svg => {
    const images = [
      { style: 'width:100%;height:auto;margin:8px 0;vertical-align:middle' },
      { style: 'width:50%;height:auto;float:right;margin:12px 8px' },
      { style: 'position:absolute;left:12px;top:18px;width:60%;height:auto' },
      { style: 'height:48px;width:auto;padding:4px;border:2px solid red' },
      { width: 800, height: 450 },
      { width: 800, height: 200, className: 'changeLogText' }
    ]
    for (const [index, { style = '', width = 80, height = 45, className }] of images.entries()) {
      const pair = document.createElement('section')
      pair.innerHTML = `<div class="reference"><img width="${width}" height="${height}" alt="" style="${style}"></div><div class="actual"><img width="${width}" height="${height}" alt="" style="${style}"></div>`
      for (const box of pair.children) {
        box.style.cssText = 'position:relative;display:flow-root;width:60vw;min-height:240px'
        if (className) box.classList.add(className)
      }
      pair.querySelector('.reference img').src = `data:image/svg+xml,${encodeURIComponent(svg)}`
      pair.querySelector('.actual img').src = `https://styled-images.test/${index}`
      document.body.append(pair)
      window.addHtmlImagePlaceholders(pair.querySelector('.actual'))
    }
  }, svg)
  await expect.poll(() => pending.length).toBe(6)
  const position = element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    const parent = element.parentElement.getBoundingClientRect()
    return { x: x - parent.x, y: y - parent.y, width, height }
  }
  const checkSlots = async selector => {
    for (const width of [640, 960]) {
      await page.setViewportSize({ width, height: 720 })
      for (const section of await page.locator('section').all()) {
        const expected = await section.locator('.reference img').evaluate(position)
        const actual = await section.locator(`.actual ${selector}`).evaluate(position)
        for (const [key, value] of Object.entries(expected)) expect(actual[key], key).toBeCloseTo(value, 1)
      }
    }
  }
  await checkSlots('.htmlImagePlaceholder')
  await page.clock.fastForward(10_001)
  await expect(page.locator('.ft-shimmer')).toHaveCount(0)
  await checkSlots('.htmlImagePlaceholder')
  while (pending.length) await pending.shift().fulfill({ contentType: 'image/svg+xml', body: svg })
  await expect(page.locator('.htmlImagePlaceholder')).toHaveCount(0)
  await checkSlots('img')
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
    await expect(placeholder.locator('img')).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)
  }
  await expect(page.locator('#images')).toContainText('Unavailable image')
})

test('stalled inline images show static fallbacks and recover on a late load', async ({ page }) => {
  await page.clock.install()
  const svg = await installPlaceholderHelper(page)
  const pending = []
  await page.route('https://stalled-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'stalled-images'
    container.innerHTML = '<img src="https://stalled-images.test/image" width="48" height="48" alt="Example">'
    document.body.append(container)
    window.addHtmlImagePlaceholders(container)
  })
  const placeholder = page.locator('.htmlImagePlaceholder')
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  await expect.poll(() => pending.length).toBe(1)
  await page.clock.fastForward(10_001)
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await expect(placeholder.locator('img')).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)
  await pending.shift().fulfill({ contentType: 'image/svg+xml', body: svg })
  await expect(placeholder).toHaveCount(0)
  await expect(page.locator('#stalled-images img')).toBeVisible()
})

test('zero-width SVG loads retain the deadline for a static fallback', async ({ page }) => {
  await page.clock.install()
  const svg = await installPlaceholderHelper(page)
  const pending = []
  await page.route('https://zero-width-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'zero-width-images'
    container.innerHTML = '<img src="https://zero-width-images.test/image" width="48" height="48">'
    container.firstChild.addEventListener('load', () => { container.dataset.loaded = 'true' })
    document.body.append(container)
    window.addHtmlImagePlaceholders(container)
  })
  await expect.poll(() => pending.length).toBe(1)
  await pending.shift().fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="48"/>' })
  await expect(page.locator('#zero-width-images')).toHaveAttribute('data-loaded', 'true')
  expect(await page.locator('#zero-width-images > img').evaluate(image => image.naturalWidth)).toBe(0)
  const placeholder = page.locator('.htmlImagePlaceholder')
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  await page.clock.fastForward(10_001)
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await expect(placeholder.locator('img')).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)
})

test('lazy inline images keep their skeleton offscreen, then time out and recover', async ({ page }) => {
  await page.clock.install()
  const svg = await installPlaceholderHelper(page)
  const pending = []
  await page.route('https://lazy-inline-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'lazy-inline-images'
    container.style.marginTop = '10000px'
    container.innerHTML = '<img src="https://lazy-inline-images.test/emoji" loading="lazy" width="48" height="48" alt="Emoji" style="vertical-align: middle">'
    document.body.append(container)
    window.addHtmlImagePlaceholders(container)
  })
  const placeholder = page.locator('.htmlImagePlaceholder')
  await page.clock.fastForward(20_000)
  expect(pending).toHaveLength(0)
  await expect(placeholder).toHaveClass(/ft-shimmer/)

  await placeholder.scrollIntoViewIfNeeded()
  await expect.poll(() => pending.length).toBe(1)
  await page.clock.runFor(100)
  await page.clock.fastForward(9_000)
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  await page.clock.fastForward(1_001)
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await expect(placeholder.locator('img')).toHaveAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg)}`)

  await pending.shift().fulfill({ contentType: 'image/svg+xml', body: svg })
  await expect(placeholder).toHaveCount(0)
  const image = page.locator('#lazy-inline-images img')
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('style', 'vertical-align: middle')
})
