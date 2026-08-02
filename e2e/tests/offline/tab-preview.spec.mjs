import { test, expect, sel } from '../../helpers/app.mjs'

const CAPTURE_CLASS = 'opentubex-tab-preview-capturing'
const CAPTURE_STYLE_ID = 'opentubex-tab-preview-capture-style'

/**
 * Reads the pixel size out of a preview data URL. Previews are JPEG, but a
 * cache written by an older version can still hand back a PNG.
 * @param {string} dataUrl
 * @returns {{ width: number, height: number }}
 */
function imageSize(dataUrl) {
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  // Walk the JPEG segments to the start-of-frame, which carries the size.
  for (let offset = 2; offset < buffer.length - 9;) {
    if (buffer[offset] !== 0xff) {
      throw new Error(`not a JPEG segment at offset ${offset}`)
    }
    const marker = buffer[offset + 1]
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('no JPEG start-of-frame found')
}

/**
 * Hovers the given tab and resolves once its tooltip shows a captured preview.
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 * @returns {Promise<string>} the preview data URL
 */
async function hoverTabForPreview(page, index) {
  await page.locator(sel.tabs).nth(index).hover()
  const preview = page.locator('.tabTooltip .tabTooltipPreview img')
  await expect(preview).toBeVisible()
  await expect.poll(async () => (await preview.getAttribute('src'))?.startsWith('data:image/jpeg'))
    .toBe(true)
  return await preview.getAttribute('src')
}

test.describe('tab previews', () => {
  test('captures the page content without the tab bar and header', async ({ page }) => {
    const dataUrl = await hoverTabForPreview(page, 0)

    const expectedRatio = await page.evaluate(() => {
      const bottomOf = (selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0
      const contentTop = Math.max(bottomOf('.tabBar'), bottomOf('.topNav'))
      return window.innerWidth / (window.innerHeight - contentTop)
    })

    const { width, height } = imageSize(dataUrl)
    // The capture is downscaled to fit the tooltip, so only the shape of the
    // cropped region survives. Leaving the 60px header in would visibly change
    // it (~1.84 instead of ~1.98 at the default test window size).
    expect(width / height).toBeGreaterThan(expectedRatio - 0.03)
    expect(width / height).toBeLessThan(expectedRatio + 0.03)
  })

  test('never stores fewer pixels than the tooltip displays', async ({ page }) => {
    const dataUrl = await hoverTabForPreview(page, 0)

    const displayed = await page.locator('.tabTooltip .tabTooltipPreview').boundingBox()
    const { width } = imageSize(dataUrl)
    // Anything below the displayed width would be upscaled by the browser.
    expect(width).toBeGreaterThanOrEqual(Math.round(displayed.width))
  })

  test('hides tab previews from the page while capturing', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await hoverTabForPreview(page, 1)

    // The capture stylesheet is injected by the main process on the first
    // capture; applying its class reproduces what a capture sees.
    await expect(page.locator(`#${CAPTURE_STYLE_ID}`)).toHaveCount(1)
    const hiddenWhileCapturing = await page.evaluate((captureClass) => {
      document.documentElement.classList.add(captureClass)
      const visibilities = Array.from(
        document.querySelectorAll('[data-tab-preview-overlay]'),
        (element) => getComputedStyle(element).visibility
      )
      document.documentElement.classList.remove(captureClass)
      return visibilities
    }, CAPTURE_CLASS)

    expect(hiddenWhileCapturing.length).toBeGreaterThan(0)
    expect(hiddenWhileCapturing.every((visibility) => visibility === 'hidden')).toBe(true)
  })
})
