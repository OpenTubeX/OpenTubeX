import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../../src/renderer/views/Channel/Channel.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('../../src/renderer/views/Channel/Channel.vue', import.meta.url), 'utf8')

test('places View All left of the right-aligned sort dropdown', () => {
  const selectContainerRule = styles.match(/\.select-container\s*{(?<declarations>[^}]*)}/)?.groups?.declarations
  const viewAllRule = styles.match(/\.select-container\s*>\s*:deep\(\.btn\)\s*{(?<declarations>[^}]*)}/)?.groups?.declarations

  assert.match(selectContainerRule ?? '', /align-items:\s*flex-end;/)
  assert.match(selectContainerRule ?? '', /justify-content:\s*flex-end;/)
  assert.match(viewAllRule ?? '', /margin-inline-end:\s*auto;/)
  assert.match(viewAllRule ?? '', /margin-block-end:\s*9px;/)
  assert.doesNotMatch(viewAllRule ?? '', /align-self:/)
})

test('renders View All as an outlined accent button', () => {
  assert.match(component, /theme="channel-view-all"/)
  assert.match(styles, /\.channel-view-all[^}]*background-color:\s*transparent;[^}]*border-color:\s*var\(--accent-color\);/s)
})
