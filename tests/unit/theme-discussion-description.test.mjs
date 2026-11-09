import assert from 'node:assert/strict'
import { test } from 'node:test'

import { limitThemeDescription } from '../../_scripts/themeDiscussionDescription.mjs'

function post(description, { markers = true, newline = '\n' } = {}) {
  return ['## Beschreibung', '', description, '', '## Bildschirmfotos', '',
    markers ? '<!-- theme-screenshots:start -->' : '',
    '![Screenshot](https://github.com/user-attachments/assets/example)',
    markers ? '<!-- theme-screenshots:end -->' : '', '',
    '<details>', '<summary>Theme JSON</summary>', '', '```json',
    JSON.stringify({ name: 'A'.repeat(800) }), '```', '', '</details>',
  ].join('\n').replaceAll('\n', newline)
}

test('limits only the description, preserving uploaded screenshots and theme JSON', () => {
  for (const markers of [false, true]) {
    for (const newline of ['\n', '\r\n']) {
      assert.equal(limitThemeDescription(post('a'.repeat(501), { markers, newline })),
        post('a'.repeat(500), { markers, newline }))
    }
  }
})
