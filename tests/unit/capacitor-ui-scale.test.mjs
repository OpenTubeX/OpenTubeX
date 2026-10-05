import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapacitorUiScale } from '../../src/renderer/helpers/capacitorUiScale.js'

function fixture() {
  const visualViewport = Object.assign(new EventTarget(), { width: 400, scale: 1 })
  const window = Object.assign(new EventTarget(), { visualViewport })
  const changes = []
  const properties = new Map()
  const classes = new Set()
  const scale = createCapacitorUiScale(window, {
    body: { classList: { contains: name => classes.has(name) } },
    documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } },
    querySelector: () => ({ setAttribute: (_, value) => changes.push(value) }),
  })
  return { scale, visualViewport, changes, window, properties, classes }
}

test('UI scale resizes the layout viewport and remains stable after fractional resize events', () => {
  const { scale, visualViewport, changes } = fixture()
  scale.setScale(150)
  assert.equal(changes[0], 'width=267, initial-scale=1.4981273408239701, viewport-fit=cover')
  Object.assign(visualViewport, { width: 267.00002, scale: 400 / 267 })
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.length, 1)
  scale.setScale(100)
  assert.equal(changes.at(-1), 'width=400, initial-scale=1, viewport-fit=cover')
  scale.dispose()
})

test('live Android PiP keeps the original viewport and fractional UI scale throughout entry and resizing', async () => {
  const { scale, visualViewport, changes, window, properties, classes } = fixture()
  window.outerWidth = 461
  scale.setScale(125)
  const original = changes.at(-1)
  const zoom = properties.get('--capacitor-ui-scale')
  classes.add('androidPictureInPicture')
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning: true }))
  await Promise.resolve()
  for (const width of [258, 400, 258]) {
    window.outerWidth = width
    visualViewport.width = width
    window.dispatchEvent(new Event('resize'))
    visualViewport.dispatchEvent(new Event('resize'))
  }
  assert.equal(changes.at(-1), original, 'native scaling must not resize Chromium or its video surface')
  assert.equal(properties.get('--capacitor-ui-scale'), zoom)
  scale.dispose()
})

test('Android PiP resizes without rewriting a fixed viewport and restores the saved UI scale on return', async () => {
  const { scale, visualViewport, changes, window, properties, classes } = fixture()
  window.outerWidth = 400
  scale.setScale(125)
  classes.add('androidPictureInPicture')
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true }))
  await Promise.resolve()
  assert.equal(changes.at(-1), 'width=320, initial-scale=1.25, viewport-fit=cover')
  assert.equal(properties.get('--capacitor-ui-scale'), '1.25')
  const count = changes.length
  for (const width of [228, 379, 228, 379]) {
    window.outerWidth = width
    visualViewport.width = width
    window.dispatchEvent(new Event('resize'))
    visualViewport.dispatchEvent(new Event('resize'))
  }
  assert.equal(changes.length, count, 'PiP must not schedule another Chromium relayout for each resize')
  // The scale listener can run before App's PiP listener restores the body class.
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: false, windowWidth: 400 }))
  classes.delete('androidPictureInPicture')
  await Promise.resolve()
  assert.equal(changes.at(-1), 'width=320, initial-scale=1.25, viewport-fit=cover')
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=320, initial-scale=1.25, viewport-fit=cover')
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: false, windowWidth: 400 }))
  await Promise.resolve()
  assert.equal(changes.at(-1), 'width=320, initial-scale=1.25, viewport-fit=cover')
  window.outerWidth = 400
  window.dispatchEvent(new Event('resize'))
  window.outerWidth = 640
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=512, initial-scale=1.25, viewport-fit=cover')
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true }))
  await Promise.resolve()
  // Configuration.screenWidthDp rounds to an integer; outerWidth can differ by one pixel.
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: false, windowWidth: 639 }))
  await Promise.resolve()
  assert.equal(changes.at(-1), 'width=512, initial-scale=1.25, viewport-fit=cover')
  scale.dispose()
})

test('PiP preparation and repeated callbacks preserve the original viewport', async () => {
  const { scale, visualViewport, changes, window, classes } = fixture()
  window.outerWidth = 400
  window.outerHeight = 800
  scale.setScale(125)
  classes.add('androidPictureInPicture')
  classes.add('androidPictureInPictureEntering')
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning: true }))
  await Promise.resolve()
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=320, initial-scale=1.25, viewport-fit=cover')
  // A repeated native preparation callback must not replace the original size.
  window.outerWidth = 228
  window.outerHeight = 128
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning: true }))
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=320, initial-scale=1.25, viewport-fit=cover')
  scale.dispose()
})

test('UI scale follows rotation and window resizing without reacting to keyboard height changes', () => {
  const { scale, visualViewport, changes, window } = fixture()
  scale.setScale(125)
  Object.assign(visualViewport, { width: 640, scale: 1.25 })
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=640, initial-scale=1.25, viewport-fit=cover')
  const count = changes.length
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.length, count)
  scale.dispose()
  visualViewport.width = 320
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.length, count)
})

test('safe-area CSS receives the actual fractional viewport scale', () => {
  const { scale, properties } = fixture()
  scale.setScale(150)
  assert.equal(Number(properties.get('--capacitor-ui-scale')), 400 / 267)
  scale.setScale(75)
  assert.equal(Number(properties.get('--capacitor-ui-scale')), 400 / 533)
  scale.dispose()
})

test('PiP return does not multiply the window width by a stale WebKit zoom', () => {
  const { scale, visualViewport, changes, window } = fixture()
  window.outerWidth = 1080
  Object.assign(visualViewport, { width: 1080, scale: 1 })
  scale.setScale(100)
  assert.equal(changes.at(-1), 'width=1080, initial-scale=1, viewport-fit=cover')
  Object.assign(visualViewport, { width: 1080, scale: 2.0186915397644043 })
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=1080, initial-scale=1, viewport-fit=cover')
  scale.setScale(75)
  assert.equal(changes.at(-1), 'width=1440, initial-scale=0.75, viewport-fit=cover')
  scale.setScale(150)
  assert.equal(changes.at(-1), 'width=720, initial-scale=1.5, viewport-fit=cover')
  window.outerWidth = 810
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=540, initial-scale=1.5, viewport-fit=cover')
  scale.dispose()
})
