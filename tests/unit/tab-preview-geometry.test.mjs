import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cropTabPreviewToContent,
  measureTabPreviewContentBounds
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
