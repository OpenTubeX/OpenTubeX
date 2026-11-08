import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import postcss from 'postcss'

import postcssFontScale from '../../_scripts/postcssFontScale.js'

const SOURCE_FILE = fileURLToPath(new URL('../../src/renderer/components/Example.vue', import.meta.url))
const DEPENDENCY_FILE = fileURLToPath(new URL('../../node_modules/example/style.css', import.meta.url))

async function transform(css, from = SOURCE_FILE) {
  const result = await postcss([postcssFontScale]).process(css, { from })
  return result.css
}

test('scales px and rem font sizes and line heights in app styles', async () => {
  assert.equal(
    await transform('.a { font-size: 14px; } .b { font-size: 0.9rem !important; } .c { font-size: max(12px, 1vw); }'),
    '.a { font-size: calc(14px * var(--font-scale, 1)); } ' +
      '.b { font-size: calc(0.9rem * var(--font-scale, 1)) !important; } ' +
      '.c { font-size: calc(max(12px, 1vw) * var(--font-scale, 1)); }'
  )
  assert.equal(
    await transform('.a { line-height: 20px; } .b { line-height: 1.5; } .c { line-height: var(--height, 60px); }'),
    '.a { line-height: calc(20px * var(--font-scale, 1)); } .b { line-height: 1.5; } .c { line-height: var(--height, 60px); }'
  )
})

test('leaves relative, keyword, and variable font sizes alone', async () => {
  const css = '.a { font-size: 0.8em; } .b { font-size: 120%; } .c { font-size: small; } ' +
    '.d { font-size: var(--size, inherit); } .e { font-size: calc(12 * var(--u)); } .f { padding: 4px; }'
  assert.equal(await transform(css), css)
})

test('does not scale dependency styles or already scaled sizes', async () => {
  assert.equal(await transform('.a { font-size: 14px; }', DEPENDENCY_FILE), '.a { font-size: 14px; }')

  const scaled = '.a { font-size: calc(14px * var(--font-scale, 1)); }'
  assert.equal(await transform(scaled), scaled)
})
