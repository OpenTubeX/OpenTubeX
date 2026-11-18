import assert from 'node:assert/strict'
import test from 'node:test'
import { setupPhoneViewport, softwareKeyboardOpen } from '../../src/renderer/helpers/phoneViewport.js'

test('Android keyboard transitions do not subtract the keyboard height twice', () => {
  const visualViewport = Object.assign(new EventTarget(), { height: 1026, offsetTop: 0 })
  const window = Object.assign(new EventTarget(), { innerHeight: 1026, visualViewport })
  const values = new Map()
  const dispose = setupPhoneViewport(window, { documentElement: { style: { setProperty: (key, value) => values.set(key, value) } } }, true)
  // Pixel Android 16 reports visual and layout resize in separate frames.
  for (const [layout, visual] of [[1026, 599], [599, 173], [551, 503], [551, 551], [1026, 1026]]) {
    window.innerHeight = layout
    visualViewport.height = visual
    visualViewport.dispatchEvent(new Event('resize'))
    assert.equal(values.get('--phone-viewport-height'), `${layout}px`)
  }
  dispose()
  window.innerHeight = 100
  window.dispatchEvent(new Event('resize'))
  assert.equal(values.get('--phone-viewport-height'), '1026px')
})

test('browser dialogs follow the visual viewport including panning', () => {
  const visualViewport = Object.assign(new EventTarget(), { height: 432.5, offsetTop: 20.5 })
  const window = Object.assign(new EventTarget(), { innerHeight: 800, visualViewport })
  const values = new Map()
  const dispose = setupPhoneViewport(window, { documentElement: { style: { setProperty: (key, value) => values.set(key, value) } } })
  assert.equal(values.get('--phone-viewport-height'), '432.5px')
  assert.equal(values.get('--phone-viewport-top'), '20.5px')
  dispose()
})

test('Android bottom bars stay hidden until the page grows back after its keyboard closes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const window = Object.assign(new EventTarget(), { innerWidth: 400, innerHeight: 800 })
  const field = { matches: () => true }
  const button = { matches: () => false }
  const document = { activeElement: button, documentElement: { style: { setProperty() {} } } }
  const resize = (height, width = 400) => {
    Object.assign(window, { innerHeight: height, innerWidth: width })
    window.dispatchEvent(new Event('resize'))
  }
  const dispose = setupPhoneViewport(window, document, true)

  // Split screen shrinks the page without a focused field.
  resize(500)
  assert.equal(softwareKeyboardOpen.value, false)
  resize(800)

  document.activeElement = field
  resize(480)
  assert.equal(softwareKeyboardOpen.value, true)
  // The keyboard's suggestion strip changes its height.
  resize(440)
  assert.equal(softwareKeyboardOpen.value, true)

  // The page closes the search before Android reports the closed keyboard.
  document.activeElement = button
  window.dispatchEvent(new Event('focusout'))
  assert.equal(softwareKeyboardOpen.value, true)
  resize(800)
  assert.equal(softwareKeyboardOpen.value, false)

  // A keyboard that closes without resizing the page.
  document.activeElement = field
  resize(480)
  document.activeElement = button
  window.dispatchEvent(new Event('focusout'))
  t.mock.timers.tick(1000)
  assert.equal(softwareKeyboardOpen.value, false)

  // Rotation is not a closed keyboard but resets the state.
  document.activeElement = field
  resize(800)
  resize(480)
  assert.equal(softwareKeyboardOpen.value, true)
  resize(300, 800)
  assert.equal(softwareKeyboardOpen.value, false)
  dispose()
})
