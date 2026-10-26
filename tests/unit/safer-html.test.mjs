import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Builds without the native Sanitizer API fall back to DOMPurify.
globalThis.window = {}
const configs = []
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'dompurify') {
      return { shortCircuit: true, url: 'data:text/javascript,export default { sanitize: (html, config) => { globalThis.purifyConfigs.push(config); return html } }' }
    }
    if (specifier.endsWith('/htmlImagePlaceholder')) {
      return { shortCircuit: true, url: 'data:text/javascript,export function addHtmlImagePlaceholders() {}' }
    }
    return nextResolve(specifier, context)
  }
})
globalThis.purifyConfigs = configs
const { vSaferHtml } = await import('../../src/renderer/directives/vSaferHtml.js')
hooks.deregister()

function image(style) {
  const element = { style: { ...style }, removeAttribute: name => { if (name === 'style') element.style = {} } }
  return element
}

function render(images, modifiers = {}) {
  const element = { querySelectorAll: () => images }
  vSaferHtml(element, { value: '<p>html</p>', oldValue: null, modifiers })
  return configs.at(-1)
}

test('the lenient fallback only keeps the release note markup the native sanitizer allows', () => {
  const config = render([], { lenient: true })
  assert.ok(config.ALLOWED_TAGS.includes('details') && config.ALLOWED_TAGS.includes('a'))
  for (const tag of ['form', 'input', 'button', 'textarea', 'style']) assert.ok(!config.ALLOWED_TAGS.includes(tag), tag)
  for (const attribute of ['style', 'action', 'formaction', 'class']) assert.ok(!config.ALLOWED_ATTR.includes(attribute), attribute)
})

test('remote image styles cannot position images, only the emoji alignment remains', () => {
  const overlay = image({ position: 'fixed', inset: '0', zIndex: '9999' })
  const emoji = image({ verticalAlign: 'middle', position: 'absolute' })
  render([overlay, emoji])
  assert.deepEqual(overlay.style, {})
  assert.deepEqual(emoji.style, { verticalAlign: 'middle' })
})
