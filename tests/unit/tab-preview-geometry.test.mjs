import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cropTabPreviewToContent,
  getTabPreviewTargetSize,
  measureTabPreviewContentBounds,
  TAB_PREVIEW_MAX_CSS_WIDTH,
  TAB_PREVIEW_MAX_PIXEL_RATIO
} from '../../src/main/tabs/tabPreviewGeometry.js'

const VIEWPORT_WIDTH = 1200
const VIEWPORT_HEIGHT = 800

function createElement(rect, classNames = []) {
  return {
    classList: { contains: name => classNames.includes(name) },
    getBoundingClientRect: () => rect
  }
}

function createEnvironment({ tabBar = null, topNav = null, devicePixelRatio = 1 } = {}) {
  const window = { innerWidth: VIEWPORT_WIDTH, innerHeight: VIEWPORT_HEIGHT, devicePixelRatio }
  const document = {
    documentElement: { clientWidth: VIEWPORT_WIDTH, clientHeight: VIEWPORT_HEIGHT },
    querySelector: selector => {
      if (selector === '.tabBar') return tabBar
      if (selector === '.topNav') return topNav
      return null
    }
  }
  return { window, document }
}

function createImage(width, height) {
  return {
    getSize: () => ({ width, height }),
    crop: rect => ({ ...rect, cropped: true })
  }
}

test('excludes both the horizontal tab bar and the header', () => {
  const { window, document } = createEnvironment({
    tabBar: createElement({ left: 0, right: VIEWPORT_WIDTH, top: 0, bottom: 32 }),
    topNav: createElement({ left: 0, right: VIEWPORT_WIDTH, top: 32, bottom: 92 })
  })

  assert.deepEqual(measureTabPreviewContentBounds(window, document), {
    contentTop: 92,
    contentLeft: 0,
    contentRight: VIEWPORT_WIDTH,
    contentBottom: VIEWPORT_HEIGHT,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    devicePixelRatio: 1
  })
})

test('excludes the vertical tab bar column and the header', () => {
  const { window, document } = createEnvironment({
    tabBar: createElement({ left: 0, right: 220, top: 0, bottom: VIEWPORT_HEIGHT }, ['vertical']),
    topNav: createElement({ left: 220, right: VIEWPORT_WIDTH, top: 0, bottom: 60 })
  })

  assert.deepEqual(measureTabPreviewContentBounds(window, document), {
    contentTop: 60,
    contentLeft: 220,
    contentRight: VIEWPORT_WIDTH,
    contentBottom: VIEWPORT_HEIGHT,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    devicePixelRatio: 1
  })
})

test('crops the inline-end vertical tab bar for right-to-left layouts', () => {
  const { window, document } = createEnvironment({
    tabBar: createElement(
      { left: VIEWPORT_WIDTH - 220, right: VIEWPORT_WIDTH, top: 0, bottom: VIEWPORT_HEIGHT },
      ['vertical']
    ),
    topNav: createElement({ left: 0, right: VIEWPORT_WIDTH - 220, top: 0, bottom: 60 })
  })

  const bounds = measureTabPreviewContentBounds(window, document)
  assert.equal(bounds.contentLeft, 0)
  assert.equal(bounds.contentRight, VIEWPORT_WIDTH - 220)
  assert.equal(bounds.contentTop, 60)
})

test('excludes a horizontal tab bar on the bottom edge', () => {
  const { window, document } = createEnvironment({
    tabBar: createElement({
      left: 0,
      right: VIEWPORT_WIDTH,
      top: VIEWPORT_HEIGHT - 32,
      bottom: VIEWPORT_HEIGHT
    }),
    topNav: createElement({ left: 0, right: VIEWPORT_WIDTH, top: 0, bottom: 60 })
  })

  assert.deepEqual(measureTabPreviewContentBounds(window, document), {
    contentTop: 60,
    contentLeft: 0,
    contentRight: VIEWPORT_WIDTH,
    contentBottom: VIEWPORT_HEIGHT - 32,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    devicePixelRatio: 1
  })
})

test('keeps the full viewport when the chrome is missing or collapsed', () => {
  const hidden = createEnvironment({
    topNav: createElement({ left: 0, right: 0, top: 0, bottom: 0 })
  })
  assert.deepEqual(measureTabPreviewContentBounds(hidden.window, hidden.document), {
    contentTop: 0,
    contentLeft: 0,
    contentRight: VIEWPORT_WIDTH,
    contentBottom: VIEWPORT_HEIGHT,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    devicePixelRatio: 1
  })

  const empty = createEnvironment()
  assert.equal(measureTabPreviewContentBounds(empty.window, empty.document).contentTop, 0)
})

test('crops device pixels using the viewport scale', () => {
  const image = createImage(VIEWPORT_WIDTH * 2, VIEWPORT_HEIGHT * 2)
  const cropped = cropTabPreviewToContent(image, {
    contentTop: 92,
    contentLeft: 220,
    contentRight: VIEWPORT_WIDTH,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT
  })

  assert.deepEqual(cropped, {
    x: 440,
    y: 184,
    width: VIEWPORT_WIDTH * 2 - 440,
    height: VIEWPORT_HEIGHT * 2 - 184,
    cropped: true
  })
})

test('returns the original image when there is nothing to crop', () => {
  const image = createImage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
  const bounds = {
    contentTop: 0,
    contentLeft: 0,
    contentRight: VIEWPORT_WIDTH,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT
  }

  assert.equal(cropTabPreviewToContent(image, bounds), image)
})

test('rejects degenerate crops instead of returning an empty preview', () => {
  const bounds = {
    contentTop: VIEWPORT_HEIGHT,
    contentLeft: 0,
    contentRight: VIEWPORT_WIDTH,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT
  }

  assert.equal(cropTabPreviewToContent(createImage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT), bounds), null)
  assert.equal(cropTabPreviewToContent(createImage(0, 0), bounds), null)
})

/**
 * Bounds reported by a window with the given device pixel ratio.
 * @param {number} devicePixelRatio
 */
function boundsForRatio(devicePixelRatio) {
  return {
    contentTop: 92,
    contentLeft: 0,
    contentRight: VIEWPORT_WIDTH,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    devicePixelRatio
  }
}

test('keeps the device pixel ratio so HiDPI previews stay sharp', () => {
  // NativeImage reports logical pixels, so the same capture arrives at the same
  // size on a 1x and a 2x display - only the ratio says how much detail is there.
  const standard = getTabPreviewTargetSize({ width: 1200, height: 600 }, boundsForRatio(1))
  const hiDpi = getTabPreviewTargetSize({ width: 1200, height: 600 }, boundsForRatio(2))

  assert.equal(standard.width, TAB_PREVIEW_MAX_CSS_WIDTH)
  assert.equal(hiDpi.width, TAB_PREVIEW_MAX_CSS_WIDTH * 2)
  assert.equal(hiDpi.height, standard.height * 2)
})

test('caps the stored pixel ratio so previews stay small', () => {
  const target = getTabPreviewTargetSize({ width: 4800, height: 2400 }, boundsForRatio(6))

  assert.equal(target.width, TAB_PREVIEW_MAX_CSS_WIDTH * TAB_PREVIEW_MAX_PIXEL_RATIO)
})

test('leaves captures that already fit untouched', () => {
  assert.equal(getTabPreviewTargetSize({ width: 320, height: 180 }, boundsForRatio(1)), null)
  assert.equal(getTabPreviewTargetSize({ width: 0, height: 0 }, boundsForRatio(2)), null)
})

test('falls back to a single pixel ratio when bounds are unavailable', () => {
  const target = getTabPreviewTargetSize({ width: 1200, height: 600 }, null)

  assert.equal(target.width, TAB_PREVIEW_MAX_CSS_WIDTH)
})

test('never stores fewer pixels than the preview is displayed at', () => {
  // 1080p content cropped below the chrome, on an unscaled display. The tooltip
  // draws it ~322px wide, so anything below that would be an upscale.
  const target = getTabPreviewTargetSize({ width: 1920, height: 950 }, boundsForRatio(1))

  assert.ok(target.width >= 322)
})
