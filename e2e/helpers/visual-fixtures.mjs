import { readFile } from 'node:fs/promises'

import { expect } from '@playwright/test'

const fixtures = new Map([
  ['avatar', new URL('../fixtures/media/avatar.svg', import.meta.url)],
  ['video-thumbnail', new URL('../fixtures/media/video-thumbnail.svg', import.meta.url)]
])

/**
 * Serves a local SVG for a routed image request.
 * @param {import('@playwright/test').Route} route
 * @param {'avatar' | 'video-thumbnail'} name
 */
export async function fulfillVisualFixture(route, name) {
  const fixture = fixtures.get(name)
  if (!fixture) throw new Error(`Unknown visual fixture: ${name}`)

  await route.fulfill({
    body: await readFile(fixture),
    contentType: 'image/svg+xml'
  })
}

/**
 * Waits until at least one matched image has loaded successfully.
 * @param {import('@playwright/test').Locator} locator
 */
export async function expectImagesLoaded(locator) {
  await expect.poll(() => locator.evaluateAll(images => (
    images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0)
  ))).toBe(true)
}
